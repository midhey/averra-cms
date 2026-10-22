import { MailAddress, type ServiceEventId } from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type FormEvent, useCallback, useId, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { focusField } from '../forms/use-form-errors'
import { notificationsQuery, queryKeys } from '../queries'
import { Button } from '../ui/Button'
import { Checkbox, TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { FormActions, mutedClassName, Section } from '../ui/Screen'
import { ChatLink } from './ChatLink'
import styles from './Notifications.module.scss'
import { eventsLine, type RecipientView, recipientName } from './notifications-format'
import { RecipientList } from './RecipientList'

type Notice = { kind: 'done' | 'error'; text: string }
type ServiceEvent = { id: ServiceEventId; title: string; hint: string }

/**
 * Служебные события установки для студии — только владельцу: бэкап, диск, сборка, почта.
 * У каждого получателя (адрес почты или чат Telegram) — свои события. Уведомление приходит
 * на переходе: проблема появилась и проблема ушла, а не каждые пять минут
 */
export function ServiceRecipientsSection() {
  const { recipients, events, channels } = useSuspenseQuery(notificationsQuery()).data
  const queryClient = useQueryClient()
  const telegram = channels.find((channel) => channel.kind === 'telegram')
  const titleOf = (kind: string) => channels.find((channel) => channel.kind === kind)?.title ?? kind
  const skipsOf = (kind: string): readonly string[] =>
    channels.find((channel) => channel.kind === kind)?.skips ?? []
  // Новый адрес почты получает всё, что почта возит: «Почта не работает» по почте не дойдёт
  const emailEvents = events.filter((event) => !skipsOf('email').includes(event.id))
  const emails = recipients.filter((recipient) => recipient.channel === 'email')
  const chats = recipients.filter((recipient) => recipient.channel === 'telegram')
  const [notice, setNotice] = useState<Notice>()
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
    [queryClient],
  )

  const saveEmails = useMutation({
    mutationFn: async (list: { address: string; events: ServiceEventId[] }[]) => {
      const res = await api.notifications.service.email.$put({ json: { recipients: list } })
      if (res.status !== 200) throw await apiRequestError(res)
    },
    onSuccess: async () => {
      await refresh()
      setNotice({ kind: 'done', text: 'Адреса служебных уведомлений сохранены' })
    },
    onError: (error) => setNotice({ kind: 'error', text: messageOf(error) }),
  })

  const setEvents = useMutation({
    mutationFn: async ({ id, events }: { id: string; events: ServiceEventId[] }) => {
      const res = await api.notifications.service.recipients[':id'].$patch({
        param: { id },
        json: { events },
      })
      if (res.status !== 200) throw await apiRequestError(res)
    },
    onSuccess: async () => {
      await refresh()
      setNotice({ kind: 'done', text: 'События чата сохранены' })
    },
    onError: (error) => setNotice({ kind: 'error', text: messageOf(error) }),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.notifications.service.recipients[':id'].$delete({ param: { id } })
      if (res.status !== 204) throw await apiRequestError(res)
    },
    onSuccess: async () => {
      await refresh()
      setNotice({ kind: 'done', text: 'Получатель удалён' })
    },
    onError: (error) => setNotice({ kind: 'error', text: messageOf(error) }),
  })

  const test = useMutation({
    mutationFn: async () => {
      const res = await api.notifications.service.test.$post()
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: ({ queued }) =>
      setNotice({
        kind: queued > 0 ? 'done' : 'error',
        text:
          queued > 0
            ? `Тестовое уведомление поставлено в очередь: получателей ${queued}`
            : 'Некуда отправить: получателей нет или каналы не работают',
      }),
    onError: (error) => setNotice({ kind: 'error', text: messageOf(error) }),
  })

  const emailList = (except?: string) =>
    emails
      .filter((row) => row.id !== except)
      .map((row) => ({ address: row.address, events: row.events as ServiceEventId[] }))

  return (
    <Section
      title="Служебные события"
      description="Для студии, которая ведёт установку: о проблеме — один раз, когда она появилась, и ещё раз, когда ушла."
      card
    >
      <div className={styles.stack}>
        {recipients.length > 0 ? (
          <RecipientList
            label="Получатели служебных уведомлений"
            recipients={recipients}
            meta={(recipient) => `${titleOf(recipient.channel)}: ${eventsLine(recipient.events)}`}
            removeLabel={(recipient) => (recipient.channel === 'email' ? 'Удалить' : 'Отвязать')}
            removing={remove.isPending ? remove.variables : undefined}
            busy={saveEmails.isPending || setEvents.isPending}
            onRemove={(recipient) => {
              setNotice(undefined)
              if (recipient.channel === 'email') saveEmails.mutate(emailList(recipient.id))
              else remove.mutate(recipient.id)
            }}
            extra={(recipient) => (
              <RecipientEvents
                recipient={recipient}
                events={events}
                skips={skipsOf(recipient.channel)}
                disabled={setEvents.isPending || saveEmails.isPending}
                onChange={(next) => {
                  setNotice(undefined)
                  if (recipient.channel === 'email') {
                    saveEmails.mutate(
                      emails.map((row) => ({
                        address: row.address,
                        events: (row.id === recipient.id ? next : row.events) as ServiceEventId[],
                      })),
                    )
                  } else {
                    setEvents.mutate({ id: recipient.id, events: next })
                  }
                }}
              />
            )}
          />
        ) : (
          <p className={mutedClassName}>
            Получателей пока нет: служебные уведомления никуда не уходят.
          </p>
        )}

        <AddEmail
          events={emailEvents}
          disabled={saveEmails.isPending || emails.length >= 10}
          existing={emails.map((row) => row.address)}
          onAdd={(address) =>
            saveEmails.mutateAsync([
              ...emailList(),
              { address, events: emailEvents.map((event) => event.id) },
            ])
          }
        />

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Чат Telegram</legend>
          {telegram?.ready ? (
            <ChatLink
              audience={null}
              onBound={() => void refresh()}
              create={async () => {
                const res = await api.notifications.service.telegram.link.$post()
                if (res.status !== 201) throw await apiRequestError(res)
                return res.json()
              }}
              state={async (id) => {
                const res = await api.notifications.service.telegram.link[':id'].$get({
                  param: { id },
                })
                if (res.status !== 200) throw await apiRequestError(res)
                return res.json()
              }}
            />
          ) : (
            <p className={mutedClassName}>
              {telegram?.reason ?? 'Telegram не подключён'}: подключите бота в «Каналах» выше.
              «Почта не работает» приходит только в Telegram.
            </p>
          )}
          {chats.length === 0 && telegram?.ready && (
            <p className={mutedClassName}>
              Чат получит все служебные события; лишние снимите флажками после привязки.
            </p>
          )}
        </fieldset>

        <FormActions>
          <Button icon="bell" loading={test.isPending} onClick={() => test.mutate()}>
            Отправить тестовое уведомление
          </Button>
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

/** События получателя флажками; последний не снимается — получатель без событий не нужен */
function RecipientEvents({
  recipient,
  events,
  skips,
  disabled,
  onChange,
}: {
  recipient: RecipientView
  events: ServiceEvent[]
  /** События, которые канал получателя не возит (почта — «Почта не работает») */
  skips: readonly string[]
  disabled: boolean
  onChange: (events: ServiceEventId[]) => void
}) {
  const legendId = useId()
  const selected = new Set(recipient.events)
  return (
    <fieldset className={styles.events} aria-labelledby={legendId}>
      <legend id={legendId} className="visually-hidden">
        События для {recipientName(recipient)}
      </legend>
      {events.map((event) => {
        const checked = selected.has(event.id)
        const mailOnly = skips.includes(event.id)
        return (
          <Checkbox
            key={event.id}
            name={`${recipient.id}-${event.id}`}
            checked={checked}
            disabled={disabled || (checked && selected.size === 1) || (mailOnly && !checked)}
            onChange={(change) => {
              const next = events
                .map((item) => item.id)
                .filter((id) => (id === event.id ? change.target.checked : selected.has(id)))
              onChange(next)
            }}
            label={event.title}
            hint={
              mailOnly ? 'Этим каналом не придёт: когда почта сломана, письмо не дойдёт' : undefined
            }
          />
        )
      })}
    </fieldset>
  )
}

/** Новый адрес почты: получит все служебные события, которые почта возит, лишние — флажками */
function AddEmail({
  events,
  existing,
  disabled,
  onAdd,
}: {
  events: ServiceEvent[]
  existing: string[]
  disabled: boolean
  onAdd: (address: string) => Promise<unknown>
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = MailAddress.safeParse(address)
    const message = !parsed.success
      ? (parsed.error.issues[0]?.message ?? 'Нужен адрес почты')
      : existing.includes(parsed.data.toLowerCase())
        ? 'Этот адрес уже получает служебные уведомления'
        : undefined
    setError(message)
    if (message || !parsed.success) {
      focusField(formRef.current, 'serviceEmail')
      return
    }
    try {
      await onAdd(parsed.data.toLowerCase())
      setAddress('')
    } catch (failure) {
      if (failure instanceof ApiRequestError) setError(failure.message)
    }
  }

  return (
    <form
      ref={formRef}
      aria-label="Добавить адрес почты"
      className={styles.group}
      onSubmit={submit}
      noValidate
    >
      <TextInput
        label="Добавить адрес почты"
        name="serviceEmail"
        type="email"
        value={address}
        onChange={(change) => {
          setAddress(change.target.value)
          setError(undefined)
        }}
        error={error}
        hint={`Получит все события: ${events.map((item) => item.title.toLowerCase()).join(', ')}`}
      />
      <FormActions>
        <Button type="submit" icon="plus" disabled={disabled}>
          Добавить адрес
        </Button>
      </FormActions>
    </form>
  )
}
