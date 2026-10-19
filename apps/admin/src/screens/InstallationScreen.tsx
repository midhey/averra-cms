import { useSuspenseQuery } from '@tanstack/react-query'
import { RelativeTime } from '../pages/PagesTable'
import { formatDateTime } from '../pages-format'
import { buildStatusLabels } from '../publish/build-format'
import { statusQuery } from '../queries'
import { describeBackup, describeDisk, describeMail, describeUpdate } from '../status/status-format'
import { Button } from '../ui/Button'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { Facts, mutedClassName, Screen, Section } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'
import { usePageTitle } from '../ui/use-page-title'
import styles from './InstallationScreen.module.scss'

/**
 * Состояние установки — только владельцу: версия, база, бэкапы, обновление, публикация, почта,
 * место на диске и что требует внимания. Что считать проблемой, решает API (statusProblems)
 */
export function InstallationScreen() {
  // Данные загрузил маршрут (fetchQuery). Обновить — по кнопке, сам экран не опрашивает.
  // Сбой повторной проверки не прячет прошлую: она остаётся на экране с ошибкой сверху
  const status = useSuspenseQuery(statusQuery())
  usePageTitle('Состояние установки')
  const data = status.data

  return (
    <Screen narrow>
      <PageHeader
        eyebrow="Установка"
        title="Состояние установки"
        meta={
          <>
            <span className={styles.version}>{data.version}</span>
            {data.problems.length === 0 ? (
              <StatusPill tone="success" appearance="dot">
                всё в порядке
              </StatusPill>
            ) : (
              <StatusPill tone="warning" appearance="dot">
                требует внимания
              </StatusPill>
            )}
            <span>
              проверено <RelativeTime iso={data.checkedAt} />
            </span>
          </>
        }
        actions={
          <Button icon="history" loading={status.isFetching} onClick={() => status.refetch()}>
            Проверить снова
          </Button>
        }
      />

      {status.isRefetchError && (
        <InlineAlert tone="danger">
          Не удалось обновить состояние: {status.error.message}. Ниже — прошлая проверка.
        </InlineAlert>
      )}

      {data.problems.length > 0 && (
        <InlineAlert tone="warning" title="Требует внимания">
          <ul className={styles.problems}>
            {data.problems.map((problem) => (
              <li key={`${problem.code}-${problem.message}`}>{problem.message}</li>
            ))}
          </ul>
        </InlineAlert>
      )}

      <Section title="Сведения" card>
        <Facts
          items={[
            ['Версия', <span className={styles.version}>{data.version}</span>],
            [
              'База',
              data.db.up ? `работает, миграций применено: ${data.db.migrations}` : 'не отвечает',
            ],
            [
              'Бэкап',
              <>
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
              </>,
            ],
            ...(data.update ? [['Обновление', describeUpdate(data.update)] as const] : []),
            [
              'Публикация',
              !data.publish.enabled
                ? 'сайты на этом сервере не собираются'
                : data.publish.last
                  ? `последняя сборка — «${data.publish.last.siteName}», ${buildStatusLabels[data.publish.last.status].toLowerCase()}, ${formatDateTime(data.publish.last.at)}`
                  : 'сборок ещё не было',
            ],
            ['Почта', describeMail(data.mail, new Date(data.checkedAt))],
            ...data.disk.map((disk) => [`Диск: ${disk.label}`, describeDisk(disk)] as const),
          ]}
        />
        <p className={mutedClassName}>
          Проверено <time dateTime={data.checkedAt}>{formatDateTime(data.checkedAt)}</time>.
        </p>
      </Section>
    </Screen>
  )
}
