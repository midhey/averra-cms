import { PublicCheck } from '@averra/schema'
import { eq, like } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db/client'
import { notificationWatch } from '../db/schema'
import type { DbOrTx } from '../mail/outbox'
import { type NotifyDeps, notify } from './notify'
import type { WatchContext, WatchFailure } from './watch'

export const PUBLIC_CHECK_INTERVAL_MS = 5 * 60 * 1000
export const PUBLIC_REMINDER_MS = 6 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const SETTINGS_KEY = 'public:settings'

export async function publicMonitoringEnabled(db: DbOrTx) {
  const [row] = await db
    .select()
    .from(notificationWatch)
    .where(eq(notificationWatch.key, SETTINGS_KEY))
  return row?.data.enabled !== false
}

export async function setPublicMonitoring(db: Db, enabled: boolean, now = new Date()) {
  await db
    .insert(notificationWatch)
    .values({
      key: SETTINGS_KEY,
      event: 'public.settings',
      data: { enabled },
      raisedAt: now,
    })
    .onConflictDoUpdate({ target: notificationWatch.key, set: { data: { enabled } } })
}

export type PublicTarget = { target: PublicCheck['target']; url: string }
export type PublicReading = Pick<PublicCheck, 'available' | 'status' | 'certificate'> & {
  /** Отпечаток отличает новый сертификат с таким же сроком от прежнего */
  fingerprint: string | null
}
export type PublicProbe = (url: string) => Promise<PublicReading>

const StoredCheck = PublicCheck.extend({
  url: z.string(),
  downNotifiedAt: z.iso.datetime().nullable(),
  fingerprint: z.string().nullable(),
  warned14: z.boolean(),
  warned3: z.boolean(),
  invalidNotified: z.boolean(),
})

/** Без Node API: этот снимок читают и маршрут состояния, и команда по SSH */
export async function publicChecks(db: Db): Promise<PublicCheck[]> {
  const rows = await db
    .select()
    .from(notificationWatch)
    .where(like(notificationWatch.key, 'public:%'))
  return rows.flatMap((row) => {
    const parsed = PublicCheck.safeParse(row.data)
    return parsed.success ? [parsed.data] : []
  })
}

/** Сеть — до транзакции; проверка, переход и постановка сообщения — под одним замком строки */
export async function runPublicWatch({
  db,
  deps,
  targets,
  probe,
  context,
  now = new Date(),
  onFailure = () => {},
}: {
  db: Db
  deps: NotifyDeps
  targets: readonly PublicTarget[]
  probe: PublicProbe
  context: WatchContext
  now?: Date
  onFailure?: (failure: WatchFailure) => void
}) {
  let queued = 0
  if (targets.length === 0 || !(await publicMonitoringEnabled(db))) return { queued }
  for (const { target, url } of targets) {
    const key = `public:${target}`
    try {
      const [last] = await db.select().from(notificationWatch).where(eq(notificationWatch.key, key))
      const previous = StoredCheck.safeParse(last?.data)
      if (
        previous.success &&
        previous.data.url === url &&
        now.getTime() - Date.parse(previous.data.checkedAt) < PUBLIC_CHECK_INTERVAL_MS
      )
        continue
      const reading = await probe(url)
      queued += await db.transaction(async (tx) => {
        if (!(await publicMonitoringEnabled(tx))) return 0
        await tx
          .insert(notificationWatch)
          .values({
            key,
            event: 'public.check',
            data: {},
            raisedAt: now,
          })
          .onConflictDoNothing()
        const [row] = await tx
          .select()
          .from(notificationWatch)
          .where(eq(notificationWatch.key, key))
          .for('update')
        const parsed = StoredCheck.safeParse(row?.data)
        const old = parsed.success && parsed.data.url === url ? parsed.data : undefined
        // Другой процесс уже записал эту проверку: два одновременных сбоя — ещё не два круга.
        if (old && now.getTime() - Date.parse(old.checkedAt) < PUBLIC_CHECK_INTERVAL_MS) return 0
        const changed = old?.fingerprint !== reading.fingerprint && reading.fingerprint !== null
        const next = {
          ...reading,
          target,
          url,
          checkedAt: now.toISOString(),
          failures: reading.available ? 0 : (old?.failures ?? 0) + 1,
          downNotifiedAt: old?.downNotifiedAt ?? null,
          fingerprint: reading.fingerprint ?? old?.fingerprint ?? null,
          warned14: changed ? false : (old?.warned14 ?? false),
          warned3: changed ? false : (old?.warned3 ?? false),
          invalidNotified: old?.invalidNotified ?? false,
        }
        const base = {
          installation: context.installation,
          url: `${context.adminUrl}/status`,
          target: target === 'site' ? 'сайт' : 'админка',
          state: 'raised' as const,
        }
        let count = 0
        if (
          !reading.available &&
          next.failures >= 2 &&
          (!next.downNotifiedAt ||
            now.getTime() - Date.parse(next.downNotifiedAt) >= PUBLIC_REMINDER_MS)
        ) {
          const result = await notify(tx, deps, {
            event: 'site.down',
            now,
            data: { ...base, reminder: next.downNotifiedAt !== null },
          })
          count += result.queued
          if (result.queued > 0) next.downNotifiedAt = now.toISOString()
        } else if (reading.available && next.downNotifiedAt) {
          const result = await notify(tx, deps, {
            event: 'site.down',
            now,
            data: { ...base, state: 'resolved', reminder: false },
          })
          count += result.queued
          // Без работающего канала восстановление дождётся следующего круга.
          if (result.queued > 0) next.downNotifiedAt = null
        }
        if (reading.certificate.state === 'invalid' && !next.invalidNotified) {
          const result = await notify(tx, deps, { event: 'certificate.invalid', now, data: base })
          count += result.queued
          if (result.queued > 0) next.invalidNotified = true
        } else if (reading.certificate.state === 'valid' && reading.certificate.expiresAt) {
          next.invalidNotified = false
          const days = Math.ceil(
            (Date.parse(reading.certificate.expiresAt) - now.getTime()) / DAY_MS,
          )
          const threshold = days <= 3 ? 'warned3' : 'warned14'
          if (days > 0 && days <= 14 && !next[threshold]) {
            const result = await notify(tx, deps, {
              event: 'certificate.expiring',
              now,
              data: { ...base, days, expiresAt: reading.certificate.expiresAt },
            })
            count += result.queued
            if (result.queued > 0) {
              next[threshold] = true
              // Если первый запуск уже на трёх днях, предупреждение о 14 днях не догоняет его.
              next.warned14 = true
            }
          }
        }
        await tx.update(notificationWatch).set({ data: next }).where(eq(notificationWatch.key, key))
        return count
      })
    } catch (error) {
      onFailure({ key, error })
    }
  }
  return { queued }
}
