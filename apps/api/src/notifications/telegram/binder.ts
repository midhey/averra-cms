import { NOTIFICATION_CHATS_MAX, ServiceEventId, TELEGRAM_LINK_TTL_MINUTES } from '@averra/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { notificationRecipients, sites, users } from '../../db/schema'
import type { DbOrTx } from '../../mail/outbox'
import { toMailLine } from '../../mail/templates/line'
import { sha256 } from '../../secrets'
import { telegramConnectionOf, telegramSettingsOf } from '../channels/telegram'
import type { NotifyDeps } from '../notify'
import { changeLeadRecipients } from '../recipients'
import { type AudienceSite, channelConfigs, notificationSettingsRepo } from '../settings'
import {
  type TelegramApi,
  TelegramApiError,
  type TelegramApiFactory,
  type TelegramChat,
  type TelegramUpdate,
} from './api'
import { escapeTelegramHtml } from './format'

// Привязка чата Telegram без ввода chat id руками. Админка выдаёт одноразовый код и ссылку
// t.me/<бот>?start=<код>; человек жмёт «Старт» — бот получает «/start <код>». Пока есть живые
// коды, API опрашивает getUpdates (длинный опрос), а когда их нет — не опрашивает вовсе. Webhook
// не нужен: ни входящего адреса в Caddy, ни секрета webhook, и работает через исходящий прокси.
//
// offset getUpdates живёт только в пределах сеанса привязки и одного бота. После недели без
// обновлений Telegram выбирает следующий update_id случайно, а у другого бота id свои: старый
// offset оказался бы больше нового id, и Telegram счёл бы «Старт» подтверждённым — молча выбросил.
// Поэтому сеанс кончился — обработанное подтверждается и offset забывается, сменился бот — тоже

/** Срок кода привязки */
export const LINK_TTL_MS = TELEGRAM_LINK_TTL_MINUTES * 60 * 1000

/** Сколько последних обработанных update_id помнить, чтобы не обработать их дважды */
const SEEN_MAX = 200

/** Код в ссылке: 16 случайных байт в base64url — 22 знака из тех, что пускает start= */
export function newLinkCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/** Ссылки на бота с кодом: личный чат и группа (бот добавится в выбранную группу) */
export const linkUrls = (botUsername: string, code: string) => ({
  chat: `https://t.me/${botUsername}?start=${code}`,
  group: `https://t.me/${botUsername}?startgroup=${code}`,
})

/** «/start КОД» или «/start@бот КОД» (так команда приходит в группу) */
const START = /^\/start(?:@([A-Za-z0-9_]+))?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/

/** Название чата для админки: у группы — название, у личного — имя или @логин */
export function chatLabel(chat: TelegramChat) {
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ')
  const label = chat.title ?? (name || (chat.username ? `@${chat.username}` : `Чат ${chat.id}`))
  return toMailLine(label, 100, `Чат ${chat.id}`)
}

const replies = {
  noCode:
    'Чтобы получать уведомления Averra, откройте ссылку «Привязать чат» в админке: раздел «Уведомления».',
  badCode:
    'Код не подошёл: он устарел или уже использован. Получите новую ссылку в админке Averra — раздел «Уведомления».',
  tooMany: `К уведомлениям уже привязано ${NOTIFICATION_CHATS_MAX} чатов. Отвяжите лишний в админке и получите новую ссылку.`,
  already: 'Этот чат уже получает эти уведомления.',
  leads: (site: string) =>
    `Готово: этот чат получает уведомления о новых заявках сайта «${site}». Отвязать — в админке, раздел «Уведомления».`,
  service: (site: string) =>
    `Готово: этот чат получает служебные уведомления установки «${site}» (бэкапы, диск, сборки, почта). Отвязать — в админке, раздел «Уведомления».`,
}

/**
 * Чат не привязан, но код ни при чём (чат уже получает, чатов уже десять): транзакция с тратой
 * кода откатывается, и тот же код можно открыть в другом чате, пока он жив
 */
class KeepCode extends Error {
  constructor(readonly outcome: 'already' | 'too_many') {
    super(outcome)
  }
}

export type BinderOptions = {
  db: Db
  /** Каналы, ключ секретов и состояние почты: привязка к заявкам уведомляет о смене получателей */
  deps: () => NotifyDeps
  telegram: TelegramApiFactory
  now?: () => Date
  log?: (message: string) => void
  /** Сколько секунд Telegram держит длинный опрос */
  pollTimeoutSec?: number
  /** Пауза после сбоя опроса */
  retryMs?: number
}

