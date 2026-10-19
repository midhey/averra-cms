import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api'
import { apiRequestError, messageOf } from '../errors'
import {
  attemptsLabel,
  daysLabel,
  type MailData,
  mailStatusLabel,
  providerDetails,
} from '../mail/mail-format'
import { SmtpSettingsSection } from '../mail/SmtpSettingsSection'
import { formatDateTime } from '../pages-format'
import {
  type MailTemplateId,
  mailOutboxQuery,
  mailPreviewQuery,
  mailQuery,
  queryKeys,
} from '../queries'
import { Button, Spinner } from '../ui/Button'
import { cardClassName } from '../ui/Card'
import { type Column, DataTable } from '../ui/DataTable'
import { EmptyState } from '../ui/EmptyState'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { Facts, mutedClassName, Screen, Section } from '../ui/Screen'
import { StatusPill, type StatusTone } from '../ui/StatusPill'
import { usePageTitle } from '../ui/use-page-title'
import styles from './MailScreen.module.scss'

type Notice = { kind: 'done' | 'error'; text: string }

/**
 * Почта админки — только владельцу: включена ли и через что, настройки SMTP (их можно задать
 * здесь, если сервер их не задал сам), очередь писем с повтором и предпросмотр каждого шаблона
 */
export function MailScreen() {
  const { data: mail } = useSuspenseQuery(mailQuery())
  usePageTitle('Почта')
  const titles = new Map(mail.templates.map((template) => [template.id as string, template.title]))

  return (
    <Screen narrow>
      <PageHeader
        eyebrow="Установка"
        title="Почта"
        meta={
          <StatusPill tone={mail.status.enabled ? 'success' : 'danger'} appearance="dot">
            {mail.status.enabled ? 'работает' : 'выключена'}
          </StatusPill>
        }
      />
      <MailState mail={mail} />
      <SmtpSettingsSection />
      <Outbox titles={titles} />
      <Templates templates={mail.templates} />
    </Screen>
  )
}

function MailState({ mail }: { mail: MailData }) {
  const { status, settings } = mail
  return (
    <Section title="Состояние" card>
      {status.enabled ? (
        <>
          <p className={styles.state}>Почта включена</p>
          <Facts items={providerDetails(status.provider)} />
        </>
      ) : (
        <InlineAlert tone="danger" title="Почта выключена">
          {status.reason}
        </InlineAlert>
      )}
      {/* Письма по SMTP со ссылками на localhost: адресат их не откроет (забытый ADMIN_URL) */}
      {mail.linkWarning && <InlineAlert tone="warning">{mail.linkWarning}</InlineAlert>}
      <p className={mutedClassName}>
        Письмо пробует уйти {attemptsLabel(settings.maxAttempts)} с растущей паузой. Отправленные и
        неотправленные письма удаляются через {daysLabel(settings.retentionDays)}: в них
        персональные данные.
      </p>
    </Section>
  )
}

const outboxTones: Record<string, StatusTone> = {
  pending: 'info',
  sending: 'info',
  sent: 'success',
  failed: 'danger',
}

type OutboxMail = {
  id: string
  recipient: string
  template: string
  status: string
  attempts: number
  nextAttemptAt: string
  lastError: string | null
  sentAt: string | null
  createdAt: string
  canRetry: boolean
}

