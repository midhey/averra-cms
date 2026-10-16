import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { api } from '../api'
import { apiRequestError, messageOf } from '../errors'
import { formatDateTime } from '../pages-format'
import { buildQuery, queryKeys } from '../queries'
import styles from '../screens/screens.module.css'
import { buildStatusLabels, formatMegabytes, isBuildActive } from './build-format'

/** Как часто спрашивать состояние, пока сборка ждёт или идёт */
const POLL_MS = 2000

/**
 * Сборка сайта на сервере (модуль 9): какая версия сейчас на сайте, что с последней сборкой
 * и «Собрать заново». Только на установке с публикацией (PUBLISH_DIR): без неё раздела нет.
 * Второстепенный раздел: данные грузит маршрут сайта, а сбой показывается здесь, не вместо экрана
 */
export function BuildSection({ siteId, canBuild }: { siteId: string; canBuild: boolean }) {
  const queryClient = useQueryClient()
  const headingId = useId()
  const build = useQuery({
    ...buildQuery(siteId),
    retryOnMount: false,
    refetchInterval: (query) =>
      isBuildActive(query.state.data?.latest?.status ?? undefined) ? POLL_MS : false,
  })

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

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId}>Сайт на сервере</h2>
      {build.error && (
        <p className={styles.muted}>
          Не удалось узнать, как собран сайт: {messageOf(build.error)}.{' '}
          <button type="button" onClick={() => build.refetch()}>
            Повторить
          </button>
        </p>
      )}
      {build.data && (
        <>
          <p>
            {live?.finishedAt ? (
              <>
                На сайте версия, собранная{' '}
                <time dateTime={live.finishedAt}>{formatDateTime(live.finishedAt)}</time>
                {live.peakRssBytes !== null &&
                  ` (сборка заняла ${formatMegabytes(live.peakRssBytes)} памяти)`}
                .
              </>
            ) : (
              'Сайт ещё не собран: опубликуйте страницу или нажмите «Собрать заново».'
            )}
          </p>
          {/* Состояние меняется само (опрос): role="status" читает его диктору */}
          <p role="status">
            {active &&
              latest &&
              `${buildStatusLabels[latest.status]}: новая версия появится на сайте после сборки.`}
          </p>
          {latest?.status === 'failed' && (
            <div role="alert" className={styles.formError}>
              <p>
                Последняя сборка упала
                {latest.finishedAt && (
                  <>
                    {' '}
                    <time dateTime={latest.finishedAt}>{formatDateTime(latest.finishedAt)}</time>
                  </>
                )}
                . На сайте осталась прежняя версия.
              </p>
              <pre className={styles.buildLog}>{latest.error}</pre>
            </div>
          )}
          {canBuild && (
            <div className={styles.actions}>
              <button
                type="button"
                disabled={active || rebuild.isPending}
                onClick={() => rebuild.mutate()}
              >
                Собрать заново
              </button>
            </div>
          )}
          {rebuild.error && (
            <p role="alert" className={styles.formError}>
              Не удалось поставить сборку: {messageOf(rebuild.error)}
            </p>
          )}
        </>
      )}
    </section>
  )
}
