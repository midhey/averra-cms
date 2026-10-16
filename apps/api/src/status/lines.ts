import {
  formatGigabytes,
  type InstallationStatus,
  mailStuck,
  SITE_BUILD_STATUS_LABELS,
  updateResultText,
} from '@averra/schema'

// Состояние установки строками для человека в терминале сервера: команда status.js
// (её зовёт deploy/averra.sh status). Слова — те же, что у владельца в админке

const at = (iso: string) => iso.replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC')

/** Состояние строками для человека в терминале сервера */
export function statusLines(status: InstallationStatus) {
  const { backup, update, publish, mail } = status
  const lines = [
    `Версия:      ${status.version}`,
    `База:        ${status.db.up ? `работает, миграций ${status.db.migrations}` : 'не отвечает'}`,
  ]
  if (backup.enabled) {
    const last = backup.last
    lines.push(
      last
        ? `Бэкап:       ${last.name} — ${last.ok ? 'удачный, проверен восстановлением' : `не удался${last.error ? `: ${last.error}` : ''}`}` +
            (last.remote === 'uploaded' ? ', копия во внешнем хранилище' : '') +
            (last.remote === 'failed' ? ', копия НЕ выгрузилась' : '') +
            // У неудачного бэкапа копии не было: чистка хранилища шла без неё
            (last.remote === 'cleanup-failed'
              ? last.ok
                ? ', копия выгружена, но старые копии в хранилище НЕ удалились'
                : '; старые копии в хранилище НЕ удалились'
              : '')
        : 'Бэкап:       ещё не было',
    )
    if (backup.lastOk && backup.lastOk.name !== last?.name) {
      lines.push(`             последний удачный — ${backup.lastOk.name}`)
    }
  } else {
    lines.push('Бэкап:       не ведётся (нет папки состояния STATE_DIR)')
  }
  if (update) {
    lines.push(
      `Обновление:  ${update.from} → ${update.to}, ${updateResultText(update)}, ${at(update.finishedAt ?? update.startedAt)}` +
        (update.keptDatabase ? `; данные после бэкапа — в базе ${update.keptDatabase}` : ''),
    )
  } else if (status.updateUnreadable) {
    lines.push('Обновление:  файл состояния не читается')
  }
  lines.push(
    publish.enabled
      ? `Сборки:      ${publish.last ? `последняя — «${publish.last.siteName}», ${SITE_BUILD_STATUS_LABELS[publish.last.status].toLowerCase()}, ${at(publish.last.at)}` : 'ещё не было'}` +
          (publish.failedSites > 0 ? `; упавших сайтов: ${publish.failedSites}` : '')
      : 'Сборки:      публикация на сервере выключена',
    `Почта:       ${!mail.enabled ? `выключена — ${mail.reason}` : mailStuck(mail, new Date(status.checkedAt)) ? 'письма не уходят' : 'включена'}; не ушло за неделю: ${mail.failedRecent}, ждут: ${mail.pending}, из них с ошибкой: ${mail.failing}`,
  )
  if (status.db.serviceDatabases.length > 0) {
    lines.push(`Служебные базы: ${status.db.serviceDatabases.join(', ')}`)
  }
  for (const disk of status.disk) {
    lines.push(
      `Диск:        ${disk.label} — свободно ${formatGigabytes(disk.freeBytes)} из ${formatGigabytes(disk.totalBytes)}`,
    )
  }
  lines.push(
    status.problems.length === 0
      ? 'Проблем нет'
      : `Проблемы:\n${status.problems.map((problem) => `  • ${problem.message}`).join('\n')}`,
  )
  return lines
}