function Outbox({ titles }: { titles: Map<string, string> }) {
  const queryClient = useQueryClient()
  const outbox = useQuery(mailOutboxQuery())
  const [notice, setNotice] = useState<Notice>()

  const retry = useMutation({
    mutationFn: async ({ id }: { id: string; recipient: string }) => {
      const res = await api.mail.outbox[':id'].retry.$post({ param: { id } })
      if (res.status !== 200) throw await apiRequestError(res)
    },
    onSuccess: async (_, { recipient }) => {
      setNotice({ kind: 'done', text: `Письмо для ${recipient} снова в очереди` })
      await queryClient.invalidateQueries({ queryKey: queryKeys.mailOutbox })
    },
    onError: (error, { recipient }) =>
      setNotice({
        kind: 'error',
        text: `Не удалось вернуть письмо для ${recipient}: ${messageOf(error)}`,
      }),
  })

  const columns: Column<OutboxMail>[] = [
    { key: 'recipient', header: 'Кому', wrap: 'nowrap', cell: (mail) => mail.recipient },
    {
      key: 'template',
      header: 'Письмо',
      cell: (mail) => titles.get(mail.template) ?? mail.template,
    },
    {
      key: 'status',
      header: 'Состояние',
      cell: (mail) => (
        <span className={styles.status}>
          <StatusPill tone={outboxTones[mail.status] ?? 'neutral'}>
            {mailStatusLabel(mail.status)}
          </StatusPill>
          <span className={mutedClassName}>{attemptsLabel(mail.attempts)}</span>
        </span>
      ),
    },
    {
      key: 'when',
      header: 'Когда',
      muted: true,
      wrap: 'nowrap',
      cell: (mail) =>
        mail.sentAt ? (
          <>
            отправлено <time dateTime={mail.sentAt}>{formatDateTime(mail.sentAt)}</time>
          </>
        ) : mail.status === 'pending' ? (
          <>
            следующая попытка{' '}
            <time dateTime={mail.nextAttemptAt}>{formatDateTime(mail.nextAttemptAt)}</time>
          </>
        ) : (
          <>
            создано <time dateTime={mail.createdAt}>{formatDateTime(mail.createdAt)}</time>
          </>
        ),
    },
    {
      key: 'error',
      header: 'Последняя ошибка',
      cell: (mail) => <span className={styles.error}>{mail.lastError ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">Действия</span>,
      align: 'end',
      wrap: 'nowrap',
      // Можно ли повторить, решает API: у письма с одноразовой ссылкой после неудачи данных
      // нет, и повторять нечего
      cell: (mail) =>
        mail.canRetry && (
          <Button
            size="small"
            aria-label={`Повторить письмо для ${mail.recipient}`}
            disabled={retry.isPending}
            onClick={() => {
              setNotice(undefined)
              retry.mutate({ id: mail.id, recipient: mail.recipient })
            }}
          >
            Повторить
          </Button>
        ),
    },
  ]

  return (
    <Section
      title="Очередь писем"
      actions={
        <Button
          size="small"
          icon="history"
          loading={outbox.isFetching}
          onClick={() => {
            setNotice(undefined)
            void outbox.refetch()
          }}
        >
          Обновить
        </Button>
      }
    >
      {outbox.isPending ? (
        <p className={styles.loading} role="status">
          <Spinner />
          Загружаю очередь…
        </p>
      ) : outbox.isError ? (
        <InlineAlert tone="danger">Очередь не загрузилась: {messageOf(outbox.error)}</InlineAlert>
      ) : (
        <DataTable
          caption="Очередь писем"
          columns={columns}
          rows={outbox.data}
          rowKey={(mail) => mail.id}
          minWidth="56rem"
          empty={
            <EmptyState title="Писем в очереди нет" icon="mail" headingLevel={3}>
              Здесь появятся письма сброса пароля, приглашения и уведомления о заявках.
            </EmptyState>
          }
        />
      )}
      {notice?.kind === 'done' && (
        <InlineAlert tone="success" live>
          {notice.text}
        </InlineAlert>
      )}
      {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}
    </Section>
  )
}

type TemplateInfo = { id: MailTemplateId; title: string; description: string }

function Templates({ templates }: { templates: readonly TemplateInfo[] }) {
  return (
    <Section
      title="Шаблоны писем"
      description="Как выглядят письма — на примерных данных. Настоящие письма собираются из тех же шаблонов."
    >
      <div className={styles.templates}>
        {templates.map((template) => (
          <TemplatePreview key={template.id} template={template} />
        ))}
      </div>
    </Section>
  )
}

function TemplatePreview({ template }: { template: TemplateInfo }) {
  const preview = useQuery(mailPreviewQuery(template.id))
  const headingId = `template-${template.id}`
  return (
    <article aria-labelledby={headingId} className={cardClassName()}>
      <div className={styles.templateHead}>
        <h3 id={headingId} className={styles.templateTitle}>
          {template.title}
        </h3>
        <p className={mutedClassName}>{template.description}</p>
      </div>
      {preview.isPending ? (
        <p className={styles.loading} role="status">
          <Spinner />
          Собираю письмо…
        </p>
      ) : preview.isError ? (
        <InlineAlert tone="danger">
          Предпросмотр не собрался: {messageOf(preview.error)}
        </InlineAlert>
      ) : (
        <>
          <p>
            <span className={mutedClassName}>Тема:</span> {preview.data.subject}
          </p>
          {/* sandbox без разрешений: в письме нет скриптов, а iframe не получает доступ к админке */}
          <iframe
            className={styles.frame}
            title={`Предпросмотр письма «${template.title}»`}
            sandbox=""
            srcDoc={preview.data.html}
          />
          <details className={styles.details}>
            <summary>Текстовая версия</summary>
            <pre className={styles.text}>{preview.data.text}</pre>
          </details>
        </>
      )}
    </article>
  )
}
