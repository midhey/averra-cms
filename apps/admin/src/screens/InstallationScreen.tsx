import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { RelativeTime } from '../pages/PagesTable'
import { formatDateTime } from '../pages-format'
import { buildStatusLabels } from '../publish/build-format'
import { statusQuery } from '../queries'
import { describeBackup, describeDisk, describeMail, describeUpdate } from '../status/status-format'
import { UpdateSection } from '../status/UpdateSection'
import { shouldPoll } from '../status/update-format'
import { Button } from '../ui/Button'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { Facts, mutedClassName, Screen, Section } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'
import { usePageTitle } from '../ui/use-page-title'
import styles from './InstallationScreen.module.scss'

/**
 * Версия этой сборки админки: её вшивает сборка образа (VITE_AVERRA_VERSION в deploy/Dockerfile).
 * После обновления API отвечает новой версией — значит, Caddy уже раздаёт новую админку, и
 * страницу стоит обновить. В разработке версии сборки нет — сравниваем с первым ответом API
 */
const ADMIN_BUILD_VERSION: string | undefined = import.meta.env.VITE_AVERRA_VERSION || undefined

/** Как часто опрашивать состояние, пока идёт заявка или обновление */
const UPDATE_POLL_MS = 3000

/**
 * Состояние установки — только владельцу: версия, база, бэкапы, обновление, публикация, почта,
 * место на диске и что требует внимания. Что считать проблемой, решает API (statusProblems)
 */
export function InstallationScreen() {
  // Данные загрузил маршрут (fetchQuery). Обновить — по кнопке; сам экран опрашивает, только пока
  // идёт заявка или обновление. Сбой повторной проверки не прячет прошлую: она остаётся на экране.
  // Посреди обновления API перезапускается — опрос продолжается по прошлым данным, пока он не
  // вернётся с итогом
  const status = useSuspenseQuery({
    ...statusQuery(),
    // Время — проверки API, а не часов браузера: «идёт ли» решают те же часы, что записали ход
    refetchInterval: (query) => {
      const data = query.state.data
      return data && shouldPoll(data, new Date(data.checkedAt)) ? UPDATE_POLL_MS : false
    },
    refetchIntervalInBackground: true,
  })
  usePageTitle('Состояние установки')
  const data = status.data
  const [firstVersion] = useState(data.version)
  const loadedVersion = ADMIN_BUILD_VERSION ?? firstVersion
  const updating = shouldPoll(data, new Date(data.checkedAt))

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

      {status.isRefetchError && !updating && (
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

      <UpdateSection
        status={data}
        now={new Date(data.checkedAt)}
        loadedVersion={loadedVersion}
        offline={status.isRefetchError}
      />

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
