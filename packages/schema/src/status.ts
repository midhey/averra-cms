import { z } from 'zod'
import { SiteBuildStatus } from './publish'

// Состояние установки: что видит владелец в админке и студия в `pnpm fleet status`.
// Итоги бэкапа и обновления пишет скрипт сервера deploy/averra.sh в папку состояния, API их
// читает и проверяет этими схемами: файл чужой процессу, верить ему на слово нельзя

/** Время в ISO 8601 с зоной: так его пишет averra.sh (date -u +%Y-%m-%dT%H:%M:%SZ) */
const IsoTime = z.iso.datetime({ offset: true })

/** Причина сбоя — фиксированная строка скрипта, не вывод команд: в нём бывают параметры подключения */
const RunError = z.string().max(500).nullable()

/** Откуда бэкап: по расписанию (таймер), руками или перед обновлением */
export const BackupKind = z.enum(['scheduled', 'manual', 'pre-update'])
export type BackupKind = z.infer<typeof BackupKind>

/**
 * Копия во внешнем хранилище: не настроено, выгружена, не выгрузилась; выгружена, но старые копии
 * там не удалились (их срок хранения — 152-ФЗ — нарушается, пока чистка не пройдёт)
 */
export const BackupRemote = z.enum(['off', 'uploaded', 'failed', 'cleanup-failed'])
export type BackupRemote = z.infer<typeof BackupRemote>

/** Один бэкап: файл state/backup-last.json (последний) и state/backup-last-ok.json (последний удачный) */
export const BackupRun = z.object({
  name: z.string().regex(/^[0-9]{8}-[0-9]{6}-[a-z-]+$/),
  kind: BackupKind,
  startedAt: IsoTime,
  finishedAt: IsoTime,
  /** Дамп и архив записаны и прошли проверку восстановлением */
  ok: z.boolean(),
  /** Дамп восстановился во временную базу, архив медиа прочитался целиком */
  verified: z.boolean(),
  dbBytes: z.number().int().nonnegative().nullable(),
  mediaBytes: z.number().int().nonnegative().nullable(),
  remote: BackupRemote,
  error: RunError,
})
export type BackupRun = z.infer<typeof BackupRun>

/**
 * Итог обновления: идёт (или оборвалось на полпути — его доведёт повтор update); обновлено; не
 * начато (не скачались образы или не удался бэкап — ничего не менялось); откат на прежнюю версию;
 * откат не удался (нужен человек)
 */
export const UpdateResult = z.enum([
  'in-progress',
  'updated',
  'failed',
  'rolled-back',
  'rollback-failed',
])
export type UpdateResult = z.infer<typeof UpdateResult>

/** Итог обновления словами: одни для админки и команды состояния на сервере (status.js) */
export const UPDATE_RESULT_LABELS: Record<UpdateResult, string> = {
  'in-progress': 'идёт (если давно — оборвалось: повторите averra.sh update)',
  updated: 'обновлено',
  failed: 'не начато, версия прежняя',
  'rolled-back': 'не прошло проверку, вернулась прежняя версия',
  'rollback-failed': 'не прошло, и откат не удался — нужен человек на сервере',
}

/** Последнее обновление: файл state/update-last.json */
export const UpdateRun = z.object({
  from: z.string().min(1).max(128),
  to: z.string().min(1).max(128),
  startedAt: IsoTime,
  /** Нет, пока обновление идёт (in-progress) */
  finishedAt: IsoTime.nullable(),
  result: UpdateResult,
  /** При откате база восстановлена из бэкапа перед обновлением: миграции новой версии успели пройти */
  dbRestored: z.boolean(),
  /**
   * База, которая работала до восстановления при откате: в ней данные, принятые после бэкапа
   * (заявки). Не удаляется молча — лежит под этим именем, пока не уйдёт по сроку бэкапов
   */
  keptDatabase: z
    .string()
    .regex(/^averra_rolled_back_[0-9]{8}_[0-9]{6}$/)
    .nullable()
    .default(null),
  error: RunError,
})
export type UpdateRun = z.infer<typeof UpdateRun>

/**
 * Итог обновления словами с причиной: у «не начато» и «откат не удался» причины разные (образы,
 * бэкап, обрыв, откат), и без неё непонятно, что чинить. У отката причина повторяла бы подпись
 */
export function updateResultText(run: Pick<UpdateRun, 'result' | 'error'>) {
  const label = UPDATE_RESULT_LABELS[run.result]
  const withReason = run.result === 'failed' || run.result === 'rollback-failed'
  return withReason && run.error ? `${label}: ${run.error}` : label
}

/**
 * Служебные базы с копиями данных, которые оставляют откат обновления и восстановление
 * (deploy/averra.sh): averra_rolled_back_<время>, averra_failed_restore_<время> — их удаляет срок
 * хранения бэкапов; averra_before_restore — прежняя рабочая база неразобранного восстановления,
 * её разбирает человек
 */
export const SERVICE_DATABASE =
  /^averra_(rolled_back_[0-9]{8}_[0-9]{6}|failed_restore_[0-9]{8}_[0-9]{6}|before_restore)$/

