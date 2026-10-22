import {
  NOTIFICATION_EVENT_TITLES,
  type NotificationChannelKind,
  PROXY_UNPARSED,
  SERVICE_EVENT_HINTS,
  ServiceEventId,
} from '@averra/schema'
import { and, eq, isNull, notInArray } from 'drizzle-orm'
import type { SessionUser } from '../../auth/access'
import type { Db } from '../../db/client'
import { notificationRecipients, sites } from '../../db/schema'
import type { DbOrTx } from '../../mail/outbox'
import { toMailLine } from '../../mail/templates/line'
import { type ChannelCheckResult, channelSecretContext } from '../../notifications/channel'
import { telegramConnectionOf, telegramSettingsOf } from '../../notifications/channels/telegram'
import type { NotificationDeps } from '../../notifications/deps'
import { type NotifyDeps, notifyTargets, ownerTargets } from '../../notifications/notify'
import {
  dropPendingFor,
  dropPendingOfChannel,
  notificationOutboxRepo,
} from '../../notifications/outbox'
import {
  changeLeadRecipients,
  changeLeadRecipientsIn,
  type RecipientsActor,
  STUCK_AFTER_MS,
  stuckWarning,
} from '../../notifications/recipients'
import {
  type AudienceSite,
  channelConfigs,
  notificationSettingsRepo,
  type StoredRecipient,
} from '../../notifications/settings'
import { parseProxy, proxyForDisplay, TelegramApiError } from '../../notifications/telegram/api'
import { linkUrls } from '../../notifications/telegram/binder'

// Раздел «Уведомления»: что показать (без секретов), как менять получателей обеих аудиторий,
// бота Telegram и проверить каналы. Каналы — через их интерфейс (describe, check, label): общий
// код раздела о новых каналах не знает. Свои у Telegram только бот и привязка чатов — это его
// настройки. Права, схемы и повторный пароль — в routes.ts

/** Получатель для админки: адрес (почта или chat id), название чата и события */
export const recipientView = (row: StoredRecipient) => ({
  id: row.id,
  channel: row.channel,
  address: row.address,
  label: row.label,
  events: row.events,
  createdAt: row.createdAt,
})

/** Служебные события для админки: id, название и когда приходят */
export const serviceEvents = () =>
  ServiceEventId.options.map((id) => ({
    id,
    title: NOTIFICATION_EVENT_TITLES[id],
    hint: SERVICE_EVENT_HINTS[id],
  }))

/**
 * Каналы так, как их видит админка: включён ли, готов ли и почему нет, что канал рассказывает
 * о себе (describe — без секретов) и, владельцу, ждут ли его сообщения слишком долго
 */
export async function channelsView(db: Db, deps: NotifyDeps, view: 'owner' | 'site' = 'owner') {
  const configs = await channelConfigs(db, deps.channels, deps.secretBox)
  const stuck =
    view === 'owner'
      ? await notificationOutboxRepo(db).stuck(new Date(Date.now() - STUCK_AFTER_MS))
      : []
  return Object.values(deps.channels).map((channel) => {
    const config = configs.get(channel.kind)
    const ready = config
      ? channel.ready(config, deps.readiness)
      : { ok: false as const, reason: 'Канал не настроен' }
    return {
      kind: channel.kind,
      title: channel.title,
      enabled: config?.enabled ?? channel.defaultEnabled,
      ready: ready.ok,
      reason: ready.ok ? null : ready.reason,
      skips: [...channel.skips],
      details: config ? channel.describe(config, view) : null,
      warning: stuckWarning(
        deps.channels,
        stuck.filter((item) => item.channel === channel.kind),
      ),
    }
  })
}

/** Почему бота Telegram не поменять: без ключа шифрования токен хранить негде */
export const telegramLock = (deps: NotifyDeps) =>
  deps.secretBox
    ? null
    : 'Чтобы хранить токен бота в базе, API нужен ключ шифрования MAIL_ENCRYPTION_KEY (тот же, что для пароля SMTP): 32 случайных байта в base64, например openssl rand -base64 32. Впишите его в окружение API и перезапустите API'

/** Готов ли Telegram и кто бот: для ссылок привязки */
export async function telegramBot(db: Db, deps: NotifyDeps) {
  const configs = await channelConfigs(db, deps.channels, deps.secretBox)
  const config = configs.get('telegram')
  if (!config) return undefined
  const ready = deps.channels.telegram.ready(config, deps.readiness)
  const settings = telegramSettingsOf(config)
  return ready.ok && settings ? settings : undefined
}

