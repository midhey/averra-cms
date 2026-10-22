import { and, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { notificationOutbox } from '../db/schema'
import { type DbOrTx, retryDelayMs, SENDING_LEASE_MS } from '../mail/outbox'
import type { EnqueueContext, QueuedEvent } from './channel'

// Очередь уведомлений каналов, кроме почты (паттерн outbox, как у писем — mail/outbox.ts):
// сообщение пишется в базу вместе с событием, а уходит потом, с повторами и растущей паузой.
// Данные события живут только до отправки или окончательной неудачи: ручного «Повторить» у
// уведомлений нет, и копия полей заявки дольше не нужна. Время — параметром: тесты двигают часы

/** Сообщение, которое обработчик взял в отправку */
export type ClaimedNotification = {
  id: string
  claimId: string
  channel: string
  address: string
  event: string
  data: unknown
  attempts: number
}

/** Поставить сообщения в очередь тем же объектом базы или транзакции, что и событие */
export async function enqueueNotifications(
  { tx, now, siteId, leadId }: EnqueueContext,
  channel: string,
  item: QueuedEvent,
  targets: readonly { address: string; recipientId?: string | null }[],
) {
  if (targets.length === 0) return
  await tx.insert(notificationOutbox).values(
    targets.map((target) => ({
      channel,
      address: target.address,
      recipientId: target.recipientId ?? null,
      event: item.event,
      data: item.data,
      siteId,
      leadId,
      nextAttemptAt: now,
      createdAt: now,
    })),
  )
}

export function notificationOutboxRepo(db: Db) {
  const claimed = (item: Pick<ClaimedNotification, 'id' | 'claimId'>) =>
    and(eq(notificationOutbox.id, item.id), eq(notificationOutbox.claimId, item.claimId))

  return {
    /**
     * Забирает до limit сообщений готовых каналов, которым пора уходить: FOR UPDATE SKIP LOCKED
     * и sending одним запросом, как у писем. Сообщения выключенного или выжидающего канала
     * не берутся вовсе — они ждут, пока канал оживёт
     */
    async claimDue({
      now,
      limit,
      maxAttempts,
      channels,
    }: {
      now: Date
      limit: number
      maxAttempts: number
      channels: readonly string[]
    }): Promise<ClaimedNotification[]> {
      if (channels.length === 0) return []
      const claimId = crypto.randomUUID()
      const due = db
        .select({ id: notificationOutbox.id })
        .from(notificationOutbox)
        .where(
          and(
            inArray(notificationOutbox.channel, [...channels]),
            or(
              and(
                eq(notificationOutbox.status, 'pending'),
                lte(notificationOutbox.nextAttemptAt, now),
              ),
              and(
                eq(notificationOutbox.status, 'sending'),
                lte(notificationOutbox.lockedUntil, now),
                lt(notificationOutbox.attempts, maxAttempts),
              ),
            ),
          ),
        )
        .orderBy(notificationOutbox.nextAttemptAt, notificationOutbox.createdAt)
        .limit(limit)
        .for('update', { skipLocked: true })
      const rows = await db
        .update(notificationOutbox)
        .set({
          status: 'sending',
          claimId,
          lockedUntil: new Date(now.getTime() + SENDING_LEASE_MS),
          attempts: sql`${notificationOutbox.attempts} + 1`,
        })
        .where(inArray(notificationOutbox.id, due))
        .returning({
          id: notificationOutbox.id,
          channel: notificationOutbox.channel,
          address: notificationOutbox.address,
          event: notificationOutbox.event,
          data: notificationOutbox.data,
          attempts: notificationOutbox.attempts,
          nextAttemptAt: notificationOutbox.nextAttemptAt,
          createdAt: notificationOutbox.createdAt,
        })
      return rows
        .sort(
          (a, b) =>
            a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        )
        .map(({ nextAttemptAt: _, createdAt: __, ...row }) => ({ ...row, claimId }))
    },

    /**
     * Продлить аренду перед отправкой: false — сообщение уже взял другой обработчик, и отправлять
     * его нельзя (ушло бы дважды). Это и есть начало попытки
     */
    async renewLease(item: ClaimedNotification, now: Date) {
      const rows = await db
        .update(notificationOutbox)
        .set({ lockedUntil: new Date(now.getTime() + SENDING_LEASE_MS), lastAttemptAt: now })
        .where(and(claimed(item), eq(notificationOutbox.status, 'sending')))
        .returning({ id: notificationOutbox.id })
      return rows.length > 0
    },

    /** Застрявшие в sending с истёкшей арендой, у которых кончились попытки, — не отправлены */
    failStale({ now, maxAttempts }: { now: Date; maxAttempts: number }) {
      return db
        .update(notificationOutbox)
        .set({
          status: 'failed',
          claimId: null,
          lockedUntil: null,
          data: null,
          lastError:
            'Отправка прерывалась (API останавливался посреди отправки), а попытки кончились',
        })
        .where(
          and(
            eq(notificationOutbox.status, 'sending'),
            lte(notificationOutbox.lockedUntil, now),
            gte(notificationOutbox.attempts, maxAttempts),
          ),
        )
    },

    /**
     * Отпустить, не отправляя: попытка не считается. error — почему (сломался канал, а не
     * сообщение): причину видно, попытка не тратится
     */
    async release(item: ClaimedNotification, now: Date, error?: string) {
      await db
        .update(notificationOutbox)
        .set({
          status: 'pending',
          attempts: sql`${notificationOutbox.attempts} - 1`,
          nextAttemptAt: now,
          claimId: null,
          lockedUntil: null,
          ...(error === undefined ? {} : { lastError: error.slice(0, 1000) }),
        })
        .where(claimed(item))
    },

    /** Ушло: данные события стираются — в них персональные данные */
    async markSent(
      item: ClaimedNotification,
      { now, messageId }: { now: Date; messageId: string },
    ) {
      await db
        .update(notificationOutbox)
        .set({
          status: 'sent',
          sentAt: now,
          messageId,
          data: null,
          lastError: null,
          claimId: null,
          lockedUntil: null,
        })
        .where(claimed(item))
    },

    /**
     * Попытка не удалась. Окончательно (постоянная ошибка или последняя попытка) — данные
     * стираются; иначе следующая попытка через retryDelayMs, но не раньше, чем просил канал
     */
    async markFailedAttempt(
      item: ClaimedNotification,
      {
        now,
        error,
        permanent,
        maxAttempts,
        retryAfterMs = 0,
      }: {
        now: Date
        error: string
        permanent: boolean
        maxAttempts: number
        retryAfterMs?: number
      },
    ) {
      const giveUp = permanent || item.attempts >= maxAttempts
      const delay = Math.max(retryDelayMs(item.attempts), retryAfterMs)
      await db
        .update(notificationOutbox)
        .set({
          status: giveUp ? 'failed' : 'pending',
          nextAttemptAt: new Date(now.getTime() + delay),
          lastError: error.slice(0, 1000),
          claimId: null,
          lockedUntil: null,
          ...(giveUp ? { data: null } : {}),
        })
        .where(claimed(item))
      return giveUp ? ('failed' as const) : ('retry' as const)
    },

    /**
     * Удаляет сообщения старше retentionDays — отправленные, неотправленные и так и не ушедшие
     * (канал был выключен): в данных ждущих — персональные данные
     */
    async cleanup({ now, retentionDays }: { now: Date; retentionDays: number }) {
      const before = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
      const deleted = await db
        .delete(notificationOutbox)
        .where(
          or(
            and(eq(notificationOutbox.status, 'sent'), lt(notificationOutbox.sentAt, before)),
            and(
              eq(notificationOutbox.status, 'failed'),
              lt(
                sql`coalesce(${notificationOutbox.lastAttemptAt}, ${notificationOutbox.createdAt})`,
                before,
              ),
            ),
            and(
              inArray(notificationOutbox.status, ['pending', 'sending']),
              lt(notificationOutbox.createdAt, before),
            ),
          ),
        )
        .returning({ id: notificationOutbox.id })
      return deleted.length
    },

    /** Последние сообщения для админки, новые сверху, без данных */
    list(limit = 50) {
      return db
        .select({
          id: notificationOutbox.id,
          channel: notificationOutbox.channel,
          address: notificationOutbox.address,
          event: notificationOutbox.event,
          status: notificationOutbox.status,
          attempts: notificationOutbox.attempts,
          lastError: notificationOutbox.lastError,
          sentAt: notificationOutbox.sentAt,
          createdAt: notificationOutbox.createdAt,
        })
        .from(notificationOutbox)
        .orderBy(desc(notificationOutbox.createdAt), desc(notificationOutbox.id))
        .limit(limit)
    },

    /**
     * Каналы, где сообщения ждут отправки с before и раньше: сколько и последняя ошибка. Так
     * видно, что канал «настроен», но не работает (Telegram недоступен с VPS, токен отозван):
     * сбой канала попытки не тратит, и сообщения просто копятся
     */
    async stuck(before: Date, channels?: readonly string[]) {
      if (channels && channels.length === 0) return []
      const rows = await db
        .select({
          channel: notificationOutbox.channel,
          count: sql<number>`count(*)::int`,
          lastError: sql<
            string | null
          >`(array_agg(${notificationOutbox.lastError} order by ${notificationOutbox.lastAttemptAt} desc nulls last))[1]`,
        })
        .from(notificationOutbox)
        .where(
          and(
            inArray(notificationOutbox.status, ['pending', 'sending']),
            lt(notificationOutbox.createdAt, before),
            ...(channels ? [inArray(notificationOutbox.channel, [...channels])] : []),
          ),
        )
        .groupBy(notificationOutbox.channel)
        .orderBy(notificationOutbox.channel)
      return rows.map((row) => ({ ...row, count: Number(row.count) }))
    },
  }
}

/** Удалить ждущие сообщения получателю, которого отвязывают: заявки ему больше не уходят */
export async function dropPendingFor(tx: DbOrTx, recipientId: string) {
  await tx
    .delete(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.recipientId, recipientId),
        inArray(notificationOutbox.status, ['pending', 'sending']),
      ),
    )
}

/**
 * Удалить все ждущие сообщения канала: сменился или удалён бот — прежним чатам новый бот не
 * напишет, и такие сообщения ушли бы только в «не отправлено»
 */
export async function dropPendingOfChannel(tx: DbOrTx, channel: string) {
  await tx
    .delete(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.channel, channel),
        inArray(notificationOutbox.status, ['pending', 'sending']),
      ),
    )
}
