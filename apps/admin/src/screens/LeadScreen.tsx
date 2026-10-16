import type { LeadStatus } from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { api } from '../api'
import { apiRequestError, messageOf } from '../errors'
import { displayValue, type LeadField, leadStatusLabels } from '../leads/lead-format'
import { formatDateTime, pagePath } from '../pages-format'
import { leadQuery, queryKeys, siteQuery } from '../queries'
import { Breadcrumbs } from '../ui/Breadcrumbs'
import { usePageTitle } from '../ui/use-page-title'
import styles from './screens.module.css'

const route = getRouteApi('/sites/$siteId/leads/$leadId')

/** Карточка заявки: все поля, согласие, «Обработана» / «Вернуть в новые» и удаление */
export function LeadScreen() {
  const { siteId, leadId } = route.useParams()
  return <LeadCard key={leadId} siteId={siteId} leadId={leadId} />
}

function LeadCard({ siteId, leadId }: { siteId: string; leadId: string }) {
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data: lead } = useSuspenseQuery(leadQuery(siteId, leadId))
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const fieldsHeadingId = useId()
  const consentHeadingId = useId()
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()
  const created = formatDateTime(lead.createdAt)
  usePageTitle(`Заявка от ${created}`, site.name)

  // Меняется и список, и счётчик новых в навигации сайта
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.leads(siteId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.site(siteId), exact: true }),
    ])

  const setStatus = useMutation({
    mutationFn: async (status: LeadStatus) => {
      const res = await api.sites[':siteId'].leads[':leadId'].$patch({
        param: { siteId, leadId },
        json: { status },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (updated) => {
      await refresh()
      setError(undefined)
      setDone(updated.status === 'processed' ? 'Заявка обработана' : 'Заявка снова новая')
    },
    onError: (failure) => setError(`Не удалось поменять состояние: ${messageOf(failure)}`),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId'].leads[':leadId'].$delete({
        param: { siteId, leadId },
      })
      if (res.status !== 204) throw await apiRequestError(res)
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: queryKeys.lead(siteId, leadId) })
      await refresh()
      await navigate({ to: '/sites/$siteId/leads', params: { siteId } })
    },
    onError: (failure) => setError(`Не удалось удалить заявку: ${messageOf(failure)}`),
  })

  function confirmRemove() {
    const question = `Удалить заявку от ${created}? Вернуть её не получится.`
    if (window.confirm(question)) remove.mutate()
  }

  const busy = setStatus.isPending || remove.isPending

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Breadcrumbs site={site} current="Заявка" />
        <p>
          <Link to="/sites/$siteId/leads" params={{ siteId }} className={styles.pageLink}>
            ← Все заявки
          </Link>
        </p>
        <h1>Заявка от {created}</h1>
      </header>

      <section aria-labelledby={fieldsHeadingId} className={styles.section}>
        <h2 id={fieldsHeadingId}>{lead.formTitle}</h2>
        <dl className={styles.details}>
          {(lead.data as LeadField[]).map((field) => (
            <div key={field.name}>
              <dt>{field.label}</dt>
              <dd>{displayValue(field)}</dd>
            </div>
          ))}
          <div>
            <dt>Страница</dt>
            <dd>
              <code>{pagePath(lead.pageSlug)}</code>
            </dd>
          </div>
          <div>
            <dt>Состояние</dt>
            <dd>
              {leadStatusLabels[lead.status]}
              {lead.processedAt && <> · {formatDateTime(lead.processedAt)}</>}
            </dd>
          </div>
        </dl>
        <div className={styles.actions}>
          {lead.status === 'new' ? (
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => setStatus.mutate('processed')}
            >
              Отметить обработанной
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => setStatus.mutate('new')}>
              Вернуть в новые
            </button>
          )}
          <button type="button" className={styles.danger} disabled={busy} onClick={confirmRemove}>
            Удалить заявку
          </button>
        </div>
        {done && !error && (
          <p role="status" className={styles.notice}>
            {done}
          </p>
        )}
        {error && (
          <p role="alert" className={styles.formError}>
            {error}
          </p>
        )}
      </section>

      <section aria-labelledby={consentHeadingId} className={styles.section}>
        <h2 id={consentHeadingId}>Согласие на обработку персональных данных</h2>
        <dl className={styles.details}>
          <div>
            <dt>Текст у флажка</dt>
            <dd>{lead.consentText}</dd>
          </div>
          <div>
            <dt>Политика</dt>
            <dd>{lead.consentPolicyUrl}</dd>
          </div>
          <div>
            <dt>Версия страницы</dt>
            <dd>{lead.pageVersion ?? '—'}</dd>
          </div>
          <div>
            <dt>Когда дано</dt>
            <dd>
              <time dateTime={lead.consentedAt}>{formatDateTime(lead.consentedAt)}</time>
            </dd>
          </div>
        </dl>
      </section>
    </main>
  )
}
