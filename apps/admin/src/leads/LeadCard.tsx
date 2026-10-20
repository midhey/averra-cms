import type { LeadStatus } from '@averra/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { api } from '../api'
import { apiRequestError, messageOf } from '../errors'
import { formatDateTime, pagePath } from '../pages-format'
import { queryKeys } from '../queries'
import { Button, buttonClassName } from '../ui/Button'
import { cardClassName } from '../ui/Card'
import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import { Facts } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'
import styles from './LeadCard.module.scss'
import {
  displayValue,
  fieldHref,
  type LeadField,
  leadEmail,
  leadName,
  leadStatusLabels,
  leadStatusTones,
  replyMailto,
} from './lead-format'

type Lead = {
  id: string
  pageSlug: string
  formTitle: string
  data: unknown
  consentText: string
  consentPolicyUrl: string
  pageVersion: number | null
  consentedAt: string
  status: LeadStatus
  processedAt: string | null
  createdAt: string
}

type LeadCardProps = {
  site: { id: string; name: string }
  lead: Lead
  /** Заголовок страницы с формой, если она ещё есть */
  pageTitle?: string | undefined
  /** Вкладка списка: после удаления возвращаемся на неё */
  status: LeadStatus | undefined
  /** Заявку удалили и вернулись к списку: куда перевести фокус */
  onDeleted?: () => void
}

/**
 * Заявка целиком, как в концепте: кто и откуда, поля, согласие на обработку персональных данных
 * и действия — «обработана», «Ответить письмом» (если посетитель оставил почту) и удаление
 */
export function LeadCard({ site, lead, pageTitle, status, onDeleted }: LeadCardProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const headingId = useId()
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()
  const fields = lead.data as LeadField[]
  const name = leadName(fields)
  const email = leadEmail(fields)
  const created = formatDateTime(lead.createdAt)
  const siteId = site.id
  const leadId = lead.id

  // Меняется и список, и счётчик новых в панели
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.leads(siteId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.site(siteId), exact: true }),
    ])

  const setStatus = useMutation({
    mutationFn: async (next: LeadStatus) => {
      const res = await api.sites[':siteId'].leads[':leadId'].$patch({
        param: { siteId, leadId },
        json: { status: next },
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
      await navigate({
        to: '/sites/$siteId/leads',
        params: { siteId },
        search: status ? { status } : {},
      })
      onDeleted?.()
    },
    onError: (failure) => setError(`Не удалось удалить заявку: ${messageOf(failure)}`),
  })

  function confirmRemove() {
    const question = `Удалить заявку «${name}» от ${created}? Вернуть её не получится.`
    if (window.confirm(question)) remove.mutate()
  }

  const busy = setStatus.isPending || remove.isPending

  return (
    <article aria-labelledby={headingId} className={cx(cardClassName(), styles.card)}>
      {/* На телефоне карточка открыта вместо списка: путь назад к нему */}
      <Link
        to="/sites/$siteId/leads"
        params={{ siteId }}
        search={status ? { status } : {}}
        className={styles.back}
      >
        <Icon name="chevron-left" size={16} />
        Все заявки
      </Link>

      <div className={styles.head}>
        <div className={styles.title}>
          <h2 id={headingId} className={styles.name}>
            {name}
          </h2>
          <p className={styles.meta}>
            <time dateTime={lead.createdAt}>{created}</time> · страница{' '}
            {pageTitle && <>«{pageTitle}» </>}
            <code className={styles.mono}>{pagePath(lead.pageSlug)}</code>, форма «{lead.formTitle}»
          </p>
          {lead.status === 'processed' && lead.processedAt && (
            <p className={styles.meta}>
              Обработана <time dateTime={lead.processedAt}>{formatDateTime(lead.processedAt)}</time>
            </p>
          )}
        </div>
        <StatusPill tone={leadStatusTones[lead.status]} className={styles.pill}>
          {leadStatusLabels[lead.status]}
        </StatusPill>
      </div>

      <Facts
        label="Поля заявки"
        items={fields.map((field) => {
          // Телефон и почта — ссылками, как в концепте: позвонить или написать в одно касание
          const href = fieldHref(field)
          return [
            field.label,
            href ? <a href={href}>{displayValue(field)}</a> : displayValue(field),
          ] as const
        })}
      />

      <section aria-label="Согласие на обработку персональных данных" className={styles.consent}>
        <p className={styles.consentTitle}>Согласие на обработку персональных данных</p>
        <p>
          Дано <time dateTime={lead.consentedAt}>{formatDateTime(lead.consentedAt)}</time> ·
          политика: {lead.consentPolicyUrl} · версия страницы {lead.pageVersion ?? '—'}
        </p>
        <p className={styles.consentText}>Текст у флажка: «{lead.consentText}»</p>
      </section>

      {done && !error && (
        <InlineAlert tone="success" live>
          {done}
        </InlineAlert>
      )}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      <div className={styles.actions}>
        {lead.status === 'new' ? (
          <Button
            variant="primary"
            icon="check"
            loading={setStatus.isPending}
            disabled={remove.isPending}
            onClick={() => setStatus.mutate('processed')}
          >
            Отметить обработанной
          </Button>
        ) : (
          <Button
            loading={setStatus.isPending}
            disabled={remove.isPending}
            onClick={() => setStatus.mutate('new')}
          >
            Вернуть в новые
          </Button>
        )}
        {email && (
          <a href={replyMailto(email, site.name)} className={buttonClassName()}>
            <Icon name="mail" />
            Ответить письмом
          </a>
        )}
        <Button
          variant="danger"
          icon="trash"
          className={styles.remove}
          disabled={busy}
          onClick={confirmRemove}
        >
          Удалить
        </Button>
      </div>
    </article>
  )
}
