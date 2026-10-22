import type { NotificationChannelKind } from '@averra/schema'
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { type SecretBox, SecretBoxError } from '../crypto/secret-box'
import {
  notificationChannels,
  notificationLinkCodes,
  notificationRecipients,
  sites,
} from '../db/schema'
import type { DbOrTx } from '../mail/outbox'
import {
  type ChannelConfig,
  type ChannelRegistry,
  channelSecretContext,
  type NotificationChannel,
} from './channel'

// Настройки модуля уведомлений в базе: каналы (вкл/выкл, открытые настройки, секрет), получатели
// по аудиториям и одноразовые коды привязки чатов. Без Node API: репозиторий видят маршруты

/** Аудитория в базе: сайт — получатели его заявок, null — служебные установки */
export type AudienceSite = string | null

const audienceIs = (column: AnyPgColumn, siteId: AudienceSite) =>
  siteId === null ? isNull(column) : eq(column, siteId)

export type StoredRecipient = typeof notificationRecipients.$inferSelect
export type StoredChannel = typeof notificationChannels.$inferSelect

const unreadable: Record<SecretBoxError['problem'], string> = {
  wrong_key:
    'Секрет канала зашифрован другим ключом: MAIL_ENCRYPTION_KEY сменился. Введите токен заново',
  corrupted: 'Секрет канала в базе повреждён: введите токен заново',
  format: 'Секрет канала в базе не в том формате: введите токен заново',
}

const NO_KEY =
  'API запущен без MAIL_ENCRYPTION_KEY: секрет канала не расшифровать. Верните прежний ключ ' +
  'в окружение API или введите токен заново после того, как зададите новый'

/** Настройки канала из строки базы: секрет расшифрован или почему нет */
export function channelConfigOf(
  kind: string,
  row: StoredChannel | undefined,
  secretBox: SecretBox | undefined,
  defaultEnabled: boolean,
): ChannelConfig {
  const base = { enabled: row?.enabled ?? defaultEnabled, settings: row?.settings ?? {} }
  if (!row?.secretEncrypted) return { ...base, secret: { state: 'none' } }
  if (!secretBox) return { ...base, secret: { state: 'unreadable', reason: NO_KEY } }
  try {
    const value = secretBox.decrypt(row.secretEncrypted, channelSecretContext(kind))
    return { ...base, secret: { state: 'ok', value } }
  } catch (error) {
    if (!(error instanceof SecretBoxError)) throw error
    return { ...base, secret: { state: 'unreadable', reason: unreadable[error.problem] } }
  }
}

/** Настройки всех каналов реестра — с расшифрованными секретами (в транзакции действия тоже) */
export async function channelConfigs(
  tx: DbOrTx,
  channels: ChannelRegistry,
  secretBox: SecretBox | undefined,
) {
  const rows = await tx.select().from(notificationChannels)
  const byKind = new Map(rows.map((row) => [row.kind, row]))
  const configs = new Map<NotificationChannelKind, ChannelConfig>()
  for (const channel of Object.values(channels)) {
    configs.set(
      channel.kind,
      channelConfigOf(channel.kind, byKind.get(channel.kind), secretBox, channel.defaultEnabled),
    )
  }
  return configs
}

