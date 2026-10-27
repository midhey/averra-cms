import {
  type BackupRun,
  type DiskSpace,
  type InstallationFacts,
  type InstallationStatus,
  isNewerVersion,
  NO_RELEASE_STATE,
  type ReleaseState,
  SERVICE_DATABASE,
  type SiteBuildStatus,
  statusProblems,
  type UpdateRequestFile,
  type UpdateRun,
} from '@averra/schema'
import { sql } from 'drizzle-orm'
import type { Db } from '../../db/client'

// Состояние установки: одно для владельца в админке (GET /api/status) и для студии
// (команда status.js, её зовёт deploy/averra.sh status по SSH). Без Node API: файлы состояния
// и место на диске приходят интерфейсом HostStatus (реализация — src/status/host.ts)

/** Что известно о бэкапах из файлов состояния, которые пишет deploy/averra.sh */
export type BackupState = {
  enabled: boolean
  unreadable: boolean
  last: BackupRun | null
  lastOk: BackupRun | null
}

/** Последнее обновление из файла состояния; unreadable — файл есть, но не читается */
export type UpdateState = { last: UpdateRun | null; unreadable: boolean }

/** Новая версия и заявка с сервера: всё, кроме «доступна ли» — её решает версия API */
export type HostRelease = Omit<ReleaseState, 'available'>

/** Хостовой части нет (разработка, установка без install.sh) */
export const NO_HOST_RELEASE: HostRelease = {
  mode: NO_RELEASE_STATE.mode,
  check: null,
  latest: null,
  pending: null,
  request: null,
  unreadable: false,
}

/** Положили ли заявку: exists — уже лежит, no-dir — папки заявок нет или писать в неё нельзя */
export type RequestResult = 'written' | 'exists' | 'no-dir'

/**
 * Сведения с сервера, а не из базы: файлы состояния скрипта сервера, место на диске и папка
 * заявок на обновление — единственное, что API на сервере пишет
 */
export type HostStatus = {
  backup(): Promise<BackupState>
  update(): Promise<UpdateState>
  disk(): Promise<DiskSpace[]>
  release(): Promise<HostRelease>
  requestUpdate(
    file: UpdateRequestFile,
    options?: { replaceStale?: boolean },
  ): Promise<RequestResult>
}

/** Без папки состояния и без дисков: так у API в разработке и в тестах, где не задано своё */
export const noHostStatus: HostStatus = {
  backup: async () => ({ enabled: false, unreadable: false, last: null, lastOk: null }),
  update: async () => ({ last: null, unreadable: false }),
  disk: async () => [],
  release: async () => NO_HOST_RELEASE,
  requestUpdate: async () => 'no-dir',
}

/** Новая версия словами схемы: доступна — только если новее версии этого API */
export function releaseState(host: HostRelease, version: string): ReleaseState {
  const latest = host.latest
  return {
    ...host,
    available: latest && isNewerVersion(latest.version, version) ? latest.version : null,
  }
}

export type StatusSources = {
  version: string
  host: HostStatus
  /** Почта процесса: включена ли и почему нет (без провайдера и его настроек) */
  mail: { enabled: boolean; reason: string | null }
  /** Публикация на сервере включена (PUBLISH_DIR) */
  publishEnabled: boolean
}

/** Неделя: письма, которые не ушли раньше, — уже история (их и так удалит очистка очереди) */
const MAIL_FAILED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

type Row = Record<string, unknown>
const rowsOf = (result: unknown) => (result as { rows: Row[] }).rows

