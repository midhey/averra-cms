import {
  type BackupRun,
  formatGigabytes,
  type InstallationStatus,
  mailStuck,
  type UpdateRun,
  updateResultText,
} from '@averra/schema'
import { formatDateTime } from '../pages-format'

// Состояние установки словами. Что считать проблемой, решает API (statusProblems), здесь — слова

/** Размер бэкапа: мегабайты, а гигабайты — для больших */
export function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return formatGigabytes(bytes)
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} МБ`
}

const backupKinds: Record<BackupRun['kind'], string> = {
  scheduled: 'по расписанию',
  manual: 'вручную',
  'pre-update': 'перед обновлением',
}

/** Бэкап одной строкой: когда, откуда, чем кончился, размер и внешняя копия */
export function describeBackup(run: BackupRun) {
  const when = `${formatDateTime(run.finishedAt)}, ${backupKinds[run.kind]}`
  if (!run.ok) return `${when} — не удался${run.error ? `: ${run.error}` : ''}`
  const size = (run.dbBytes ?? 0) + (run.mediaBytes ?? 0)
  const remote = {
    off: '',
    uploaded: ', копия во внешнем хранилище',
    failed: ', копия во внешнее хранилище не выгрузилась',
    'cleanup-failed': ', копия во внешнем хранилище, но старые копии там не удалились',
  }[run.remote]
  return `${when} — ${run.verified ? 'проверен восстановлением' : 'не проверен'}, ${formatSize(size)}${remote}`
}

export function describeUpdate(run: UpdateRun) {
  const kept = run.keptDatabase
    ? `; данные, принятые после бэкапа, сохранены в базе ${run.keptDatabase}`
    : ''
  const when = formatDateTime(run.finishedAt ?? run.startedAt)
  return `${run.from} → ${run.to}, ${when}: ${updateResultText(run)}${run.dbRestored ? ' (база восстановлена из бэкапа)' : ''}${kept}`
}

/**
 * Почта одной строкой: работает ли и что с очередью. «Не уходят» — по тому же порогу, что
 * проблема mail_failing: свежая ошибка — ещё повтор после разового сбоя
 */
export function describeMail(mail: InstallationStatus['mail'], now: Date) {
  const state = !mail.enabled
    ? `выключена: ${mail.reason ?? 'причина неизвестна'}`
    : mailStuck(mail, now)
      ? `письма не уходят — в очереди с ошибкой: ${mail.failing}`
      : mail.failing > 0
        ? `работает, повторяет отправку после ошибки: ${mail.failing}`
        : 'работает'
  return `${state}; не ушло за неделю: ${mail.failedRecent}, ждут отправки: ${mail.pending}`
}

/** Место на диске: свободно из всего и доля */
export function describeDisk(disk: { freeBytes: number; totalBytes: number }) {
  const share = disk.totalBytes > 0 ? Math.round((disk.freeBytes / disk.totalBytes) * 100) : 0
  return `свободно ${formatGigabytes(disk.freeBytes)} из ${formatGigabytes(disk.totalBytes)} (${share} %)`
}
