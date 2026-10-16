import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { messageOf } from '../errors'
import { formatDateTime } from '../pages-format'
import { buildStatusLabels } from '../publish/build-format'
import { statusQuery } from '../queries'
import styles from '../screens/screens.module.css'
import { describeBackup, describeDisk, describeMail, describeUpdate } from './status-format'

/**
 * Состояние установки у владельца на экране сайтов: версия, бэкапы, обновление, сборки, почта,
 * место на диске и что требует внимания. Данные грузит маршрут; сбой — внутри блока
 */
export function StatusSection() {
  const headingId = useId()
  const status = useQuery({ ...statusQuery(), retryOnMount: false })
  const data = status.data

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId}>Состояние установки</h2>
      {status.error && (
        <p className={styles.muted}>
          Не удалось узнать состояние: {messageOf(status.error)}.{' '}
          <button type="button" onClick={() => status.refetch()}>
            Повторить
          </button>
        </p>
      )}
      {data && (
        <>
          {data.problems.length === 0 ? (
            <p className={styles.notice}>Всё в порядке.</p>
          ) : (
            <div>
              <p className={styles.formError}>Требует внимания:</p>
              <ul className={styles.problems}>
                {data.problems.map((problem) => (
                  <li key={`${problem.code}-${problem.message}`}>{problem.message}</li>
                ))}
              </ul>
            </div>
          )}
          <dl className={styles.facts}>
            <dt>Версия</dt>
            <dd>{data.version}</dd>
            <dt>База</dt>
            <dd>
              {data.db.up ? `работает, миграций применено: ${data.db.migrations}` : 'не отвечает'}
            </dd>
            <dt>Бэкап</dt>
            <dd>
              {!data.backup.enabled
                ? 'не ведётся на этой установке (разработка)'
                : data.backup.last
                  ? describeBackup(data.backup.last)
                  : 'ещё не было'}
              {data.backup.lastOk && data.backup.lastOk.name !== data.backup.last?.name && (
                <>
                  <br />
                  Последний удачный: {describeBackup(data.backup.lastOk)}
                </>
              )}
            </dd>
            {data.update && (
              <>
                <dt>Обновление</dt>
                <dd>{describeUpdate(data.update)}</dd>
              </>
            )}
            <dt>Публикация</dt>
            <dd>
              {!data.publish.enabled
                ? 'сайты на этом сервере не собираются'
                : data.publish.last
                  ? `последняя сборка — «${data.publish.last.siteName}», ${buildStatusLabels[data.publish.last.status].toLowerCase()}, ${formatDateTime(data.publish.last.at)}`
                  : 'сборок ещё не было'}
            </dd>
            <dt>Почта</dt>
            <dd>{describeMail(data.mail, new Date(data.checkedAt))}</dd>
            {data.disk.map((disk) => (
              <DiskRow key={disk.label} label={disk.label} text={describeDisk(disk)} />
            ))}
          </dl>
          <p className={styles.muted}>
            Проверено <time dateTime={data.checkedAt}>{formatDateTime(data.checkedAt)}</time>.
          </p>
        </>
      )}
    </section>
  )
}

function DiskRow({ label, text }: { label: string; text: string }) {
  return (
    <>
      <dt>Диск: {label}</dt>
      <dd>{text}</dd>
    </>
  )
}
