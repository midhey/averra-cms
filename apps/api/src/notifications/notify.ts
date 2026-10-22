import type { NotificationChannelKind } from '@averra/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { SecretBox } from '../crypto/secret-box'
import { notificationRecipients, users } from '../db/schema'
import type { DbOrTx } from '../mail/outbox'
import type {
  ChannelConfig,
  ChannelRegistry,
  NotificationTarget,
  ReadinessContext,
} from './channel'
import { type EventData, type EventId, notificationEvents, parseEventData } from './events'
import { channelConfigs } from './settings'

// Ядро модуля уведомлений: событие → получатели → каналы. Знает каналы только через интерфейс
// (channel.ts). Ставит в очередь в транзакции действия: заявка и задача уведомить о ней
// ложатся вместе или не ложатся вовсе

/** Что нужно ядру кроме транзакции: каналы, ключ секретов и состояние почты процесса */
export type NotifyDeps = {
  channels: ChannelRegistry
  secretBox: SecretBox | undefined
  readiness: ReadinessContext
}

type Common = {
  /** Сайт: у событий заявок — аудитория. У служебных — нет */
  siteId?: string | undefined
  leadId?: string | undefined
  now: Date
}

/** Цель с каналом: явные получатели (владельцы, прежние получатели, проверка) */
export type ChannelTarget = NotificationTarget & { channel: NotificationChannelKind }

/**
 * Готов ли канал везти это событие: включён, настроен и событие ему не чужое. security —
 * предупреждение о безопасности (смена получателей заявок): флажок канала «вкл/выкл» его не
 * держит, как и письмо сброса пароля, — нужно только, чтобы канал работал
 */
export function carries(
  deps: NotifyDeps,
  configs: Map<NotificationChannelKind, ChannelConfig>,
  kind: NotificationChannelKind,
  event: EventId,
  security = false,
) {
  const channel = deps.channels[kind]
  const config = configs.get(kind)
  if (!config || channel.skips.includes(event)) return false
  return channel.ready(security ? { ...config, enabled: true } : config, deps.readiness).ok
}

/** Поставить событие явным получателям: по каналам, готовым его везти. Сколько поставлено */
export async function notifyTargets<E extends EventId>(
  tx: DbOrTx,
  deps: NotifyDeps,
  input: Common & {
    event: E
    data: EventData<E>
    targets: readonly ChannelTarget[]
    /** Предупреждение о безопасности: уходит и по выключенному флажком каналу (carries) */
    security?: boolean
  },
) {
  const data = parseEventData(input.event, input.data)
  const configs = await channelConfigs(tx, deps.channels, deps.secretBox)
  let queued = 0
  for (const channel of Object.values(deps.channels)) {
    const targets = input.targets.filter((target) => target.channel === channel.kind)
    if (
      targets.length === 0 ||
      !carries(deps, configs, channel.kind, input.event, input.security ?? false)
    ) {
      continue
    }
    // Один адрес — одно сообщение, даже если он попал в список дважды (владелец и прежний адрес)
    const unique = [...new Map(targets.map((target) => [target.address, target])).values()]
    await channel.enqueue(
      { tx, now: input.now, siteId: input.siteId, leadId: input.leadId },
      { event: input.event, data },
      unique,
    )
    queued += unique.length
  }
  return queued
}

/** Почта всех владельцев админки: им уходят заявки, когда других получателей нет */
export async function ownerTargets(tx: DbOrTx): Promise<ChannelTarget[]> {
  const rows = await tx.select({ email: users.email }).from(users).where(eq(users.role, 'owner'))
  return rows.map((row) => ({ channel: 'email', address: row.email }))
}

/**
 * Событие — подписанным получателям своей аудитории (заявки — получателям сайта, служебные —
 * получателям установки) по каналам, готовым его везти. Заявка без единого готового получателя
 * уходит владельцам письмом, как до модуля уведомлений: молча она не теряется
 */
export async function notify<E extends EventId>(
  tx: DbOrTx,
  deps: NotifyDeps,
  input: Common & { event: E; data: EventData<E> },
) {
  const definition = notificationEvents[input.event]
  const siteId = definition.audience === 'leads' ? (input.siteId ?? null) : null
  if (definition.audience === 'leads' && siteId === null) {
    throw new Error(`Событию «${input.event}» нужен сайт: это уведомление о его заявках`)
  }
  const recipients = await tx
    .select()
    .from(notificationRecipients)
    .where(
      and(
        siteId === null
          ? isNull(notificationRecipients.siteId)
          : eq(notificationRecipients.siteId, siteId),
        sql`${notificationRecipients.events} @> ${JSON.stringify([input.event])}::jsonb`,
      ),
    )
  const configs = await channelConfigs(tx, deps.channels, deps.secretBox)
  const targets: ChannelTarget[] = recipients
    .filter((row) => row.channel in deps.channels)
    .map((row) => ({
      channel: row.channel as NotificationChannelKind,
      address: row.address,
      recipientId: row.id,
    }))
  const reachable = targets.filter((target) => carries(deps, configs, target.channel, input.event))
  const fallback = definition.audience === 'leads' && reachable.length === 0
  const queued = await notifyTargets(tx, deps, {
    ...input,
    targets: fallback ? await ownerTargets(tx) : reachable,
  })
  return { queued, fallback }
}
