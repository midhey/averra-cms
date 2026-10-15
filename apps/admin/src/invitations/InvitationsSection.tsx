import { NewInvitation } from '@averra/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { formatDateTime } from '../pages-format'
import { invitationsQuery, mailQuery, queryKeys } from '../queries'
import styles from '../screens/screens.module.css'
import { TextField } from '../ui/TextField'
import {
  canRevoke,
  type InvitationRole,
  roleHints,
  roleLabels,
  statusLabels,
} from './invitation-format'

type Notice = { kind: 'done' | 'error'; text: string }

/**
 * Участники сайта у владельца: пригласить по почте и список приглашений с отзывом.
 * Письмо уходит через очередь; без почты API ответит 503, а раздел скажет это заранее
 */
export function InvitationsSection({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient()
  const headingId = useId()
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

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId}>Участники</h2>
      {mailOff && (
        <p role="alert" className={styles.formError}>
          Приглашения не уйдут: {mailOff}
        </p>
      )}
      {mail.error && (
        <p className={styles.muted}>
          Не удалось узнать, настроена ли почта: {messageOf(mail.error)}. Пригласить всё равно
          можно: если почта выключена, админка скажет об этом при отправке.
        </p>
      )}
      <InviteForm
        siteId={siteId}
        disabled={mailOff !== undefined}
        onInvited={(email) =>
          setNotice({ kind: 'done', text: `Приглашение отправлено на ${email}` })
        }
      />

      <h3 id={listHeadingId} ref={listHeadingRef} tabIndex={-1}>
        Приглашения
      </h3>
      {invitations.error && (
        <div role="alert" className={styles.formError}>
          <p>Не удалось загрузить приглашения: {messageOf(invitations.error)}</p>
          <button
            type="button"
            disabled={invitations.isFetching}
            onClick={() => {
              void invitations.refetch()
              if (mail.error) void mail.refetch()
            }}
          >
            Повторить
          </button>
        </div>
      )}
      {invitations.isPending && <p className={styles.muted}>Загружаем приглашения…</p>}
      {invitations.data?.length === 0 && <p className={styles.empty}>Приглашений пока нет.</p>}
      {invitations.data && invitations.data.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.wideTable}`} aria-labelledby={listHeadingId}>
            <thead>
              <tr>
                <th scope="col">Почта</th>
                <th scope="col">Роль</th>
                <th scope="col">Состояние</th>
                <th scope="col">Пригласил</th>
                <th scope="col">Действует до</th>
                <th scope="col">
                  <span className={styles.visuallyHidden}>Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invitations.data.map((invitation) => (
                <tr key={invitation.id}>
                  <td>{invitation.email}</td>
                  <td>{roleLabels[invitation.role]}</td>
                  <td>{statusLabels[invitation.status]}</td>
                  <td>{invitation.invitedBy ?? '—'}</td>
                  <td>
                    <time dateTime={invitation.expiresAt}>
                      {formatDateTime(invitation.expiresAt)}
                    </time>
                  </td>
                  <td className={styles.rowActions}>
                    {canRevoke(invitation.status) && (
                      <button
                        type="button"
                        className={styles.danger}
                        aria-label={`Отозвать приглашение для ${invitation.email}`}
                        disabled={revoke.isPending}
                        onClick={() => {
                          setNotice(undefined)
                          revoke.mutate({ id: invitation.id, email: invitation.email })
                        }}
                      >
                        Отозвать
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
    <>
      <h3 id={headingId}>Пригласить участника</h3>
      <p className={styles.muted}>
        Придёт письмо со ссылкой: по ней человек сам задаст пароль. Ссылка действует 7 дней.
      </p>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={styles.form}
        onSubmit={submit}
        noValidate
      >
        <TextField
          label="Почта"
          name="email"
          type="email"
          value={email}
          onChange={(value) => {
            setEmail(value)
            form.clearServerError('email')
          }}
          error={form.errors.email}
        />
        <fieldset className={styles.choice}>
          <legend>Роль</legend>
          {roles.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="role"
                value={option}
                checked={role === option}
                onChange={() => setRole(option)}
              />
              {roleLabels[option]} — {roleHints[option]}
            </label>
          ))}
        </fieldset>
        {formError && (
          <p role="alert" className={styles.formError}>
            {formError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={disabled || invite.isPending}>
            Пригласить
          </button>
        </div>
      </form>
    </>
  )
}