export const StatusProblemCode = z.enum([
  'db_down',
  'backup_missing',
  'backup_stale',
  'backup_failed',
  'backup_remote_failed',
  'backup_remote_cleanup_failed',
  'backup_unreadable',
  'update_rolled_back',
  'update_rollback_failed',
  'update_kept_database',
  'update_interrupted',
  'update_unreadable',
  'db_service_databases',
  'mail_disabled',
  'mail_failed',
  'mail_failing',
  'build_failed',
  'disk_low',
])

export const StatusProblem = z.object({ code: StatusProblemCode, message: z.string() })
export type StatusProblem = z.infer<typeof StatusProblem>

export const DiskSpace = z.object({
  /** Что на этом диске — словами, без путей */
  label: z.string(),
  freeBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
})
export type DiskSpace = z.infer<typeof DiskSpace>

/** Состояние установки без списка проблем: из него проблемы и считаются */
export const InstallationFacts = z.object({
  /** Версия из образа (AVERRA_VERSION), dev — разработка */
  version: z.string(),
  checkedAt: IsoTime,
  db: z.object({
    up: z.boolean(),
    migrations: z.number().int().nonnegative().nullable(),
    /** Служебные базы с копиями данных (SERVICE_DATABASE): персональные данные вне рабочей базы */
    serviceDatabases: z.array(z.string().regex(SERVICE_DATABASE)).default([]),
  }),
  backup: z.object({
    /** Установка ведёт бэкапы (есть папка состояния): в разработке их нет, и это не проблема */
    enabled: z.boolean(),
    /** Файл состояния есть, но не читается (обрезан, чужой формат) */
    unreadable: z.boolean(),
    last: BackupRun.nullable(),
    lastOk: BackupRun.nullable(),
  }),
  update: UpdateRun.nullable(),
  /** Файл состояния обновления есть, но не читается (обрезан, записан более новым averra.sh) */
  updateUnreadable: z.boolean().default(false),
  publish: z.object({
    enabled: z.boolean(),
    /** Последняя сборка по всем сайтам установки */
    last: z.object({ siteName: z.string(), status: SiteBuildStatus, at: IsoTime }).nullable(),
    /** Сколько сайтов сейчас с упавшей последней сборкой */
    failedSites: z.number().int().nonnegative(),
  }),
  mail: z.object({
    enabled: z.boolean(),
    reason: z.string().nullable(),
    /** Писем, которые окончательно не ушли за последние 7 дней */
    failedRecent: z.number().int().nonnegative(),
    /** Ждут отправки или отправляются */
    pending: z.number().int().nonnegative(),
    /**
     * Из ждущих — с ошибкой последней попытки: сервер не принял письмо или адрес отправителя,
     * не дал войти. Такие письма повторяются и в failed могут не уйти никогда
     */
    failing: z.number().int().nonnegative(),
    /** Когда поставлено в очередь самое старое из писем с ошибкой */
    failingSince: IsoTime.nullable(),
  }),
  disk: z.array(DiskSpace),
})
export type InstallationFacts = z.infer<typeof InstallationFacts>

export const InstallationStatus = InstallationFacts.extend({ problems: z.array(StatusProblem) })
export type InstallationStatus = z.infer<typeof InstallationStatus>

/** Пороги проблем. Бэкап раз в сутки, поэтому «старый» — больше двух суток: один пропуск не тревога */
export const STATUS_LIMITS = {
  backupMaxAgeMs: 48 * 60 * 60 * 1000,
  /** Сколько дней показывать откат при обновлении: дальше это история, а не проблема */
  updateNoticeMs: 7 * 24 * 60 * 60 * 1000,
  /**
   * Обновление «идёт» дольше этого — значит, процесс оборвался (перезагрузка): обычно оно
   * занимает минуты, а бэкап перед ним — меньше получаса и у больших медиатек
   */
  updateStaleMs: 60 * 60 * 1000,
  diskMinFreeBytes: 1024 ** 3,
  diskMinFreeShare: 0.1,
  /**
   * Письмо с ошибкой в очереди дольше этого — проблема. Раньше — ещё обычный повтор после
   * разового сбоя сервера почты
   */
  mailFailingMs: 15 * 60 * 1000,
} as const

/**
 * Письма с ошибкой лежат в очереди дольше порога: почта не работает. Раньше — обычный повтор после
 * разового сбоя. Одно правило для проблем, админки и команды status.js
 */
export function mailStuck(
  mail: Pick<InstallationFacts['mail'], 'failing' | 'failingSince'>,
  now: Date,
) {
  return (
    mail.failing > 0 &&
    mail.failingSince !== null &&
    now.getTime() - Date.parse(mail.failingSince) >= STATUS_LIMITS.mailFailingMs
  )
}

const hoursAgo = (iso: string, now: Date) =>
  Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 3_600_000))

/**
 * На что смотреть: одна функция для админки, команды status.js и обзора студии. Порядок — от
 * самого срочного. Сообщения короткие и без путей и адресов: их видит владелец в админке
 */
