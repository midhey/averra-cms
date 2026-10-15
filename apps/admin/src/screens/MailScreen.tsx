import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
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
import { Breadcrumbs } from '../ui/Breadcrumbs'
import { usePageTitle } from '../ui/use-page-title'
import mailStyles from './MailScreen.module.css'
import styles from './screens.module.css'

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
    <main className={styles.screen}>
      <header className={styles.header}>
        <Breadcrumbs current="Почта" />
        <h1>Почта</h1>
      </header>
      <MailState mail={mail} />
      <SmtpSettingsSection />
      <Outbox titles={titles} />
      <Templates templates={mail.templates} />
    </main>
  )
}

function MailState({ mail }: { mail: MailData }) {
  const headingId = useId()
  const { status, settings } = mail
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId}>Состояние</h2>
      {status.enabled ? (
        <>
          <p className={mailStyles.on}>Почта включена</p>
          <dl className={mailStyles.details}>
            {providerDetails(status.provider).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <>
          <p className={mailStyles.off}>Почта выключена</p>
          <p>{status.reason}</p>
        </>
      )}
      {/* Письма по SMTP со ссылками на localhost: адресат их не откроет (забытый ADMIN_URL) */}
      {mail.linkWarning && <p className={mailStyles.warning}>{mail.linkWarning}</p>}
      <p className={styles.muted}>
        Письмо пробует уйти {attemptsLabel(settings.maxAttempts)} с растущей паузой. Отправленные и
        неотправленные письма удаляются через {daysLabel(settings.retentionDays)}: в них
        персональные данные.
      </p>
    </section>
  )
}

function Outbox({ titles }: { titles: Map<string, string> }) {
  const headingId = useId()
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

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <div className={mailStyles.sectionHeader}>
        <h2 id={headingId}>Очередь писем</h2>
        <button
          type="button"
          onClick={() => {
            setNotice(undefined)
            void outbox.refetch()
          }}
          disabled={outbox.isFetching}
        >
          Обновить
        </button>
      </div>
      {outbox.isPending ? (
        <p className={styles.muted} role="status">
          Загружаю очередь…
        </p>
      ) : outbox.isError ? (
        <p role="alert" className={styles.formError}>
          Очередь не загрузилась: {messageOf(outbox.error)}
        </p>
      ) : outbox.data.length === 0 ? (
        <p className={styles.empty}>Писем в очереди нет.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table} aria-labelledby={headingId}>
            <thead>
              <tr>
                <th scope="col">Кому</th>
                <th scope="col">Письмо</th>
                <th scope="col">Состояние</th>
                <th scope="col">Когда</th>
                <th scope="col">Последняя ошибка</th>
                <th scope="col">
                  <span className={styles.visuallyHidden}>Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {outbox.data.map((mail) => (
                <tr key={mail.id}>
                  <td className={mailStyles.nowrap}>{mail.recipient}</td>
                  <td>{titles.get(mail.template) ?? mail.template}</td>
                  <td className={mailStyles.nowrap}>
                    <span className={mailStyles.status} data-status={mail.status}>
                      {mailStatusLabel(mail.status)}
                    </span>
                    <br />
                    <span className={styles.muted}>{attemptsLabel(mail.attempts)}</span>
                  </td>
                  <td>
                    {mail.sentAt ? (
                      <>
                        отправлено <time dateTime={mail.sentAt}>{formatDateTime(mail.sentAt)}</time>
                      </>
                    ) : mail.status === 'pending' ? (
                      <>
                        следующая попытка{' '}
                        <time dateTime={mail.nextAttemptAt}>
                          {formatDateTime(mail.nextAttemptAt)}
                        </time>
                      </>
                    ) : (
                      <>
                        создано{' '}
                        <time dateTime={mail.createdAt}>{formatDateTime(mail.createdAt)}</time>
                      </>
                    )}
                  </td>
                  <td className={mailStyles.error}>{mail.lastError ?? '—'}</td>
                  <td className={styles.rowActions}>
                    {/* Можно ли повторить, решает API: у письма с одноразовой ссылкой после
                        неудачи данных нет, и повторять нечего */}
                    {mail.canRetry && (
                      <button
                        type="button"
                        aria-label={`Повторить письмо для ${mail.recipient}`}
                        disabled={retry.isPending}
                        onClick={() => {
                          setNotice(undefined)
                          retry.mutate({ id: mail.id, recipient: mail.recipient })
                        }}
                      >
                        Повторить
                      </button>
                    )}
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
  )
}

type TemplateInfo = { id: MailTemplateId; title: string; description: string }

function Templates({ templates }: { templates: readonly TemplateInfo[] }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId}>Шаблоны писем</h2>
      <p className={styles.muted}>
        Как выглядят письма — на примерных данных. Настоящие письма собираются из тех же шаблонов.
      </p>
      <div className={mailStyles.templates}>
        {templates.map((template) => (
          <TemplatePreview key={template.id} template={template} />
        ))}
      </div>
    </section>
  )
}

function TemplatePreview({ template }: { template: TemplateInfo }) {
  const headingId = useId()
  const preview = useQuery(mailPreviewQuery(template.id))
  return (
    <article aria-labelledby={headingId} className={mailStyles.template}>
      <h3 id={headingId}>{template.title}</h3>
      <p className={styles.muted}>{template.description}</p>
      {preview.isPending ? (
        <p className={styles.muted} role="status">
          Собираю письмо…
        </p>
      ) : preview.isError ? (
        <p role="alert" className={styles.formError}>
          Предпросмотр не собрался: {messageOf(preview.error)}
        </p>
      ) : (
        <>
          <p>
            <span className={styles.muted}>Тема:</span> {preview.data.subject}
          </p>
          {/* sandbox без разрешений: в письме нет скриптов, а iframe не получает доступ к админке */}
          <iframe
            className={mailStyles.frame}
            title={`Предпросмотр письма «${template.title}»`}
            sandbox=""
            srcDoc={preview.data.html}
          />
          <details>
            <summary>Текстовая версия</summary>
            <pre className={mailStyles.text}>{preview.data.text}</pre>
          </details>
        </>
      )}
    </article>
  )
}
