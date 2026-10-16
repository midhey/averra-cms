import { LeadSettings, type LeadStatus } from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { type FormEvent, useId, useRef, useState } from 'react'
import { api } from '../api'
import { saveResponse } from '../download'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import {
  type LeadField,
  leadStatusLabels,
  leadSummary,
  parseRecipients,
  recipientsError,
} from '../leads/lead-format'
import { formatDateTime, pagePath } from '../pages-format'
import { leadSettingsQuery, leadsQuery, queryKeys, siteQuery } from '../queries'
import { Breadcrumbs } from '../ui/Breadcrumbs'
import { TextField } from '../ui/TextField'
import { usePageTitle } from '../ui/use-page-title'
import styles from './screens.module.css'

const route = getRouteApi('/sites/$siteId/leads')

type Notice = { kind: 'done' | 'error'; text: string }

const filters: readonly { status: LeadStatus | undefined; label: string }[] = [
  { status: undefined, label: 'Все' },
  { status: 'new', label: 'Новые' },
  { status: 'processed', label: 'Обработанные' },
]

/** Заявки с форм сайта: список с фильтром, выгрузка CSV и настройки уведомлений */
export function LeadsScreen() {
  const { siteId } = route.useParams()
  // Как у других экранов сайта: сообщения одного сайта не переезжают на другой
  return <SiteLeads key={siteId} siteId={siteId} />
}

