import { LeadEmailRecipients } from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type FormEvent, useCallback, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { parseRecipients, recipientsError } from '../leads/lead-format'
import { queryKeys, siteNotificationsQuery } from '../queries'
import { useReportUnsaved } from '../seo/unsaved'
import { Button } from '../ui/Button'
import { TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { FormActions, formClassName, mutedClassName, Section } from '../ui/Screen'
import { ChatLink } from './ChatLink'
import styles from './Notifications.module.scss'
import { RecipientList } from './RecipientList'

type Notice = { kind: 'done' | 'error'; text: string }

/**
 * Кому приходят уведомления о новых заявках сайта: адреса почты и чаты Telegram. Меняют владелец и
 * администратор сайта. Любая смена — письмо владельцам и прежним получателям: заявки нельзя
 * перенаправить молча. Никого нет — письма владельцам админки
 */
export function LeadRecipientsSection({
  siteId,
  channelsAbove = false,
}: {
  siteId: string
  /** Каналы настраиваются выше, в этом же экране (владелец): отправляем туда, а не к «владельцу» */
  channelsAbove?: boolean
}) {
  const { data } = useSuspenseQuery(siteNotificationsQuery(siteId))
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const emails = data.recipients.filter((recipient) => recipient.channel === 'email')
  const chats = data.recipients.filter((recipient) => recipient.channel === 'telegram')
  const telegram = data.channels.find((channel) => channel.kind === 'telegram')
  const [addresses, setAddresses] = useState(emails.map((row) => row.address).join(', '))
  const [notice, setNotice] = useState<Notice>()

  const list = parseRecipients(addresses)
  const parsed = LeadEmailRecipients.safeParse({ addresses: list })
  const form = useFormErrors(zodFieldErrors(parsed.error))
  // Адреса, которых нет на сервере: уход с ними спрашивает, «Сохранить адреса» без них выключена
  const unsaved = list.join(',') !== emails.map((row) => row.address).join(',')
  useReportUnsaved(unsaved)

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.siteNotifications(siteId) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.leads(siteId) })
  }, [queryClient, siteId])

  const saveEmails = useMutation({
    mutationFn: async (body: LeadEmailRecipients) => {
      const res = await api.sites[':siteId'].notifications.email.$put({
        param: { siteId },
        json: body,
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (result) => {
      setAddresses(
        result.recipients
          .filter((recipient) => recipient.channel === 'email')
          .map((recipient) => recipient.address)
          .join(', '),
      )
      await refresh()
      setNotice({
        kind: 'done',
        text:
          result.notified > 0
            ? 'Адреса сохранены. Владельцы и прежние получатели получили уведомление о смене'
            : 'Адреса сохранены',
      })
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.issues.length > 0) {
        form.showServerErrors(issueFieldErrors(error.issues))
      } else {
        setNotice({ kind: 'error', text: `Не удалось сохранить: ${messageOf(error)}` })
      }
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.sites[':siteId'].notifications.recipients[':id'].$delete({
        param: { siteId, id },
      })
      if (res.status !== 204) throw await apiRequestError(res)
    },
    onSuccess: async () => {
      await refresh()
      setNotice({ kind: 'done', text: 'Чат отвязан' })
    },
    onError: (error) =>
      setNotice({ kind: 'error', text: `Не удалось отвязать: ${messageOf(error)}` }),
  })

  const test = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId'].notifications.test.$post({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: ({ queued, fallback }) =>
      setNotice({
        kind: queued > 0 ? 'done' : 'error',
        text:
          queued === 0
            ? 'Некуда отправить: ни один канал сейчас не работает'
            : fallback
              ? `Получателей нет — тестовое письмо ушло владельцам админки (${queued}), как ушла бы заявка`
              : `Тестовое уведомление поставлено в очередь: получателей ${queued}`,
      }),
    onError: (error) => setNotice({ kind: 'error', text: messageOf(error) }),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!unsaved) return
    form.attempt()
    setNotice(undefined)
    if (!parsed.success) {
      focusField(formRef.current, 'addresses')
      return
    }
    saveEmails.mutate(parsed.data)
  }

  const summary = data.summary

  return (
    <Section
      title="Новые заявки"
      description="Кому приходят уведомления о заявках с форм сайта. Никого нет — письма владельцам админки. О смене получателей узнают владельцы и прежние получатели."
      card
    >
      <div className={styles.stack}>
        {summary.enabled ? (
          <p className={mutedClassName}>
            Сейчас уведомления уходят:{' '}
            {summary.targets.length > 0 ? summary.targets.join(', ') : 'владельцам админки письмом'}
          </p>
        ) : (
          <InlineAlert tone="warning" title="Уведомления о заявках не уходят">
            {summary.reason} Заявки сохраняются в разделе «Заявки».
          </InlineAlert>
        )}
        {summary.warning && (
          <InlineAlert tone="warning" title="Часть уведомлений застряла">
            {summary.warning}. Заявки сохраняются в разделе «Заявки».
          </InlineAlert>
        )}

        <form
          ref={formRef}
          aria-label="Адреса почты для заявок"
          className={formClassName}
          onSubmit={submit}
          noValidate
        >
          <TextInput
            label="Адреса почты"
            name="addresses"
            value={addresses}
            onChange={(event) => {
              setAddresses(event.target.value)
              form.clearServerError('addresses')
            }}
            error={recipientsError(form.errors, list)}
            hint="Через запятую, до 10 адресов. «Ответить» в письме напишет посетителю"
          />
          <FormActions>
            <Button
              type="submit"
              variant="primary"
              loading={saveEmails.isPending}
              aria-disabled={!unsaved ? true : undefined}
            >
              Сохранить адреса
            </Button>
          </FormActions>
        </form>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Чаты Telegram</legend>
          {chats.length > 0 ? (
            <RecipientList
              label="Чаты Telegram для заявок"
              recipients={chats}
              meta={() => 'Telegram, новые заявки'}
              removing={remove.isPending ? remove.variables : undefined}
              onRemove={(recipient) => {
                setNotice(undefined)
                remove.mutate(recipient.id)
              }}
            />
          ) : (
            <p className={mutedClassName}>Чатов пока нет.</p>
          )}
          {telegram?.ready ? (
            <ChatLink
              audience={siteId}
              onBound={() => void refresh()}
              create={async () => {
                const res = await api.sites[':siteId'].notifications.telegram.link.$post({
                  param: { siteId },
                })
                if (res.status !== 201) throw await apiRequestError(res)
                return res.json()
              }}
              state={async (id) => {
                const res = await api.sites[':siteId'].notifications.telegram.link[':id'].$get({
                  param: { siteId, id },
                })
                if (res.status !== 200) throw await apiRequestError(res)
                return res.json()
              }}
            />
          ) : (
            <p className={mutedClassName}>
              {telegram?.reason ?? 'Telegram не подключён'}.{' '}
              {channelsAbove
                ? 'Подключите бота выше, в блоке «Каналы».'
                : 'Бота подключает владелец админки в разделе «Уведомления».'}
            </p>
          )}
        </fieldset>

        <FormActions>
          {/* Ни один канал не работает — отправлять некуда: кнопка выключена, причина — рядом */}
          <Button
            icon="bell"
            loading={test.isPending}
            aria-disabled={!summary.enabled ? true : undefined}
            onClick={() => {
              if (summary.enabled) test.mutate()
            }}
          >
            Отправить тестовое уведомление
          </Button>
          {!summary.enabled && (
            <span className={mutedClassName}>Сначала подключите хотя бы один канал</span>
          )}
        </FormActions>

        {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}
        {notice?.kind === 'done' && (
          <InlineAlert tone="success" live>
            {notice.text}
          </InlineAlert>
        )}
      </div>
    </Section>
  )
}
