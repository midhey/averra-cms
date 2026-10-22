import {
  formatGigabytes,
  type InstallationFacts,
  mailStuck,
  ServiceEventId,
  STATUS_LIMITS,
} from '@averra/schema'
import { max, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { mailOutbox, notificationWatch } from '../db/schema'
import { toMailLine } from '../mail/templates/line'
import { type NotifyDeps, notify } from './notify'

// Служебные события для студии — по переходу состояния, а не на каждом круге. Источник — те же
// факты, что у экрана «Состояние» (collectStatus: файлы averra.sh о бэкапах, место на диске,
// очередь писем) и последние сборки сайтов. Какие проблемы уже были, помнит таблица
// notification_watch: появилась — «проблема», ушла — «снова в порядке», перезапуск API их не
// повторяет. Новых источников не нужно: «почта не работает» — это mailStuck (письма с ошибкой
// в очереди дольше 15 минут — так выглядит очередь на паузе после отказа сервера или отправителя)

/** Проблема сейчас: ключ (у дисков и сайтов — свой на каждый), событие и данные без state */
export type ServiceSignal = {
  key: string
  event: ServiceEventId
  data: Record<string, unknown>
}

/** Последняя сборка сайта упала */
export type FailedBuild = { siteId: string; siteName: string; error: string | null }

/**
 * Что известно этому кругу: проблемы и ключи, о которых рано говорить «снова в порядке»
 * (raisedAt — когда проблему объявили)
 */
export type ServiceReading = {
  signals: ServiceSignal[]
  unknown: (key: string, raisedAt: Date) => boolean
}

export type WatchContext = {
  /** Как назвать установку в сообщении: у студии их много */
  installation: string
  adminUrl: string
}

/** Название установки: сайт и домен, если он известен */
export function installationLabel(siteName: string, siteUrl: string | undefined) {
  const host = siteUrl && URL.canParse(siteUrl) ? new URL(siteUrl).host : undefined
  return toMailLine(host ? `${siteName} (${host})` : siteName, 120, 'Averra')
}

/**
 * Гистерезис диска: «места снова хватает» — только когда свободно на четверть больше порога.
 * Иначе диск, который колеблется около 1 ГБ, слал бы «мало / снова хватает» каждые 5 минут
 */
export const DISK_RECOVERY = 1.25

const diskBelow = (disk: InstallationFacts['disk'][number], factor: number) =>
  disk.freeBytes < STATUS_LIMITS.diskMinFreeBytes * factor ||
  (disk.totalBytes > 0 &&
    disk.freeBytes / disk.totalBytes < STATUS_LIMITS.diskMinFreeShare * factor)

const diskLow = (disk: InstallationFacts['disk'][number]) => diskBelow(disk, 1)

/**
 * Проблемы из фактов о состоянии и упавших сборок. Чистая функция — её проверяют тесты.
 * lastMailSentAt — когда последнее письмо ушло (lastMailSentAt()): «почта снова работает» —
 * только если оно ушло после того, как проблему объявили
 */
export function serviceSignals(
  facts: InstallationFacts,
  builds: readonly FailedBuild[],
  { installation, adminUrl }: WatchContext,
  now: Date,
  lastMailSentAt: Date | null = null,
): ServiceReading {
  const base = { installation, url: `${adminUrl}/status` }
  const signals: ServiceSignal[] = []
  const last = facts.backup.last
  if (facts.backup.enabled && last && !last.ok) {
    signals.push({
      key: 'backup.failed',
      event: 'backup.failed',
      data: { ...base, backup: last.name, ...(last.error ? { error: last.error } : {}) },
    })
  }
  for (const disk of facts.disk.filter(diskLow)) {
    signals.push({
      key: `disk.low:${disk.label}`,
      event: 'disk.low',
      data: {
        ...base,
        disk: toMailLine(disk.label, 120, 'диск'),
        free: formatGigabytes(disk.freeBytes),
      },
    })
  }
  for (const build of builds) {
    signals.push({
      key: `build.failed:${build.siteId}`,
      event: 'build.failed',
      data: {
        ...base,
        url: `${adminUrl}/settings#build`,
        siteName: toMailLine(build.siteName, 80, 'сайт'),
        ...(build.error ? { error: build.error.slice(-500) } : {}),
      },
    })
  }
  if (mailStuck(facts.mail, now)) {
    signals.push({
      key: 'mail.down',
      event: 'mail.down',
      data: { ...base, url: `${adminUrl}/mail`, failing: facts.mail.failing },
    })
  }
  // Диски, о которых «снова хватает» говорить рано: не ответили или ещё у порога
  const settled = new Set(
    facts.disk.filter((disk) => !diskBelow(disk, DISK_RECOVERY)).map((disk) => disk.label),
  )
  return {
    signals,
    // Не знаем, прошла ли проблема, — не трогаем: файл бэкапов не читается, диск не ответил
    // или ещё у порога. Почта «снова работает», когда в очереди нет писем с ошибкой и хоть одно
    // письмо ушло после объявления: письма с ошибкой уходят и сами — в failed, исчерпав попытки
    // (~12 часов), и пустая очередь ещё не значит, что почта починилась
    unknown: (key, raisedAt) =>
      (key === 'backup.failed' && facts.backup.unreadable) ||
      (key.startsWith('disk.low:') && !settled.has(key.slice('disk.low:'.length))) ||
      (key === 'mail.down' &&
        (facts.mail.failing > 0 || !lastMailSentAt || lastMailSentAt <= raisedAt)),
  }
}

/**
 * Последняя завершённая сборка каждого сайта, если она упала. Новая сборка в очереди или в работе
 * проблему не снимает: «снова собирается» — когда она прошла, а если упадёт и она, проблема
 * та же и второго «упала» не будет
 */
export async function failedBuilds(db: Db): Promise<FailedBuild[]> {
  const result = await db.execute(sql`
    select latest.site_id, s.name, latest.error from (
      select distinct on (site_id) site_id, status, error from site_builds
      where status in ('succeeded', 'failed')
      order by site_id, requested_at desc, id desc
    ) latest join sites s on s.id = latest.site_id
    where latest.status = 'failed'`)
  return (result as unknown as { rows: Record<string, unknown>[] }).rows.map((row) => ({
    siteId: String(row.site_id),
    siteName: String(row.name),
    error: row.error === null ? null : String(row.error),
  }))
}

/** Когда ушло последнее письмо (null — ни одного): для «почта снова работает» */
export async function lastMailSentAt(db: Db): Promise<Date | null> {
  const [row] = await db.select({ at: max(mailOutbox.sentAt) }).from(mailOutbox)
  return row?.at ?? null
}

const isServiceEvent = (event: string): event is ServiceEventId =>
  (ServiceEventId.options as string[]).includes(event)

/** Не удалось уведомить об одном переходе: ключ и текст ошибки — в журнал */
export type WatchFailure = { key: string; error: unknown }

/**
 * Один круг: сравнить проблемы с запомненными и уведомить о переходах — в одной транзакции
 * с записью нового состояния. Два процесса API одну проблему не объявят дважды: ключ —
 * первичный ключ, и уведомляет тот, чья вставка прошла. Каждый переход — в своей точке
 * сохранения: сбой одного (данные не прошли шаблон, канал отказал при постановке) откатывает
 * только его, и он повторится на следующем круге, а остальные уведомления круга уходят
 */
export async function runServiceWatch(
  db: Db,
  deps: NotifyDeps,
  reading: ServiceReading,
  now: Date,
  onFailure: (failure: WatchFailure) => void = () => {},
) {
  return db.transaction(async (tx) => {
    const stored = await tx.select().from(notificationWatch).for('update')
    const known = new Set(stored.map((row) => row.key))
    const current = new Map(reading.signals.map((signal) => [signal.key, signal]))
    let raised = 0
    let resolved = 0
    let failed = 0
    const isolated = async (key: string, step: (sp: typeof tx) => Promise<boolean>) => {
      try {
        return await tx.transaction(step)
      } catch (error) {
        failed += 1
        onFailure({ key, error })
        return false
      }
    }
    for (const signal of reading.signals) {
      if (known.has(signal.key)) continue
      const done = await isolated(signal.key, async (sp) => {
        const inserted = await sp
          .insert(notificationWatch)
          .values({ key: signal.key, event: signal.event, data: signal.data, raisedAt: now })
          .onConflictDoNothing()
          .returning({ key: notificationWatch.key })
        if (inserted.length === 0) return false
        const { queued } = await notify(sp, deps, {
          event: signal.event,
          data: { ...signal.data, state: 'raised' } as never,
          now,
        })
        if (queued === 0) {
          // Сказать было некому (нет получателей или их каналы не возят событие): не запоминаем —
          // получатель, добавленный позже, узнает о проблеме на следующем круге
          await sp.delete(notificationWatch).where(sql`${notificationWatch.key} = ${signal.key}`)
          return false
        }
        return true
      })
      if (done) raised += 1
    }
    for (const row of stored) {
      if (current.has(row.key) || reading.unknown(row.key, row.raisedAt)) continue
      const done = await isolated(row.key, async (sp) => {
        await sp.delete(notificationWatch).where(sql`${notificationWatch.key} = ${row.key}`)
        if (!isServiceEvent(row.event)) return false
        await notify(sp, deps, {
          event: row.event,
          data: { ...row.data, state: 'resolved' } as never,
          now,
        })
        return true
      })
      if (done) resolved += 1
    }
    return { raised, resolved, failed }
  })
}

export type ServiceWatchOptions = {
  db: Db
  deps: () => NotifyDeps
  /** Факты этого круга. undefined — узнать не вышло (база не ответила): круг пропускается */
  read: () => Promise<ServiceReading | undefined>
  /** Поставили уведомления — разбудить обработчики очередей */
  onQueued?: () => void
  intervalMs?: number
  /** Первый круг — не сразу: API только стартовал, сборки возобновляются */
  firstDelayMs?: number
  now?: () => Date
  log?: (message: string) => void
}

/** Круги наблюдения в процессе API: раз в intervalMs (по умолчанию 5 минут) */
export function startServiceWatch({
  db,
  deps,
  read,
  onQueued = () => {},
  intervalMs = 5 * 60 * 1000,
  firstDelayMs = 60 * 1000,
  now = () => new Date(),
  log = () => {},
}: ServiceWatchOptions) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined

  async function tick() {
    try {
      const reading = await read()
      if (!reading) return
      const { raised, resolved } = await runServiceWatch(
        db,
        deps(),
        reading,
        now(),
        ({ key, error }) =>
          log(
            `Служебное уведомление «${key}» не поставлено, повторим на следующем круге: ${error instanceof Error ? error.message : String(error)}`,
          ),
      )
      if (raised + resolved > 0) {
        log(`Служебные уведомления: новых проблем ${raised}, ушедших ${resolved}`)
        onQueued()
      }
    } catch (error) {
      log(`Наблюдение за состоянием: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function schedule(delay: number) {
    timer = setTimeout(() => {
      running = tick().finally(() => {
        running = undefined
        if (!stopped) schedule(intervalMs)
      })
    }, delay)
  }

  schedule(firstDelayMs)
  return {
    async stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      await running
    },
  }
}
