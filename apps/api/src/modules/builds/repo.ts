import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { siteBuilds } from '../../db/schema'

/** Сколько последних сборок сайта хранить в журнале: старше — удаляются после каждой сборки */
export const BUILDS_KEPT = 20

/** Самая длинная причина сбоя в журнале: хвост вывода сборщика, а не весь лог */
export const BUILD_ERROR_MAX = 4000

/** Что перезапуск API сделал со сборкой, которая шла */
export const INTERRUPTED_BUILD = 'Сборку прервал перезапуск API — она запущена заново'

const buildColumns = {
  id: siteBuilds.id,
  status: siteBuilds.status,
  release: siteBuilds.release,
  error: siteBuilds.error,
  peakRssBytes: siteBuilds.peakRssBytes,
  requestedAt: siteBuilds.requestedAt,
  startedAt: siteBuilds.startedAt,
  finishedAt: siteBuilds.finishedAt,
}

/** Журнал сборок сайтов на сервере. Порядок сборок держит очередь (src/publish/queue.ts) */
export function buildsRepo(db: Db) {
  return {
    /**
     * Заводит ждущую сборку сайта. Если она уже ждёт — новую не заводит: та же сборка возьмёт
     * и эту публикацию (опубликованное читается в момент сборки). Гонку держит частичный
     * уникальный индекс site_builds_one_queued
     */
    async request(siteId: string, now: Date) {
      await db
        .insert(siteBuilds)
        .values({ siteId, status: 'queued', requestedAt: now })
        .onConflictDoNothing({
          target: siteBuilds.siteId,
          where: sql`${siteBuilds.status} = 'queued'`,
        })
    },

    /** Ждущая сборка сайта пошла. undefined — ждущей нет (её уже взяли или сайт удалён) */
    async start(siteId: string, now: Date) {
      const [row] = await db
        .update(siteBuilds)
        .set({ status: 'running', startedAt: now })
        .where(and(eq(siteBuilds.siteId, siteId), eq(siteBuilds.status, 'queued')))
        .returning({ id: siteBuilds.id })
      return row?.id
    },

    async succeed(id: string, result: { release: string; peakRssBytes?: number }, now: Date) {
      await db
        .update(siteBuilds)
        .set({
          status: 'succeeded',
          release: result.release,
          peakRssBytes: result.peakRssBytes ?? null,
          finishedAt: now,
        })
        .where(eq(siteBuilds.id, id))
    },

    async fail(id: string, error: string, peakRssBytes: number | undefined, now: Date) {
      await db
        .update(siteBuilds)
        .set({
          status: 'failed',
          // Пустая причина — тоже причина: CHECK требует текст у упавшей сборки
          error: (error.trim() || 'Сборка упала без сообщения').slice(-BUILD_ERROR_MAX),
          peakRssBytes: peakRssBytes ?? null,
          finishedAt: now,
        })
        .where(eq(siteBuilds.id, id))
    },

    /** Удаляет из журнала сайта законченные сборки старше последних keep */
    async prune(siteId: string, keep = BUILDS_KEPT) {
      const recent = db
        .select({ id: siteBuilds.id })
        .from(siteBuilds)
        .where(eq(siteBuilds.siteId, siteId))
        .orderBy(desc(siteBuilds.requestedAt), desc(siteBuilds.id))
        .limit(keep)
      await db
        .delete(siteBuilds)
        .where(
          and(
            eq(siteBuilds.siteId, siteId),
            inArray(siteBuilds.status, ['succeeded', 'failed']),
            notInArray(siteBuilds.id, recent),
          ),
        )
    },

    /** Последняя сборка сайта — её показывает админка. undefined — сборок ещё не было */
    async latest(siteId: string) {
      const [row] = await db
        .select(buildColumns)
        .from(siteBuilds)
        .where(eq(siteBuilds.siteId, siteId))
        .orderBy(desc(siteBuilds.requestedAt), desc(siteBuilds.id))
        .limit(1)
      return row
    },

    /** Последняя готовая сборка сайта: какая версия сейчас на сайте и когда она собрана */
    async lastSucceeded(siteId: string) {
      const [row] = await db
        .select(buildColumns)
        .from(siteBuilds)
        .where(and(eq(siteBuilds.siteId, siteId), eq(siteBuilds.status, 'succeeded')))
        .orderBy(desc(siteBuilds.finishedAt))
        .limit(1)
      return row
    },

    /**
     * После перезапуска API: шедшие сборки помечаются упавшими (процесс сборки умер вместе
     * с прежним API), а сайты с ними и с ждущими сборками возвращаются, чтобы очередь собрала
     * их заново. Ждущая сборка сайта со сборкой, которая шла, заводится той же очередью.
     * ownRunning — сборки, которые уже идут в этом процессе (публикация успела раньше пометки):
     * их не трогаем, иначе удачный конец такой сборки нарушил бы CHECK site_builds_result_valid
     */
    async recover(now: Date, ownRunning: readonly string[] = []) {
      const interrupted = await db
        .update(siteBuilds)
        .set({ status: 'failed', error: INTERRUPTED_BUILD, finishedAt: now })
        .where(
          and(
            eq(siteBuilds.status, 'running'),
            ownRunning.length > 0 ? notInArray(siteBuilds.id, [...ownRunning]) : undefined,
          ),
        )
        .returning({ siteId: siteBuilds.siteId })
      const queued = await db
        .select({ siteId: siteBuilds.siteId })
        .from(siteBuilds)
        .where(eq(siteBuilds.status, 'queued'))
      return [...new Set([...interrupted, ...queued].map((row) => row.siteId))]
    },
  }
}

export type SiteBuildRow = NonNullable<Awaited<ReturnType<ReturnType<typeof buildsRepo>['latest']>>>
