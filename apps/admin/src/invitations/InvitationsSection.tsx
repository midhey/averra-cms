import { NewInvitation } from '@averra/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { formatDateTime } from '../pages-format'
import { assignableRoles, canManageMember, type SiteAccess } from '../permissions'
import { invitationsQuery, mailQuery, queryKeys } from '../queries'
import { Button } from '../ui/Button'
import { cardClassName } from '../ui/Card'
import { useConfirm } from '../ui/Confirm'
import { type Column, DataTable } from '../ui/DataTable'
import { EmptyState } from '../ui/EmptyState'
import { TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { formClassName, mutedClassName, Section } from '../ui/Screen'
import { SegmentedControl } from '../ui/SegmentedControl'
import { StatusPill, type StatusTone } from '../ui/StatusPill'
import styles from './InvitationsSection.module.scss'
import {
  canResend,
  canRevoke,
  type InvitationRole,
  type InvitationStatus,
  pendingInvitationFor,
  replaceWarning,
  roleHints,
  roleLabels,
  statusLabels,
} from './invitation-format'
import { MembersTable } from './MembersTable'

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
 * Участники — пользователи установки, у владельца и администратора сайта: кто работает с сайтом
 * (роль, отключение, передача владения), пригласить по почте и список приглашений с повтором и
 * отзывом. Сайт у установки один, поэтому участник установки — это участник её сайта. Письмо
 * уходит через очередь; без почты API ответит 503, а раздел скажет это заранее
 */
export function InvitationsSection({
  siteId,
  access,
  id,
}: {
  siteId: string
  access: SiteAccess
  id?: string
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const listHeadingId = useId()
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  // Оба загружает маршрут сайта (router.tsx), почту — только владельцу. Не suspense: их сбой
  // показывается здесь, а не экраном ошибки вместо всего сайта. Сам после показа не
  // перезапрашивает (retryOnMount: false) — только по кнопке «Повторить»
  const invitations = useQuery({ ...invitationsQuery(siteId), retryOnMount: false })
  // Почта — раздел владельца (API отдаёт её только ему): администратору сайта о выключенной почте
  // скажет сам ответ на приглашение (503)
  const mail = useQuery({ ...mailQuery(), retryOnMount: false, enabled: access === 'owner' })
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

  const resend = useMutation({
    mutationFn: async ({ id }: { id: string; email: string }) => {
      const res = await api.sites[':siteId'].invitations[':invitationId'].resend.$post({
        param: { siteId, invitationId: id },
      })
      if (res.status !== 201) throw await apiRequestError(res)
    },
    onSuccess: async (_, { email }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations(siteId) })
      setNotice({
        kind: 'done',
        text: `Приглашение отправлено на ${email} ещё раз: ссылка из прежнего письма больше не работает`,
      })
      listHeadingRef.current?.focus()
    },
    onError: (error, { email }) =>
      setNotice({
        kind: 'error',
        text: `Не удалось отправить приглашение на ${email}: ${messageOf(error)}`,
      }),
  })

  const columns: Column<Invitation>[] = [
    {
      key: 'email',
      header: 'Почта',
      // Длинный адрес переносится, иначе состояние уезжало бы под прижатую колонку действий
      wrap: 'anywhere',
      minWidth: '14rem',
      // Кто пригласил — второй строкой под адресом: отдельная колонка вместе с «Повторить» и
      // «Отозвать» не помещалась, и таблица на 1440 листалась вбок
      cell: (invitation) => (
        <span className={styles.memberName}>
          <span>{invitation.email}</span>
          <span className={styles.inviter}>пригласил: {invitation.invitedBy ?? '—'}</span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Роль',
      // «Администратор сайта» переносится между словами, но не посреди слова
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
      key: 'expiresAt',
      header: 'Действует до',
      muted: true,
      cell: (invitation) => (
        <time dateTime={invitation.expiresAt}>
          {wrapAtTime(formatDateTime(invitation.expiresAt))}
        </time>
      ),
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">Действия</span>,
      align: 'end',
      wrap: 'nowrap',
      pinned: true,
      cell: (invitation) =>
        canManageMember(access, invitation.role) && (
          <span className={styles.stack}>
            {canResend(invitation.status) && (
              <Button
                size="small"
                aria-label={`Отправить ещё раз: ${invitation.email}`}
                disabled={resend.isPending || mailOff !== undefined}
                onClick={() => {
                  setNotice(undefined)
                  resend.mutate({ id: invitation.id, email: invitation.email })
                }}
              >
                Повторить
              </Button>
            )}
            {canRevoke(invitation.status) && (
              <Button
                variant="danger"
                size="small"
                aria-label={`Отозвать приглашение для ${invitation.email}`}
                disabled={revoke.isPending}
                onClick={async () => {
                  // Ссылку из письма потом не вернуть — только прислать новое приглашение
                  const yes = await confirm({
                    title: `Отозвать приглашение для ${invitation.email}?`,
                    description: 'Ссылка из письма перестанет работать.',
                    confirmLabel: 'Отозвать',
                    cancelLabel: 'Оставить',
                  })
                  if (!yes) return
                  setNotice(undefined)
                  revoke.mutate({ id: invitation.id, email: invitation.email })
                }}
              >
                Отозвать
              </Button>
            )}
          </span>
        ),
    },
  ]

  return (
    <Section
      id={id}
      title="Участники"
      description="Кто работает с сайтом и с какой ролью. Новых приглашают по почте: человек получит письмо и сам задаст пароль."
    >
      <MembersTable siteId={siteId} access={access} />
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
          roles={roles.filter((role) => assignableRoles[access].includes(role))}
          invitations={invitations.data ?? []}
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
          compact
          empty={
            <EmptyState title="Приглашений пока нет" icon="user" headingLevel={3}>
              Пригласите администратора сайта или редактора формой выше.
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
  roles,
  invitations,
  disabled,
  onInvited,
}: {
  siteId: string
  /** Кого вошедший может пригласить: владелец — обе роли, администратор сайта — редакторов */
  roles: readonly InvitationRole[]
  /** Приглашения сайта: по ним видно, что адрес уже приглашён */
  invitations: readonly Invitation[]
  disabled: boolean
  onInvited: (email: string) => void
}) {
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const headingId = useId()
  const defaultRole: InvitationRole = roles[0] ?? 'editor'
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitationRole>(defaultRole)
  const [formError, setFormError] = useState<string>()
  // Повторное приглашение заменяет прежнее вместе с ролью: говорим об этом до отправки
  const existing = pendingInvitationFor(invitations, email)
  const warning = replaceWarning(existing, role)

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
      // Роль не «залипает»: следующее приглашение начинается с умолчания, а не с прошлого выбора
      setRole(defaultRole)
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
          {roles.length > 1 ? (
            <SegmentedControl
              legend="Роль"
              name="role"
              options={roles.map((option) => ({ value: option, label: roleLabels[option] }))}
              value={role}
              onChange={setRole}
            />
          ) : (
            <p>
              Роль — {roleLabels[role].toLowerCase()}. Администратора сайта приглашает владелец.
            </p>
          )}
          <p className={mutedClassName}>
            {roleLabels[role]} {roleHints[role]}.
          </p>
        </div>
        {warning && (
          <InlineAlert tone="warning" live>
            {warning}
          </InlineAlert>
        )}
        {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        <div>
          <Button type="submit" variant="primary" disabled={disabled} loading={invite.isPending}>
            {existing ? 'Заменить приглашение' : 'Пригласить'}
          </Button>
        </div>
      </form>
    </div>
  )
}

// Дата и время рвутся только между собой: внутри даты пробелы неразрывные, иначе «г.,» повисает
// в начале второй строки
function wrapAtTime(text: string) {
  const comma = text.lastIndexOf(', ')
  if (comma === -1) return text
  return `${text.slice(0, comma).replaceAll(' ', ' ')}, ${text.slice(comma + 2)}`
}