export function statusProblems(facts: InstallationFacts, now: Date): StatusProblem[] {
  const problems: StatusProblem[] = []
  const add = (code: StatusProblem['code'], message: string) => problems.push({ code, message })

  if (!facts.db.up) add('db_down', 'База не отвечает')

  const { update } = facts
  if (facts.updateUnreadable) {
    add(
      'update_unreadable',
      'Файл состояния обновления не читается: итог последнего обновления неизвестен',
    )
  }
  if (
    update?.result === 'in-progress' &&
    now.getTime() - Date.parse(update.startedAt) > STATUS_LIMITS.updateStaleMs
  ) {
    add(
      'update_interrupted',
      `Обновление до ${update.to} не закончилось за час — похоже, оборвалось: повторите averra.sh update --version ${update.to}, он доведёт прерванное (закончит или откатит)`,
    )
  }
  const recentUpdate =
    update &&
    update.finishedAt !== null &&
    now.getTime() - Date.parse(update.finishedAt) < STATUS_LIMITS.updateNoticeMs
  if (recentUpdate) {
    if (update.result === 'rollback-failed') {
      add(
        'update_rollback_failed',
        `Обновление до ${update.to} не прошло, и откат не удался: нужен человек на сервере`,
      )
    } else if (update.result === 'rolled-back') {
      add(
        'update_rolled_back',
        `Обновление до ${update.to} не прошло проверку — вернулась версия ${update.from}` +
          (update.dbRestored ? ', база восстановлена из бэкапа перед обновлением' : ''),
      )
    }
  }

  if (recentUpdate && update.keptDatabase) {
    add(
      'update_kept_database',
      `После отката обновления до ${update.to} данные, принятые после бэкапа, сохранены в базе ${update.keptDatabase}: перенесите нужное (заявки) — база удалится вместе со старыми бэкапами`,
    )
  }

  // Базу от отката уже назвало update_kept_database — здесь остальные
  const service = facts.db.serviceDatabases.filter(
    (name) => !(recentUpdate && name === update.keptDatabase),
  )
  if (service.length > 0) {
    const manual = service.includes('averra_before_restore')
      ? ' averra_before_restore — прежняя рабочая база неразобранного восстановления: перенесите нужное и удалите её руками.'
      : ''
    const timed = service.some((name) => name !== 'averra_before_restore')
      ? ' Базы с временем в имени удалятся вместе со старыми бэкапами.'
      : ''
    add(
      'db_service_databases',
      `На сервере лежат служебные базы с копиями данных: ${service.join(', ')}.${manual}${timed}`,
    )
  }

  const { backup } = facts
  if (backup.enabled) {
    if (backup.unreadable) add('backup_unreadable', 'Файл состояния бэкапов не читается')
    if (!backup.lastOk) {
      add('backup_missing', 'Удачных бэкапов ещё не было')
    } else if (
      now.getTime() - Date.parse(backup.lastOk.finishedAt) >
      STATUS_LIMITS.backupMaxAgeMs
    ) {
      add(
        'backup_stale',
        `Последний удачный бэкап — ${hoursAgo(backup.lastOk.finishedAt, now)} ч назад`,
      )
    }
    if (backup.last && !backup.last.ok) {
      add(
        'backup_failed',
        `Последний бэкап не удался${backup.last.error ? `: ${backup.last.error}` : ''}`,
      )
    }
    if (backup.last?.remote === 'failed') {
      add('backup_remote_failed', 'Копия последнего бэкапа не выгрузилась во внешнее хранилище')
    }
    if (backup.last?.remote === 'cleanup-failed') {
      add(
        'backup_remote_cleanup_failed',
        'Старые копии бэкапов во внешнем хранилище не удалились: срок хранения нарушается',
      )
    }
  }

  if (!facts.mail.enabled) add('mail_disabled', facts.mail.reason ?? 'Почта выключена')
  if (mailStuck(facts.mail, now)) {
    add(
      'mail_failing',
      `Письма не уходят: в очереди с ошибкой ${facts.mail.failing} — проверьте настройки почты`,
    )
  }
  if (facts.mail.failedRecent > 0) {
    add('mail_failed', `Писем не ушло за неделю: ${facts.mail.failedRecent}`)
  }
  if (facts.publish.failedSites > 0) {
    add('build_failed', `Сайтов с упавшей сборкой: ${facts.publish.failedSites}`)
  }
  for (const disk of facts.disk) {
    const low =
      disk.freeBytes < STATUS_LIMITS.diskMinFreeBytes ||
      (disk.totalBytes > 0 && disk.freeBytes / disk.totalBytes < STATUS_LIMITS.diskMinFreeShare)
    if (low) {
      add('disk_low', `Мало места: ${disk.label} — свободно ${formatGigabytes(disk.freeBytes)}`)
    }
  }
  return problems
}

/** Гигабайты с одним знаком: для места на диске и размеров бэкапов */
export function formatGigabytes(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} ГБ`
}