/** Ссылки привязки для ответа API: код показывается один раз */
export const linkView = (
  botUsername: string,
  link: { id: string; code: string; expiresAt: Date },
) => ({
  id: link.id,
  code: link.code,
  expiresAt: link.expiresAt,
  links: linkUrls(botUsername, link.code),
})

/**
 * Что стало с кодом привязки: ждёт «Старт», привязал чат или истёк. problem — почему опрос
 * Telegram сейчас не идёт (webhook у бота, нет сети): ждать «Старт» тогда бесполезно
 */
export async function linkStatus(
  db: Db,
  id: string,
  siteId: AudienceSite,
  now: Date,
  problem: string | null,
) {
  const repo = notificationSettingsRepo(db)
  const link = await repo.linkCode(id, siteId)
  if (!link) return undefined
  if (link.recipientId) {
    const recipient = await repo.recipient(siteId, link.recipientId)
    return {
      status: 'bound' as const,
      recipient: recipient ? recipientView(recipient) : null,
      problem: null,
    }
  }
  if (link.usedAt || link.expiresAt <= now) {
    return { status: 'expired' as const, recipient: null, problem: null }
  }
  return { status: 'waiting' as const, recipient: null, problem }
}

/**
 * Адреса почты получателей заявок сайта: заменить списком. Чаты не трогаем. Набор сменился —
 * уведомление владельцам и прежним получателям (changeLeadRecipients)
 */
export function replaceLeadEmails(
  db: Db,
  deps: NotifyDeps,
  { siteId, addresses, user }: { siteId: string; addresses: string[]; user: SessionUser },
) {
  const now = new Date()
  const repo = notificationSettingsRepo(db)
  return changeLeadRecipients(db, deps, { siteId, actor: user, now }, async (tx) => {
    await removeEmailsExcept(tx, siteId, addresses)
    for (const address of addresses) {
      await repo.addRecipient(tx, {
        siteId,
        channel: deps.channels.email,
        address,
        events: ['lead.new'],
        createdBy: user.id,
        now,
      })
    }
  })
}

/** Удалить адреса почты аудитории, которых нет в списке */
async function removeEmailsExcept(tx: DbOrTx, siteId: AudienceSite, keep: string[]) {
  await tx
    .delete(notificationRecipients)
    .where(
      and(
        siteId === null
          ? isNull(notificationRecipients.siteId)
          : eq(notificationRecipients.siteId, siteId),
        eq(notificationRecipients.channel, 'email'),
        ...(keep.length > 0 ? [notInArray(notificationRecipients.address, keep)] : []),
      ),
    )
}

/** Служебные адреса почты с событиями: заменить списком */
export async function replaceServiceEmails(
  db: Db,
  deps: NotifyDeps,
  { recipients, user }: { recipients: { address: string; events: string[] }[]; user: SessionUser },
) {
  const now = new Date()
  const repo = notificationSettingsRepo(db)
  await db.transaction(async (tx) => {
    await removeEmailsExcept(
      tx,
      null,
      recipients.map((item) => item.address),
    )
    const existing = new Map(
      (await repo.recipients(null, tx))
        .filter((row) => row.channel === 'email')
        .map((row) => [row.address, row]),
    )
    for (const item of recipients) {
      const row = existing.get(item.address)
      if (row) await repo.setEvents(tx, row.id, item.events)
      else {
        await repo.addRecipient(tx, {
          siteId: null,
          channel: deps.channels.email,
          address: item.address,
          events: item.events,
          createdBy: user.id,
          now,
        })
      }
    }
  })
  return repo.recipients(null)
}

/** Отвязать получателя аудитории: ждущие ему сообщения удаляются вместе с ним */
export async function removeRecipient(
  db: Db,
  deps: NotifyDeps,
  { siteId, id, user }: { siteId: AudienceSite; id: string; user: RecipientsActor },
) {
  const repo = notificationSettingsRepo(db)
  const remove = async (tx: DbOrTx) => {
    const row = await repo.recipient(siteId, id, tx)
    if (!row) return false
    await dropPendingFor(tx, row.id)
    await repo.removeRecipient(tx, row.id)
    return true
  }
  if (siteId === null) return db.transaction(remove)
  const changed = await changeLeadRecipients(
    db,
    deps,
    { siteId, actor: user, now: new Date() },
    remove,
  )
  return changed?.result ?? false
}