export function telegramBinder({
  db,
  deps,
  telegram,
  now = () => new Date(),
  log = () => {},
  pollTimeoutSec = 25,
  retryMs = 5000,
}: BinderOptions) {
  const repo = notificationSettingsRepo(db)
  // Курсор сеанса: чей бот (токен) и следующий offset — getUpdates с ним подтверждает всё до него
  let cursor: { token: string; offset: number } | undefined
  // Обработанные update_id бота (token). Если подтверждение не дошло до Telegram, следующий
  // сеанс без offset получит их снова — второй раз «Старт» не обрабатываем: уже привязанный
  // чат получил бы «Код не подошёл»
  let seen: { token: string; ids: number[] } = { token: '', ids: [] }
  // Почему последний опрос не удался: пока не прошёл следующий, админка показывает это у кода
  let problem: string | null = null

  async function audienceName(siteId: AudienceSite) {
    const [site] = siteId
      ? await db.select({ name: sites.name }).from(sites).where(eq(sites.id, siteId))
      : await db.select({ name: sites.name }).from(sites).orderBy(sites.createdAt).limit(1)
    return toMailLine(site?.name ?? 'Averra', 80, 'Averra')
  }

  async function chatsIn(tx: DbOrTx, siteId: AudienceSite) {
    const rows = await tx
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
    return rows.length
  }

  /**
   * Привязать чат кодом. Код тратится в той же транзакции, что ложится получатель, — условием
   * «не использован и не истёк» в UPDATE: дважды один код не сработает. Код клиента ведёт
   * только к заявкам его сайта: аудитория записана в коде, а не приходит из чата
   */
  async function bind(code: string, chat: TelegramChat) {
    const at = now()
    const hash = await sha256(code)
    const peeked = await repo.peekLinkCode(hash, 'telegram', at)
    if (!peeked?.createdBy) return replies.badCode
    const [creator] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, peeked.createdBy))
    if (!creator) return replies.badCode
    const siteId = peeked.siteId
    const address = String(chat.id)

    type Outcome = 'bound' | 'already' | 'too_many' | 'bad_code'
    const attach = async (tx: DbOrTx): Promise<Outcome> => {
      const used = await repo.consumeLinkCode(tx, hash, 'telegram', at)
      if (!used) return 'bad_code'
      if ((await chatsIn(tx, siteId)) >= NOTIFICATION_CHATS_MAX) throw new KeepCode('too_many')
      const row = await repo.addRecipient(tx, {
        siteId,
        channel: deps().channels.telegram,
        address,
        label: chatLabel(chat),
        events: siteId === null ? [...ServiceEventId.options] : ['lead.new'],
        createdBy: peeked.createdBy,
        now: at,
      })
      if (!row) throw new KeepCode('already')
      await repo.attachLinkCode(tx, used.id, row.id)
      return 'bound'
    }

    let outcome: Outcome
    try {
      if (siteId === null) {
        outcome = await db.transaction(attach)
      } else {
        const changed = await changeLeadRecipients(
          db,
          deps(),
          { siteId, actor: creator, now: at },
          attach,
        )
        outcome = changed?.result ?? 'bad_code'
      }
    } catch (error) {
      if (!(error instanceof KeepCode)) throw error
      outcome = error.outcome
    }
    if (outcome === 'bad_code') return replies.badCode
    if (outcome === 'too_many') return replies.tooMany
    if (outcome === 'already') return replies.already
    log(
      `Telegram: чат ${address} привязан к ${siteId === null ? 'служебным уведомлениям' : `заявкам сайта ${siteId}`}`,
    )
    const name = await audienceName(siteId)
    return siteId === null ? replies.service(name) : replies.leads(name)
  }

  /** Одно обновление: «/start КОД» — привязать и ответить, остальное — мимо */
  async function handle(api: TelegramApi, botUsername: string, update: TelegramUpdate) {
    const message = update.message
    if (!message?.text) return
    const match = START.exec(message.text.trim())
    if (!match) return
    const [, mention, code] = match
    if (mention && mention.toLowerCase() !== botUsername.toLowerCase()) return
    // Старое «Старт» (опрос не шёл, пока не было кодов): его код всё равно истёк — молчим
    if (now().getTime() - message.date * 1000 > LINK_TTL_MS) return
    const reply = code ? await bind(code, message.chat) : replies.noCode
    // sendMessage шлёт с parse_mode HTML, а в ответе — название сайта: «<» и «&» в нём — текст
    await api
      .sendMessage(String(message.chat.id), escapeTelegramHtml(reply))
      .catch((error: unknown) => {
        log(`Telegram: не удалось ответить в чат ${message.chat.id}: ${String(error)}`)
      })
  }

  /** Бот из настроек канала: подключение и имя. Нет — Telegram не настроен */
  async function bot() {
    const configs = await channelConfigs(db, deps().channels, deps().secretBox)
    const config = configs.get('telegram')
    if (!config) return undefined
    const connection = telegramConnectionOf(config)
    const settings = telegramSettingsOf(config)
    return connection && settings ? { connection, username: settings.botUsername } : undefined
  }

  /**
   * Сеанс кончился: подтвердить обработанное (иначе следующий сеанс получит его снова) и забыть
   * offset. Сбой подтверждения — не повод опрашивать дальше: кодов нет, а дубли отсеет seen
   */
  async function finishSession(current: Awaited<ReturnType<typeof bot>>) {
    const done = cursor
    cursor = undefined
    if (!current || !done || done.token !== current.connection.token) return
    const api = telegram(current.connection)
    try {
      await api.getUpdates({ offset: done.offset, timeoutSec: 0 })
    } catch (error) {
      log(
        `Telegram: не удалось подтвердить обработанные обновления, следующий опрос отсеет их сам: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      await api.close().catch(() => {})
    }
  }

  /** Обновление этого бота уже обработано (запоминает его, если нет) */
  function handledBefore(token: string, updateId: number) {
    if (seen.token !== token) seen = { token, ids: [] }
    if (seen.ids.includes(updateId)) return true
    seen.ids.push(updateId)
    if (seen.ids.length > SEEN_MAX) seen.ids.shift()
    return false
  }

  /**
   * Один опрос getUpdates. idle — опрашивать незачем (нет живых кодов или бота): сеанс кончился,
   * обработанное подтверждается, offset забывается
   */
  async function pollOnce(signal?: AbortSignal): Promise<'idle' | 'polled'> {
    const current = await bot()
    const active = current && (await repo.hasActiveLinkCodes('telegram', now()))
    if (!current || !active) {
      problem = null
      await finishSession(current)
      return 'idle'
    }
    const { token } = current.connection
    // Сменился бот: offset прежнего к нему не относится
    if (cursor && cursor.token !== token) cursor = undefined
    const api = telegram(current.connection)
    try {
      let updates: TelegramUpdate[]
      try {
        updates = await api.getUpdates({
          ...(cursor ? { offset: cursor.offset } : {}),
          timeoutSec: pollTimeoutSec,
          ...(signal ? { signal } : {}),
        })
        problem = null
      } catch (error) {
        // Остановка — не сбой. Остальное админка покажет у ждущего кода: иначе человек жал бы
        // «Старт», а экран молча ждал до конца срока (webhook у бота — 409, нет сети, прокси)
        if (!signal?.aborted) {
          problem =
            error instanceof TelegramApiError
              ? error.message
              : 'Не удалось получить ответ от Telegram: подробности — в журнале API'
        }
        throw error
      }
      for (const update of updates) {
        cursor = { token, offset: update.update_id + 1 }
        if (handledBefore(token, update.update_id)) continue
        await handle(api, current.username, update)
      }
      return 'polled'
    } finally {
      await api.close()
    }
  }

  let running: Promise<void> | undefined
  let stopped = false
  let abort: AbortController | undefined

  async function loop() {
    while (!stopped) {
      abort = new AbortController()
      try {
        if ((await pollOnce(abort.signal)) === 'idle') return
      } catch (error) {
        if (stopped) return
        log(
          `Telegram: опрос обновлений не удался: ${error instanceof Error ? error.message : String(error)}`,
        )
        await new Promise((resolve) => setTimeout(resolve, retryMs))
      }
    }
  }

  return {
    bind,
    handle,
    pollOnce,
    /** Почему опрос Telegram сейчас не идёт (текст для админки) или null — идёт */
    problem: () => problem,
    /** Выдан код: начать опрос, если он не идёт */
    wake() {
      if (stopped || running) return
      running = loop().finally(() => {
        running = undefined
      })
    },
    async stop() {
      stopped = true
      abort?.abort()
      await running?.catch(() => {})
    },
  }
}

export type TelegramBinder = ReturnType<typeof telegramBinder>

/** Новый код привязки: в базу — хеш, наружу — код и срок */
export async function issueLinkCode(
  db: Db,
  { siteId, createdBy, now }: { siteId: AudienceSite; createdBy: string; now: Date },
) {
  const code = newLinkCode()
  const row = await notificationSettingsRepo(db).createLinkCode(db, {
    codeHash: await sha256(code),
    channel: 'telegram',
    siteId,
    createdBy,
    now,
    expiresAt: new Date(now.getTime() + LINK_TTL_MS),
  })
  return { id: row.id, code, expiresAt: row.expiresAt }
}