export function notificationSettingsRepo(db: DbOrTx) {
  /** Строки каналов по виду: нет строки — канал по умолчанию */
  async function channelRows(tx: DbOrTx = db) {
    const rows = await tx.select().from(notificationChannels)
    return new Map(rows.map((row) => [row.kind, row]))
  }

  return {
    channelRows,

    /** Настройки всех каналов реестра — с расшифрованными секретами */
    configs: (channels: ChannelRegistry, secretBox: SecretBox | undefined, tx: DbOrTx = db) =>
      channelConfigs(tx, channels, secretBox),

    /** Сохранить канал (вкл/выкл, открытые настройки, секрет). undefined в поле — не трогать */
    async saveChannel(
      tx: DbOrTx,
      kind: NotificationChannelKind,
      values: {
        enabled?: boolean
        settings?: Record<string, unknown>
        secretEncrypted?: string | null
        updatedBy: string | null
      },
      now: Date,
      defaultEnabled: boolean,
    ) {
      const set = {
        ...(values.enabled === undefined ? {} : { enabled: values.enabled }),
        ...(values.settings === undefined ? {} : { settings: values.settings }),
        ...(values.secretEncrypted === undefined
          ? {}
          : { secretEncrypted: values.secretEncrypted }),
        updatedBy: values.updatedBy,
        updatedAt: now,
      }
      await tx
        .insert(notificationChannels)
        .values({
          kind,
          enabled: values.enabled ?? defaultEnabled,
          settings: values.settings ?? {},
          secretEncrypted: values.secretEncrypted ?? null,
          updatedBy: values.updatedBy,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({ target: notificationChannels.kind, set })
    },

    /** Получатели аудитории, старые сверху */
    recipients(siteId: AudienceSite, tx: DbOrTx = db) {
      return tx
        .select()
        .from(notificationRecipients)
        .where(audienceIs(notificationRecipients.siteId, siteId))
        .orderBy(asc(notificationRecipients.createdAt), asc(notificationRecipients.id))
    },

    /** Получатели аудитории, подписанные на событие */
    subscribed(siteId: AudienceSite, event: string, tx: DbOrTx = db) {
      return tx
        .select()
        .from(notificationRecipients)
        .where(
          and(
            audienceIs(notificationRecipients.siteId, siteId),
            sql`${notificationRecipients.events} @> ${JSON.stringify([event])}::jsonb`,
          ),
        )
        .orderBy(asc(notificationRecipients.createdAt), asc(notificationRecipients.id))
    },

    async recipient(siteId: AudienceSite, id: string, tx: DbOrTx = db) {
      const [row] = await tx
        .select()
        .from(notificationRecipients)
        .where(
          and(eq(notificationRecipients.id, id), audienceIs(notificationRecipients.siteId, siteId)),
        )
      return row
    },

    /**
     * Новый получатель: адрес проходит схему своего канала (почта, chat id) — что бы ни звало,
     * кривой адрес в базу не ляжет. Такой уже есть — undefined
     */
    async addRecipient(
      tx: DbOrTx,
      values: {
        siteId: AudienceSite
        channel: Pick<NotificationChannel, 'kind' | 'address'>
        address: string
        label?: string | null
        events: string[]
        createdBy: string | null
        now: Date
      },
    ) {
      const address = values.channel.address.safeParse(values.address)
      if (!address.success) {
        throw new Error(
          `Адрес получателя канала ${values.channel.kind} не прошёл проверку: ${address.error.issues[0]?.message ?? 'не тот формат'}`,
        )
      }
      const [row] = await tx
        .insert(notificationRecipients)
        .values({
          siteId: values.siteId,
          channel: values.channel.kind,
          address: address.data,
          label: values.label ?? null,
          events: values.events,
          createdBy: values.createdBy,
          createdAt: values.now,
        })
        .onConflictDoNothing()
        .returning()
      return row
    },

    async removeRecipient(tx: DbOrTx, id: string) {
      await tx.delete(notificationRecipients).where(eq(notificationRecipients.id, id))
    },

    async setEvents(tx: DbOrTx, id: string, events: string[]) {
      await tx
        .update(notificationRecipients)
        .set({ events })
        .where(eq(notificationRecipients.id, id))
    },

    /**
     * Адреса почты получателей заявок — ещё и в устаревшую колонку sites.lead_recipients: её
     * читает прежняя версия API при откате (миграции только совместимые вперёд)
     */
    async syncLegacyLeadRecipients(tx: DbOrTx, siteId: string) {
      const emails = await tx
        .select({ address: notificationRecipients.address })
        .from(notificationRecipients)
        .where(
          and(
            eq(notificationRecipients.siteId, siteId),
            eq(notificationRecipients.channel, 'email'),
          ),
        )
        .orderBy(asc(notificationRecipients.createdAt), asc(notificationRecipients.id))
      await tx
        .update(sites)
        .set({ leadRecipients: emails.map((row) => row.address) })
        .where(eq(sites.id, siteId))
    },

    /** Новый код привязки: в базе — хеш */
    async createLinkCode(
      tx: DbOrTx,
      values: {
        codeHash: string
        channel: string
        siteId: AudienceSite
        createdBy: string | null
        now: Date
        expiresAt: Date
      },
    ) {
      const [row] = await tx
        .insert(notificationLinkCodes)
        .values({
          codeHash: values.codeHash,
          channel: values.channel,
          siteId: values.siteId,
          createdBy: values.createdBy,
          createdAt: values.now,
          expiresAt: values.expiresAt,
        })
        .returning({ id: notificationLinkCodes.id, expiresAt: notificationLinkCodes.expiresAt })
      if (!row) throw new Error('База не вернула код привязки')
      return row
    },

    /**
     * Забрать код: только неиспользованный и не истёкший, и только один раз — UPDATE с условием
     * used_at IS NULL, так что два одновременных «Старт» с одним кодом чат не привяжут дважды
     */
    async consumeLinkCode(tx: DbOrTx, codeHash: string, channel: string, now: Date) {
      const [row] = await tx
        .update(notificationLinkCodes)
        .set({ usedAt: now })
        .where(
          and(
            eq(notificationLinkCodes.codeHash, codeHash),
            eq(notificationLinkCodes.channel, channel),
            isNull(notificationLinkCodes.usedAt),
            gt(notificationLinkCodes.expiresAt, now),
          ),
        )
        .returning({
          id: notificationLinkCodes.id,
          siteId: notificationLinkCodes.siteId,
          createdBy: notificationLinkCodes.createdBy,
        })
      return row
    },

    /** Живой код без траты: какой аудитории он и кто его выпустил */
    async peekLinkCode(codeHash: string, channel: string, now: Date) {
      const [row] = await db
        .select({
          siteId: notificationLinkCodes.siteId,
          createdBy: notificationLinkCodes.createdBy,
        })
        .from(notificationLinkCodes)
        .where(
          and(
            eq(notificationLinkCodes.codeHash, codeHash),
            eq(notificationLinkCodes.channel, channel),
            isNull(notificationLinkCodes.usedAt),
            gt(notificationLinkCodes.expiresAt, now),
          ),
        )
      return row
    },

    async attachLinkCode(tx: DbOrTx, id: string, recipientId: string) {
      await tx
        .update(notificationLinkCodes)
        .set({ recipientId })
        .where(eq(notificationLinkCodes.id, id))
    },

    /** Есть ли живые коды канала: пока есть, Telegram опрашивается (binder.ts) */
    async hasActiveLinkCodes(channel: string, now: Date) {
      const [row] = await db
        .select({ id: notificationLinkCodes.id })
        .from(notificationLinkCodes)
        .where(
          and(
            eq(notificationLinkCodes.channel, channel),
            isNull(notificationLinkCodes.usedAt),
            gt(notificationLinkCodes.expiresAt, now),
          ),
        )
        .limit(1)
      return row !== undefined
    },

    /** Код по id: что с ним стало (админка ждёт привязки) */
    async linkCode(id: string, siteId: AudienceSite) {
      const [row] = await db
        .select({
          id: notificationLinkCodes.id,
          expiresAt: notificationLinkCodes.expiresAt,
          usedAt: notificationLinkCodes.usedAt,
          recipientId: notificationLinkCodes.recipientId,
        })
        .from(notificationLinkCodes)
        .where(
          and(eq(notificationLinkCodes.id, id), audienceIs(notificationLinkCodes.siteId, siteId)),
        )
      return row
    },

    /** Удалить старые коды: использованные и истёкшие больше не нужны */
    async cleanupLinkCodes(before: Date) {
      const deleted = await db
        .delete(notificationLinkCodes)
        .where(sql`${notificationLinkCodes.expiresAt} < ${before.toISOString()}::timestamptz`)
        .returning({ id: notificationLinkCodes.id })
      return deleted.length
    },
  }
}

export type NotificationSettingsRepo = ReturnType<typeof notificationSettingsRepo>
