import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { apiRequestError, messageOf } from '../errors'
import { RelativeTime } from '../pages/PagesTable'
import { formatDateTime } from '../pages-format'
import { queryKeys } from '../queries'
import { Button } from '../ui/Button'
import { InlineAlert } from '../ui/InlineAlert'
import { Facts, Section } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'
import styles from './BuildSection.module.scss'
import {
  buildStatusLabels,
  buildSummary,
  failedBuildOutcome,
  formatMegabytes,
  isBuildActive,
} from './build-format'
import { useBuild } from './use-build'

/**
 * Сборка сайта на сервере: какая версия сейчас на сайте, что с последней сборкой
 * и «Собрать заново». Только на установке с публикацией (PUBLISH_DIR): без неё раздела нет.
 * Второстепенный раздел: данные грузит маршрут, а сбой показывается здесь, не вместо экрана
 */
export function BuildSection({
  siteId,
  canBuild,
  id,
}: {
  siteId: string
  canBuild: boolean
  id?: string
}) {
  const queryClient = useQueryClient()
  const build = useBuild(siteId)

  const rebuild = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId'].build.$post({ param: { siteId } })
      if (res.status !== 202) throw await apiRequestError(res)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.build(siteId) }),
  })

  if (build.data && !build.data.enabled) return null
  const latest = build.data?.latest ?? null
  const live = build.data?.live ?? null
  const active = isBuildActive(latest?.status)
  const summary = latest ? buildSummary(latest) : undefined

  return (
    <Section
      id={id}
      title="Сайт на сервере"
      description="После публикации сайт собирается в готовые страницы, их и видят посетители."
      card
      actions={
        canBuild &&
        build.data && (
          <Button
            icon="history"
            loading={rebuild.isPending}
            disabled={active}
            onClick={() => rebuild.mutate()}
          >
            Собрать заново
          </Button>
        )
      }
    >
      {build.error && (
        <InlineAlert
          tone="warning"
          action={
            <Button size="small" onClick={() => build.refetch()}>
              Повторить
            </Button>
          }
        >
          Не удалось узнать, как собран сайт: {messageOf(build.error)}
        </InlineAlert>
      )}
      {build.data && (
        <>
          <Facts
            items={[
              [
                'На сайте',
                live?.finishedAt ? (
                  <>
                    версия, собранная{' '}
                    <time dateTime={live.finishedAt}>{formatDateTime(live.finishedAt)}</time>
                    {live.peakRssBytes !== null &&
                      ` (сборка заняла ${formatMegabytes(live.peakRssBytes)} памяти)`}
                  </>
                ) : (
                  'Сайт ещё не собран: опубликуйте страницу или нажмите «Собрать заново».'
                ),
              ],
              [
                'Последняя сборка',
                latest && summary ? (
                  <span className={styles.latest}>
                    <StatusPill tone={summary.tone} appearance="dot">
                      {summary.label}
                    </StatusPill>
                    <span className={styles.muted}>
                      <RelativeTime iso={summary.at} />
                    </span>
                  </span>
                ) : (
                  'ещё не было'
                ),
              ],
            ]}
          />
          {/* Состояние меняется само (опрос): role="status" читает его диктору */}
          <p role="status" className={styles.progress}>
            {active &&
              latest &&
              `${buildStatusLabels[latest.status]}: новая версия появится на сайте после сборки.`}
          </p>
          {latest?.status === 'failed' && (
            <InlineAlert tone="danger" title="Последняя сборка упала">
              <p>
                {latest.finishedAt && (
                  <>
                    <time dateTime={latest.finishedAt}>{formatDateTime(latest.finishedAt)}</time>.{' '}
                  </>
                )}
                {failedBuildOutcome(Boolean(live?.finishedAt))}
              </p>
              <pre className={styles.log}>{latest.error}</pre>
            </InlineAlert>
          )}
          {rebuild.error && (
            <InlineAlert tone="danger">
              Не удалось поставить сборку: {messageOf(rebuild.error)}
            </InlineAlert>
          )}
        </>
      )}
    </Section>
  )
}