function SiteLeads({ siteId }: { siteId: string }) {
  const { status } = route.useSearch()
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data } = useSuspenseQuery(leadsQuery(siteId, status))
  const listHeadingId = useId()
  const [notice, setNotice] = useState<Notice>()
  usePageTitle('Заявки', site.name)
  const { notifications, items } = data

  const download = useMutation({
    mutationFn: () => downloadCsv(siteId),
    onSuccess: () => setNotice({ kind: 'done', text: 'Файл CSV со всеми заявками скачан' }),
    onError: (error) =>
      setNotice({ kind: 'error', text: `Не удалось выгрузить заявки: ${messageOf(error)}` }),
  })

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Breadcrumbs site={site} current="Заявки" />
        <h1>Заявки</h1>
      </header>

      {notifications.enabled ? (
        <p className={`${styles.muted} ${styles.intro}`}>
          Уведомления о новых заявках уходят{' '}
          {notifications.recipients === 'owners'
            ? 'владельцам админки'
            : 'на адреса из настроек ниже'}
          .
        </p>
      ) : (
        <p role="alert" className={`${styles.formError} ${styles.intro}`}>
          Уведомления о заявках не уходят: {notifications.reason} Заявки сохраняются здесь —
          заглядывайте в раздел сами.
        </p>
      )}

      <section aria-labelledby={listHeadingId} className={styles.section}>
        <h2 id={listHeadingId}>Список</h2>
        <div className={styles.toolbar}>
          <nav aria-label="Какие заявки показать" className={styles.filters}>
            {filters.map((filter) => (
              <Link
                key={filter.label}
                to="/sites/$siteId/leads"
                params={{ siteId }}
                search={filter.status ? { status: filter.status } : {}}
                aria-current={filter.status === status ? 'page' : undefined}
                className={styles.filter}
              >
                {filter.label}
              </Link>
            ))}
          </nav>
          <button type="button" disabled={download.isPending} onClick={() => download.mutate()}>
            Выгрузить CSV
          </button>
        </div>
        {items.length === 0 ? (
          <p className={styles.empty}>
            {status === undefined ? 'Заявок пока нет.' : 'Таких заявок нет.'}
          </p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table} aria-labelledby={listHeadingId}>
              <thead>
                <tr>
                  <th scope="col">Заявка</th>
                  <th scope="col">Когда</th>
                  <th scope="col">Страница</th>
                  <th scope="col">Состояние</th>
                </tr>
              </thead>
              <tbody>
                {items.map((lead) => (
                  <tr key={lead.id} data-status={lead.status}>
                    <td>
                      <Link
                        to="/sites/$siteId/leads/$leadId"
                        params={{ siteId, leadId: lead.id }}
                        className={styles.pageLink}
                      >
                        {leadSummary(lead.data as LeadField[])}
                      </Link>
                    </td>
                    <td>
                      <time dateTime={lead.createdAt}>{formatDateTime(lead.createdAt)}</time>
                    </td>
                    <td>
                      <code>{pagePath(lead.pageSlug)}</code>
                    </td>
                    <td>
                      <span className={styles.state} data-new={lead.status === 'new'}>
                        {leadStatusLabels[lead.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {notice?.kind === 'done' && (
          <p role="status" className={styles.notice}>
            {notice.text}
          </p>
        )}
        {notice?.kind === 'error' && (
          <p role="alert" className={styles.formError}>
            {notice.text}
          </p>
        )}
      </section>

      <LeadSettingsSection siteId={siteId} />
    </main>
  )
}

/** CSV — потоком из API, имя файла из ответа (saveResponse) */
async function downloadCsv(siteId: string) {
  const res = await api.sites[':siteId'].leads.export.$get({ param: { siteId } })
  if (res.status !== 200) throw await apiRequestError(res)
  await saveResponse(res, 'leads.csv')
}

const settingsFieldOrder = ['recipients', 'retentionDays']

function LeadSettingsSection({ siteId }: { siteId: string }) {
  const { data: saved } = useSuspenseQuery(leadSettingsQuery(siteId))
  const queryClient = useQueryClient()
  const headingId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [recipients, setRecipients] = useState(saved.recipients.join(', '))
  const [retentionDays, setRetentionDays] = useState(String(saved.retentionDays))
  const [confirmToVisitor, setConfirmToVisitor] = useState(saved.confirmToVisitor)
  const [notice, setNotice] = useState<Notice>()

  const addresses = parseRecipients(recipients)
  const parsed = LeadSettings.safeParse({
    recipients: addresses,
    retentionDays: Number(retentionDays),
    confirmToVisitor,
  })
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const save = useMutation({
    mutationFn: async (body: LeadSettings) => {
      const res = await api.sites[':siteId'].leads.settings.$put({ param: { siteId }, json: body })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (settings) => {
      setRecipients(settings.recipients.join(', '))
      setRetentionDays(String(settings.retentionDays))
      await queryClient.invalidateQueries({ queryKey: queryKeys.leads(siteId) })
      setNotice({ kind: 'done', text: 'Настройки заявок сохранены' })
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.issues.length > 0) {
        form.showServerErrors(issueFieldErrors(error.issues))
      } else {
        setNotice({ kind: 'error', text: `Не удалось сохранить: ${messageOf(error)}` })
      }
    },
  })

  const recipientsMessage = recipientsError(form.errors, addresses)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    form.attempt()
    setNotice(undefined)
    if (!parsed.success) {
      // Ошибки адресов приходят по пути recipients.N, а поле одно — recipients
      const errors = zodFieldErrors(parsed.error)
      const target = recipientsError(errors, addresses)
        ? 'recipients'
        : firstInvalidField(settingsFieldOrder, errors)
      focusField(formRef.current, target)
      return
    }
    save.mutate(parsed.data)
  }

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId}>Настройки заявок</h2>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={styles.form}
        onSubmit={submit}
        noValidate
      >
        <TextField
          label="Адреса для уведомлений"
          name="recipients"
          value={recipients}
          onChange={(value) => {
            setRecipients(value)
            form.clearServerError('recipients')
          }}
          error={recipientsMessage}
          hint="Через запятую, до 10 адресов. Пусто — уведомления получают владельцы админки. О смене адресов письмом узнают владельцы и прежние адреса"
        />
        <TextField
          label="Хранить заявки, дней"
          name="retentionDays"
          value={retentionDays}
          onChange={(value) => {
            setRetentionDays(value)
            form.clearServerError('retentionDays')
          }}
          error={form.errors.retentionDays}
          hint="От 7 до 1825. Старые заявки удаляются сами: в них персональные данные посетителей"
        />
        <label className={styles.checkLine}>
          <input
            type="checkbox"
            name="confirmToVisitor"
            checked={confirmToVisitor}
            onChange={(event) => setConfirmToVisitor(event.target.checked)}
          />
          Отправлять посетителю письмо «Заявка получена», если он оставил почту (текст постоянный,
          без того, что он ввёл; не чаще раза в сутки на адрес)
        </label>
        {notice?.kind === 'error' && (
          <p role="alert" className={styles.formError}>
            {notice.text}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={save.isPending}>
            Сохранить настройки
          </button>
        </div>
        {notice?.kind === 'done' && (
          <p role="status" className={styles.notice}>
            {notice.text}
          </p>
        )}
      </form>
    </section>
  )
}