async function dbFacts(db: Db, now: Date) {
  try {
    // Таблица мигратора Drizzle: сколько миграций применено. Её же сверяет averra.sh при откате
    const [migrations] = rowsOf(
      await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`),
    )
    const [lastBuild] = rowsOf(
      await db.execute(sql`
        select s.name as site_name, b.status,
          coalesce(b.finished_at, b.started_at, b.requested_at) as at
        from site_builds b join sites s on s.id = b.site_id
        order by coalesce(b.finished_at, b.started_at, b.requested_at) desc, b.id desc
        limit 1`),
    )
    // Последняя сборка каждого сайта: упала — на сайте прежняя версия, это надо видеть
    const [failed] = rowsOf(
      await db.execute(sql`
        select count(*)::int as n from (
          select distinct on (site_id) status from site_builds
          order by site_id, requested_at desc, id desc
        ) latest where status = 'failed'`),
    )
    // Служебные базы с копиями данных, которые оставляет deploy/averra.sh (откат, восстановление):
    // каталог pg_database виден любой роли. Имена сверяются схемой — чужие базы не показываем
    const databases = rowsOf(
      await db.execute(
        sql`select datname from pg_database where datname like 'averra%' order by datname`,
      ),
    )
      .map((row) => String(row.datname))
      .filter((name) => SERVICE_DATABASE.test(name))
    const since = new Date(now.getTime() - MAIL_FAILED_WINDOW_MS)
    const [mail] = rowsOf(
      await db.execute(sql`
        select
          count(*) filter (
            where status = 'failed' and coalesce(last_attempt_at, created_at) > ${since.toISOString()}::timestamptz
          )::int as failed,
          count(*) filter (where status in ('pending', 'sending'))::int as pending,
          count(*) filter (
            where status in ('pending', 'sending') and last_error is not null
          )::int as failing,
          min(created_at) filter (
            where status in ('pending', 'sending') and last_error is not null
          ) as failing_since
        from mail_outbox`),
    )
    return {
      up: true as const,
      migrations: Number(migrations?.n ?? 0),
      serviceDatabases: databases,
      lastBuild: lastBuild
        ? {
            siteName: String(lastBuild.site_name),
            status: lastBuild.status as SiteBuildStatus,
            at: new Date(lastBuild.at as string | Date).toISOString(),
          }
        : null,
      failedSites: Number(failed?.n ?? 0),
      mailFailed: Number(mail?.failed ?? 0),
      mailPending: Number(mail?.pending ?? 0),
      mailFailing: Number(mail?.failing ?? 0),
      mailFailingSince: mail?.failing_since
        ? new Date(mail.failing_since as string | Date).toISOString()
        : null,
    }
  } catch {
    // База не ответила: остальное (бэкапы, диск, версия) всё равно показываем
    return { up: false as const }
  }
}

/** Состояние установки: факты из базы и с сервера плюс список проблем (statusProblems) */
export async function collectStatus(
  db: Db,
  sources: StatusSources,
  now = new Date(),
): Promise<InstallationStatus> {
  const [fromDb, backup, update, disk, release] = await Promise.all([
    dbFacts(db, now),
    sources.host.backup(),
    sources.host.update(),
    sources.host.disk(),
    sources.host.release(),
  ])
  const facts: InstallationFacts = {
    version: sources.version,
    checkedAt: now.toISOString(),
    db: {
      up: fromDb.up,
      migrations: fromDb.up ? fromDb.migrations : null,
      serviceDatabases: fromDb.up ? fromDb.serviceDatabases : [],
    },
    backup,
    update: update.last,
    updateUnreadable: update.unreadable,
    release: releaseState(release, sources.version),
    publish: {
      enabled: sources.publishEnabled,
      last: fromDb.up ? fromDb.lastBuild : null,
      failedSites: fromDb.up ? fromDb.failedSites : 0,
    },
    mail: {
      enabled: sources.mail.enabled,
      reason: sources.mail.enabled ? null : sources.mail.reason,
      failedRecent: fromDb.up ? fromDb.mailFailed : 0,
      pending: fromDb.up ? fromDb.mailPending : 0,
      failing: fromDb.up ? fromDb.mailFailing : 0,
      failingSince: fromDb.up ? fromDb.mailFailingSince : null,
    },
    disk,
  }
  return { ...facts, problems: statusProblems(facts, now) }
}
