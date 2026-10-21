import { NewInvitation } from '@averra/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { formatDateTime } from '../pages-format'
import { invitationsQuery, mailQuery, queryKeys } from '../queries'
import { Button } from '../ui/Button'
import { cardClassName } from '../ui/Card'
import { type Column, DataTable } from '../ui/DataTable'
import { EmptyState } from '../ui/EmptyState'
import { TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { formClassName, mutedClassName, Section } from '../ui/Screen'
import { SegmentedControl } from '../ui/SegmentedControl'
import { StatusPill, type StatusTone } from '../ui/StatusPill'
import styles from './InvitationsSection.module.scss'
import {
  canRevoke,
  type InvitationRole,
  type InvitationStatus,
  roleHints,
  roleLabels,
  statusLabels,
} from './invitation-format'

type Notice = { kind: 'done' | 'error'; text: string }

type Invitation = {
  id: string
  email: string
  role: InvitationRole
  status: InvitationStatus
  invitedBy: string | null
  expiresAt: string
}

const statusTones: Record<InvitationStatus, StatusTone> = {
  pending: 'info',
  accepted: 'success',
  revoked: 'neutral',
  expired: 'neutral',
}

/**
 * Участники — пользователи установки, у владельца: пригласить по почте и список приглашений
 * с отзывом. Сайт у установки один, поэтому участник установки — это участник её сайта.
 * Письмо уходит через очередь; без почты API ответит 503, а раздел скажет это заранее
 */
export function InvitationsSection({ siteId, id }: { siteId: string; id?: string }) {
  const queryClient = useQueryClient()
  const listHeadingId = useId()
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  // Оба загружает маршрут сайта (router.tsx), когда роль — владелец. Не suspense: их сбой
  // показывается здесь, а не экраном ошибки вместо всего сайта. Сам после показа не
  // перезапрашивает (retryOnMount: false) — только по кнопке «Повторить»
  const invitations = useQuery({ ...invitationsQuery(siteId), retryOnMount: false })
  const mail = useQuery({ ...mailQuery(), retryOnMount: false })
  const mailOff = mail.data && !mail.data.status.enabled ? mail.data.status.reason : undefined
  const [notice, setNotice] = useState<Notice>()

  const revoke = useMutation({
    mutationFn: async ({ id }: { id: string; email: string }) => {
      const res = await api.sites[':siteId'].invitations[':invitationId'].$delete({
        param: { siteId, invitationId: id },
      })
      if (res.status !== 204) throw await apiRequestError(res)
    },
    onSuccess: async (_, { email }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations(siteId) })
      setNotice({
        kind: 'done',
        text: `Приглашение для ${email} отозвано: ссылка больше не работает`,
      })
      // Кнопка «Отозвать» пропала: фокус на заголовок списка, а не в никуда
      listHeadingRef.current?.focus()
    },
    onError: (error, { email }) =>
      setNotice({
        kind: 'error',
        text: `Не удалось отозвать приглашение для ${email}: ${messageOf(error)}`,
      }),
  })

  const columns: Column<Invitation>[] = [
    { key: 'email', header: 'Почта', wrap: 'nowrap', cell: (invitation) => invitation.email },
    {
      key: 'role',
      header: 'Роль',
      wrap: 'nowrap',
      cell: (invitation) => roleLabels[invitation.role],
    },
    {
      key: 'status',
      header: 'Состояние',
      wrap: 'nowrap',
      cell: (invitation) => (
        <StatusPill tone={statusTones[invitation.status]}>
          {statusLabels[invitation.status]}
        </StatusPill>
      ),
    },
    {
      key: 'invitedBy',
      header: 'Пригласил',
      muted: true,
      wrap: 'nowrap',
      cell: (invitation) => invitation.invitedBy ?? '—',
    },
    {
      key: 'expiresAt',
      header: 'Действует до',
      muted: true,
      wrap: 'nowrap',
      cell: (invitation) => (
        <time dateTime={invitation.expiresAt}>{formatDateTime(invitation.expiresAt)}</time>
      ),
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">Действия</span>,
      align: 'end',
      wrap: 'nowrap',
      cell: (invitation) =>
        canRevoke(invitation.status) && (
          <Button
            variant="danger"
            size="small"
            aria-label={`Отозвать приглашение для ${invitation.email}`}
            disabled={revoke.isPending}
            onClick={() => {
              // Ссылку из письма потом не вернуть — только прислать новое приглашение
              const question = `Отозвать приглашение для ${invitation.email}? Ссылка из письма перестанет работать.`
              if (!window.confirm(question)) return
              setNotice(undefined)
              revoke.mutate({ id: invitation.id, email: invitation.email })
            }}
          >
            Отозвать
          </Button>
        ),
    },
  ]

  return (
    <Section
      id={id}
      title="Участники"
      description="Пользователи этой установки. Редактор и клиент работают с сайтом по приглашению: человек получит письмо и сам задаст пароль."
    >
      {mailOff && <InlineAlert tone="danger">Приглашения не уйдут: {mailOff}</InlineAlert>}
      {mail.error && (
        <InlineAlert tone="warning">
          Не удалось узнать, настроена ли почта: {messageOf(mail.error)}. Пригласить всё равно
          можно: если почта выключена, админка скажет об этом при отправке.
        </InlineAlert>
      )}
      <div className={cardClassName()}>
        <InviteForm
          siteId={siteId}
          disabled={mailOff !== undefined}
          onInvited={(email) =>
            setNotice({ kind: 'done', text: `Приглашение отправлено на ${email}` })
          }
        />
      </div>

      <h3 id={listHeadingId} ref={listHeadingRef} tabIndex={-1} className={styles.subtitle}>
        Приглашения
      </h3>
      {invitations.error && (
        <InlineAlert
          tone="danger"
          action={
            <Button
              size="small"
              loading={invitations.isFetching}
              onClick={() => {
                void invitations.refetch()
                if (mail.error) void mail.refetch()
              }}
            >
              Повторить
            </Button>
          }
        >
          Не удалось загрузить приглашения: {messageOf(invitations.error)}
        </InlineAlert>
      )}
      {invitations.isPending && <p className={mutedClassName}>Загружаем приглашения…</p>}
      {invitations.data && (
        <DataTable
          caption="Приглашения"
          columns={columns}
          rows={invitations.data}
          rowKey={(invitation) => invitation.id}
          minWidth="48rem"
          empty={
            <EmptyState title="Приглашений пока нет" icon="user" headingLevel={3}>
              Пригласите клиента или редактора формой выше.
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

const roles: readonly InvitationRole[] = ['client', 'editor']
const fieldOrder = ['email', 'role']

function InviteForm({
  siteId,
  disabled,
  onInvited,
}: {
  siteId: string
  disabled: boolean
  onInvited: (email: string) => void
}) {
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const headingId = useId()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitationRole>('client')
  const [formError, setFormError] = useState<string>()

  const parsed = NewInvitation.safeParse({ email, role })
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const invite = useMutation({
    mutationFn: async (body: NewInvitation) => {
      const res = await api.sites[':siteId'].invitations.$post({ param: { siteId }, json: body })
      if (res.status !== 201) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (invitation) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations(siteId) })
      setEmail('')
      form.reset()
      onInvited(invitation.email)
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.issues.length > 0) {
        const errors = issueFieldErrors(error.issues)
        form.showServerErrors(errors)
        focusField(formRef.current, firstInvalidField(fieldOrder, errors))
      } else {
        setFormError(messageOf(error))
      }
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    form.attempt()
    setFormError(undefined)
    if (!parsed.success) {
      focusField(formRef.current, firstInvalidField(fieldOrder, zodFieldErrors(parsed.error)))
      return
    }
    invite.mutate(parsed.data)
  }

  return (
    <div className={styles.invite}>
      <div className={styles.inviteHead}>
        <h3 id={headingId} className={styles.subtitle}>
          Пригласить участника
        </h3>
        <p className={mutedClassName}>
          Придёт письмо со ссылкой: по ней человек сам задаст пароль. Ссылка действует 7 дней.
        </p>
      </div>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={formClassName}
        onSubmit={submit}
        noValidate
      >
        <TextInput
          label="Почта"
          name="email"
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            form.clearServerError('email')
          }}
          error={form.errors.email}
        />
        <div className={styles.role}>
          <SegmentedControl
            legend="Роль"
            name="role"
            options={roles.map((option) => ({ value: option, label: roleLabels[option] }))}
            value={role}
            onChange={setRole}
          />
          <p className={mutedClassName}>
            {roleLabels[role]} {roleHints[role]}.
          </p>
        </div>
        {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        <div>
          <Button type="submit" variant="primary" disabled={disabled} loading={invite.isPending}>
            Пригласить
          </Button>
        </div>
      </form>
    </div>
  )
}