/**
 * Отвязать всех получателей канала во всех аудиториях — в транзакции вызывающего (вместе
 * с сохранением нового бота): сменился или удалён бот, и прежним чатам новый бот писать не
 * может. Ждущие сообщения канала удаляются. О смене получателей заявок — одно уведомление на
 * сайт, владельцам и прежним получателям других каналов, но не прежним чатам: им новый бот не
 * доставит. Сколько отвязано
 */
export async function dropChannelRecipients(
  tx: DbOrTx,
  deps: NotifyDeps,
  kind: NotificationChannelKind,
  actor: RecipientsActor,
  now: Date,
) {
  const rows = await tx
    .select({ id: notificationRecipients.id, siteId: notificationRecipients.siteId })
    .from(notificationRecipients)
    .where(eq(notificationRecipients.channel, kind))
  await dropPendingOfChannel(tx, kind)
  const dropIn = (siteId: AudienceSite) => (inner: DbOrTx) =>
    inner
      .delete(notificationRecipients)
      .where(
        and(
          eq(notificationRecipients.channel, kind),
          siteId === null
            ? isNull(notificationRecipients.siteId)
            : eq(notificationRecipients.siteId, siteId),
        ),
      )
  for (const siteId of new Set(rows.map((row) => row.siteId))) {
    if (siteId === null) {
      await dropIn(null)(tx)
      continue
    }
    await changeLeadRecipientsIn(
      tx,
      deps,
      { siteId, actor, now, unreachable: (row) => row.channel === kind },
      dropIn(siteId),
    )
  }
  return rows.length
}

/** Название сайта установки: в тестовом сообщении */
export async function installationName(db: DbOrTx, siteId: AudienceSite) {
  const [site] = siteId
    ? await db.select({ name: sites.name }).from(sites).where(eq(sites.id, siteId))
    : await db.select({ name: sites.name }).from(sites).orderBy(sites.createdAt).limit(1)
  return toMailLine(site?.name ?? 'Averra', 120, 'Averra')
}

const testData = async (db: DbOrTx, siteId: AudienceSite, user: SessionUser, now: Date) => ({
  siteName: await installationName(db, siteId),
  sentAt: now.toISOString(),
  by: toMailLine(user.name, 100, 'Пользователь'),
  byEmail: user.email,
})

/**
 * «Проверить» у аудитории: тестовое уведомление её получателям по готовым каналам — через
 * очередь, как настоящее. У заявок без готовых получателей — владельцам письмом, куда ушла бы
 * и «Новая заявка» (fallback: true)
 */
export async function sendTest(
  db: Db,
  deps: NotifyDeps,
  { siteId, user }: { siteId: AudienceSite; user: SessionUser },
) {
  const now = new Date()
  const rows = await notificationSettingsRepo(db).recipients(siteId)
  const targets = rows
    .filter((row) => row.channel in deps.channels)
    .map((row) => ({
      channel: row.channel as NotificationChannelKind,
      address: row.address,
      recipientId: row.id,
    }))
  const data = await testData(db, siteId, user, now)
  return db.transaction(async (tx) => {
    const queued = await notifyTargets(tx, deps, {
      event: 'notification.test',
      data,
      targets,
      ...(siteId ? { siteId } : {}),
      now,
    })
    if (queued > 0 || siteId === null) return { queued, fallback: false }
    const owners = await notifyTargets(tx, deps, {
      event: 'notification.test',
      data,
      targets: await ownerTargets(tx),
      siteId,
      now,
    })
    return { queued: owners, fallback: owners > 0 }
  })
}

/**
 * «Проверить» у канала: проверка — дело адаптера (check). Ядро даёт ему получателей канала
 * во всех аудиториях и способ поставить тестовое уведомление через очередь
 */
export async function checkChannel(
  db: Db,
  deps: NotifyDeps,
  kind: NotificationChannelKind,
  user: SessionUser,
): Promise<ChannelCheckResult & { queued: number }> {
  const channel = deps.channels[kind]
  const configs = await channelConfigs(db, deps.channels, deps.secretBox)
  const config = configs.get(kind)
  if (!config) return { ok: false, queued: 0, steps: [] }
  const recipients = await db
    .select({ address: notificationRecipients.address, label: notificationRecipients.label })
    .from(notificationRecipients)
    .where(eq(notificationRecipients.channel, kind))
    .orderBy(notificationRecipients.createdAt)
  const now = new Date()
  let queued = 0
  const result = await channel.check(config, {
    readiness: deps.readiness,
    user,
    installation: await installationName(db, null),
    recipients,
    async queueTest(addresses) {
      const data = await testData(db, null, user, now)
      const count = await db.transaction((tx) =>
        notifyTargets(tx, deps, {
          event: 'notification.test',
          data,
          targets: addresses.map((address) => ({ channel: kind, address })),
          now,
        }),
      )
      queued += count
      return count
    },
  })
  return { ...result, queued }
}

