import type { NotificationChannelKind } from '@averra/schema'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { sites } from '../db/schema'
import type { DbOrTx } from '../mail/outbox'
import { toMailLine } from '../mail/templates/line'
import type { ChannelRegistry } from './channel'
import { carries, type NotifyDeps, notifyTargets, ownerTargets } from './notify'
import { notificationOutboxRepo } from './outbox'
import { channelConfigs, notificationSettingsRepo, type StoredRecipient } from './settings'

// Получатели уведомлений о заявках сайта: их меняют владелец и клиент, а в уведомлениях —
// персональные данные посетителей. Любая смена (адреса почты, привязка и отвязка чата) идёт
// через changeLeadRecipients: в той же транзакции владельцы и прежние получатели узнают, куда
// теперь уходят заявки, а устаревшая колонка sites.lead_recipients остаётся в согласии.
// Каналы здесь — только через интерфейс: получателя называет его канал (label)

/** Кто меняет: имя и почта уйдут в уведомление о смене */
export type RecipientsActor = { name: string; email: string }

const keyOf = (row: Pick<StoredRecipient, 'channel' | 'address'>) => `${row.channel}:${row.address}`

/** Получатель словами своего канала: адрес почты, «Telegram «чат»». Канала нет — как есть */
export function recipientLabel(
  channels: ChannelRegistry,
  row: Pick<StoredRecipient, 'channel' | 'address' | 'label'>,
) {
  const channel = channels[row.channel as NotificationChannelKind] as
    | ChannelRegistry[NotificationChannelKind]
    | undefined
  return toMailLine(
    channel ? channel.label({ address: row.address, label: row.label }) : row.address,
    140,
    row.address,
  )
}

export type ChangeOptions = {
  siteId: string
  actor: RecipientsActor
  now: Date
  /**
   * Прежние получатели, которым о смене не писать: сменился бот, и прежним чатам новый бот
   * написать не может — сообщение было бы заведомо недоставленным
   */
  unreachable?: (row: StoredRecipient) => boolean
}

/**
 * Смена получателей заявок сайта в транзакции вызывающего: change меняет строки, а если набор
 * получателей стал другим — уведомление владельцам и прежним получателям (по всем каналам).
 * undefined — сайта нет
 */
export async function changeLeadRecipientsIn<T>(
  tx: DbOrTx,
  deps: NotifyDeps,
  { siteId, actor, now, unreachable = () => false }: ChangeOptions,
  change: (tx: DbOrTx) => Promise<T>,
): Promise<{ result: T; notified: number } | undefined> {
  const repo = notificationSettingsRepo(tx as Db)
  // Две смены одного сайта идут по очереди: каждая видит, что было до неё
  const [site] = await tx
    .select({ name: sites.name })
    .from(sites)
    .where(eq(sites.id, siteId))
    .for('update')
  if (!site) return undefined
  const before = await repo.recipients(siteId, tx)
  const result = await change(tx)
  const after = await repo.recipients(siteId, tx)
  await repo.syncLegacyLeadRecipients(tx, siteId)
  const same = before.map(keyOf).sort().join('\n') === after.map(keyOf).sort().join('\n')
  if (same) return { result, notified: 0 }
  const targets = [
    ...(await ownerTargets(tx)),
    ...before
      .filter((row) => row.channel in deps.channels && !unreachable(row))
      .map((row) => ({ channel: row.channel as NotificationChannelKind, address: row.address })),
  ]
  const notified = await notifyTargets(tx, deps, {
    event: 'lead.recipients_changed',
    data: {
      siteName: toMailLine(site.name, 80, 'сайт'),
      changedBy: toMailLine(actor.name, 100, 'Пользователь'),
      changedByEmail: actor.email,
      changedAt: now.toISOString(),
      targets: after.map((row) => recipientLabel(deps.channels, row)),
    },
    targets,
    siteId,
    now,
    // Клиент мог перенаправить заявки: владелец узнает об этом, даже если выключил флажком
    // уведомления почтой (защита шага 3.4) — лишь бы почта установки работала
    security: true,
  })
  return { result, notified }
}

/** То же своей транзакцией: смена получателей и уведомление о ней ложатся вместе */
export function changeLeadRecipients<T>(
  db: Db,
  deps: NotifyDeps,
  options: ChangeOptions,
  change: (tx: DbOrTx) => Promise<T>,
) {
  return db.transaction((tx) => changeLeadRecipientsIn(tx, deps, options, change))
}

/** Дольше этого сообщения канала ждут отправки — канал, похоже, не работает */
export const STUCK_AFTER_MS = 15 * 60 * 1000

/**
 * Куда сейчас уходят уведомления о заявках сайта — для раздела «Заявки»: готовые получатели
 * или, если их нет, владельцы письмом. enabled: false — не уходят вовсе (почта выключена,
 * Telegram не настроен), reason — почему. warning — канал настроен, но сообщения в нём ждут
 * дольше 15 минут (Telegram недоступен с VPS, токен отозван)
 */
export async function leadNotificationSummary(db: Db, deps: NotifyDeps, siteId: string) {
  const rows = await notificationSettingsRepo(db).subscribed(siteId, 'lead.new')
  const configs = await channelConfigs(db, deps.channels, deps.secretBox)
  const reachable = rows.filter(
    (row) =>
      row.channel in deps.channels &&
      carries(deps, configs, row.channel as NotificationChannelKind, 'lead.new'),
  )
  if (reachable.length > 0) {
    const stuck = await notificationOutboxRepo(db).stuck(new Date(Date.now() - STUCK_AFTER_MS), [
      ...new Set(reachable.map((row) => row.channel)),
    ])
    return {
      enabled: true,
      reason: null,
      recipients: 'custom' as const,
      targets: reachable.map((row) => recipientLabel(deps.channels, row)),
      warning: stuckWarning(deps.channels, stuck),
    }
  }
  const email = configs.get('email')
  const emailReady = email ? deps.channels.email.ready(email, deps.readiness) : undefined
  if (emailReady?.ok) {
    return {
      enabled: true,
      reason: null,
      recipients: 'owners' as const,
      targets: [],
      warning: null,
    }
  }
  return {
    enabled: false,
    reason: emailReady && !emailReady.ok ? emailReady.reason : 'Каналы уведомлений не настроены',
    recipients: rows.length > 0 ? ('custom' as const) : ('owners' as const),
    targets: [],
    warning: null,
  }
}

/** Сообщения, которые ждут слишком долго, словами: какой канал и последняя ошибка */
export function stuckWarning(
  channels: ChannelRegistry,
  stuck: readonly { channel: string; count: number; lastError: string | null }[],
) {
  if (stuck.length === 0) return null
  return stuck
    .map(({ channel, count, lastError }) => {
      const title = channels[channel as NotificationChannelKind]?.title ?? channel
      return `${title}: ${count} сообщ. ждут отправки дольше 15 минут${lastError ? ` — ${lastError}` : ''}`
    })
    .join('; ')
}