/** Сколько ещё чатов можно привязать к аудитории */
export async function chatsLeft(db: Db, siteId: AudienceSite, max: number) {
  const rows = await db
    .select({ id: notificationRecipients.id })
    .from(notificationRecipients)
    .where(
      and(
        siteId === null
          ? isNull(notificationRecipients.siteId)
          : eq(notificationRecipients.siteId, siteId),
        eq(notificationRecipients.channel, 'telegram'),
      ),
    )
  return max - rows.length
}

/** Сохранить бота: что не так (у какого поля) или кто бот и сколько чатов прежнего бота отвязано */
export type SaveTelegramResult =
  | { ok: true; bot: { username: string; name: string }; dropped: number }
  | { ok: false; path: 'token' | 'proxy'; message: string }

/**
 * Сохранить токен и прокси (пароль владельца уже проверен; прокси keep — оставить сохранённый).
 * Токен проверяется getMe через тот же прокси: без имени бота не собрать ссылки привязки,
 * а неработающий токен сохранять незачем. Пустой токен — оставить сохранённый. Сменился бот —
 * чаты прежнего отвязываются в той же транзакции, в которой ложится новый: новому боту они не
 * писали, и он им писать не может
 */
export async function saveTelegram(
  db: Db,
  deps: NotifyDeps,
  notifications: NotificationDeps,
  {
    token,
    proxy: proxyInput,
    user,
  }: { token: string; proxy: string | null | 'keep'; user: SessionUser },
): Promise<SaveTelegramResult> {
  const { secretBox } = deps
  if (!secretBox) throw new Error('Без ключа шифрования токен бота не сохранить')
  const configs = await channelConfigs(db, deps.channels, secretBox)
  const config = configs.get('telegram')
  const saved = config ? telegramConnectionOf(config) : undefined
  const previous = config ? telegramSettingsOf(config) : undefined
  if (!token && !saved) {
    return { ok: false, path: 'token', message: 'Введите токен бота от @BotFather' }
  }
  const proxy = proxyInput === 'keep' ? (saved?.proxy ?? null) : proxyInput
  // Схема пропустила, а URL прочтёт иначе (или не прочтёт): ошибка у поля, а не 500 с адресом
  // прокси (и паролем) в журнале. До сети: через такой прокси не ходим
  if (proxy && !parseProxy(proxy)) {
    return { ok: false, path: 'proxy', message: PROXY_UNPARSED }
  }
  const connection = { token: token || (saved?.token ?? ''), proxy }
  const api = notifications.telegram(connection)
  let bot: { id: number; username: string; name: string }
  try {
    bot = await api.getMe()
  } catch (error) {
    if (!(error instanceof TelegramApiError)) throw error
    return { ok: false, path: error.kind === 'network' ? 'proxy' : 'token', message: error.message }
  } finally {
    await api.close().catch(() => {})
  }
  const now = new Date()
  const dropped = await db.transaction(async (tx) => {
    const count =
      previous && previous.botId !== bot.id
        ? await dropChannelRecipients(tx, deps, 'telegram', user, now)
        : 0
    await notificationSettingsRepo(tx).saveChannel(
      tx,
      'telegram',
      {
        settings: {
          botId: bot.id,
          botUsername: bot.username,
          botName: toMailLine(bot.name, 100, bot.username),
          proxy: proxy ? proxyForDisplay(proxy) : null,
        },
        secretEncrypted: secretBox.encrypt(
          JSON.stringify(connection),
          channelSecretContext('telegram'),
        ),
        updatedBy: user.id,
      },
      now,
      deps.channels.telegram.defaultEnabled,
    )
    return count
  })
  return { ok: true, bot: { username: bot.username, name: bot.name }, dropped }
}

/** Удалить бота: токен и прокси стираются, чаты отвязываются — одной транзакцией */
export function removeTelegram(db: Db, deps: NotifyDeps, user: SessionUser) {
  const now = new Date()
  return db.transaction(async (tx) => {
    const dropped = await dropChannelRecipients(tx, deps, 'telegram', user, now)
    await notificationSettingsRepo(tx).saveChannel(
      tx,
      'telegram',
      { settings: {}, secretEncrypted: null, updatedBy: user.id },
      now,
      deps.channels.telegram.defaultEnabled,
    )
    return dropped
  })
}
