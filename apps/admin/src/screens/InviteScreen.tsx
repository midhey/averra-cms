import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { InferResponseType } from 'hono/client'
import { type FormEvent, useId, useRef, useState } from 'react'
import { api } from '../api'
import { signIn, signOut } from '../auth'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { firstInvalidField, zodFieldErrors } from '../forms/field-errors'
import { InvitedUserForm } from '../forms/password'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { roleHints, roleLabels } from '../invitations/invitation-format'
import { useLinkToken } from '../link-token'
import { formatDateTime } from '../pages-format'
import { invitationQuery, meQuery, queryKeys, switchUser } from '../queries'
import { TextField } from '../ui/TextField'
import { usePageTitle } from '../ui/use-page-title'
import styles from './screens.module.css'

/** Приглашение так, как его отдаёт API: поменяется ответ — экран перестанет компилироваться */
type Invitation = InferResponseType<typeof api.invitations.lookup.$post, 200>

/** Приглашение на сайт по ссылке из письма: …/invite#token=… */
export function InviteScreen() {
  const token = useLinkToken()
  usePageTitle('Приглашение')

  return (
    <main className={`${styles.screen} ${styles.narrow}`}>
      <h1>Приглашение на сайт</h1>
      {token === undefined ? (
        <p role="alert" className={styles.formError}>
          Ссылка неполная: в ней нет токена. Откройте ссылку из письма целиком.
        </p>
      ) : (
        <InvitationByToken token={token} />
      )}
    </main>
  )
}

function InvitationByToken({ token }: { token: string }) {
  const invitation = useQuery({ ...invitationQuery(token), retry: false })
  const me = useQuery(meQuery())

  if (invitation.isPending || me.isPending) {
    return (
      <p role="status" className={styles.message}>
        Загружаю приглашение…
      </p>
    )
  }
  if (invitation.isError) {
    return (
      <section className={styles.section}>
        <p role="alert" className={styles.formError}>
          {messageOf(invitation.error)}
        </p>
        <p>
          <Link to="/login" search={{}}>
            Ко входу
          </Link>
        </p>
      </section>
    )
  }

  const data = invitation.data
  return (
    <>
      <section className={styles.section} aria-label="О приглашении">
        <p>
          {data.inviterName ?? 'Владелец'} приглашает вас работать с сайтом «{data.siteName}» в
          Averra CMS.
        </p>
        <p>
          Роль — {roleLabels[data.role].toLowerCase()}: {roleHints[data.role]}.
        </p>
        <p className={styles.muted}>
          Приглашение для {data.email}, действует до{' '}
          <time dateTime={data.expiresAt}>{formatDateTime(data.expiresAt)}</time>.
        </p>
      </section>
      {!data.userExists ? (
        <NewUserForm token={token} invitation={data} />
      ) : me.data?.email === data.email ? (
        <AcceptAsMe token={token} />
      ) : me.data ? (
        <WrongUser current={me.data.email} invitation={data} />
      ) : (
        <SignInAndAccept token={token} invitation={data} />
      )}
    </>
  )
}

/** Принять от имени того, кто вошёл: API сверит адрес и выдаст доступ */
async function acceptInvitation(token: string) {
  const res = await api.invitations.accept.$post({ json: { token } })
  if (res.status !== 200) throw await apiRequestError(res)
  return res.json()
}

/** После принятия — на экран сайта: список сайтов и права надо загрузить заново */
function useOpenSite() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return async (siteId: string, signedIn: boolean) => {
    if (signedIn) await switchUser(queryClient, true)
    else await queryClient.invalidateQueries({ queryKey: queryKeys.sites })
    await navigate({ to: '/sites/$siteId', params: { siteId }, replace: true })
  }
}

const newUserFields = ['name', 'password', 'repeat']

function NewUserForm({ token, invitation }: { token: string; invitation: Invitation }) {
  const queryClient = useQueryClient()
  const openSite = useOpenSite()
  const formRef = useRef<HTMLFormElement>(null)
  const headingId = useId()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [formError, setFormError] = useState<string>()

  const parsed = InvitedUserForm.safeParse({ name, password, repeat })
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const register = useMutation({
    mutationFn: async (body: { name: string; password: string }) => {
      const res = await api.invitations.register.$post({ json: { token, ...body } })
      if (res.status !== 201) throw await apiRequestError(res)
      const { siteId } = await res.json()
      // Пароль человек только что задал сам: входим им, чтобы не набирать его второй раз
      await signIn({ email: invitation.email, password: body.password })
      return siteId
    },
    onSuccess: (siteId) => openSite(siteId, true),
    onError: async (error) => {
      // Вход у адреса появился, пока экран был открыт: покажем вход вместо формы
      if (error instanceof ApiRequestError && error.code === 'user_exists') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.invitation(token) })
        return
      }
      setFormError(messageOf(error))
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    form.attempt()
    setFormError(undefined)
    if (!parsed.success) {
      focusField(formRef.current, firstInvalidField(newUserFields, zodFieldErrors(parsed.error)))
      return
    }
    register.mutate({ name: parsed.data.name, password: parsed.data.password })
  }

  return (
    <section className={styles.section}>
      <h2 id={headingId}>Имя и пароль</h2>
      <p>
        Задайте имя и пароль: с ними вы будете входить в админку под адресом {invitation.email}.
      </p>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={styles.form}
        onSubmit={submit}
        noValidate
      >
        <TextField
          label="Имя"
          name="name"
          autoComplete="name"
          value={name}
          onChange={setName}
          error={form.errors.name}
          hint="Его видно в шапке админки и в истории публикаций"
        />
        <TextField
          label="Пароль"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={form.errors.password}
          hint="От 10 символов"
        />
        <TextField
          label="Пароль ещё раз"
          name="repeat"
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={setRepeat}
          error={form.errors.repeat}
        />
        {formError && (
          <p role="alert" className={styles.formError}>
            {formError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={register.isPending}>
            Принять приглашение
          </button>
        </div>
      </form>
    </section>
  )
}

function AcceptAsMe({ token }: { token: string }) {
  const openSite = useOpenSite()
  const accept = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: ({ siteId }) => openSite(siteId, false),
  })
  return (
    <section className={styles.section}>
      {accept.isError && (
        <p role="alert" className={styles.formError}>
          {messageOf(accept.error)}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={accept.isPending}
          onClick={() => accept.mutate()}
        >
          Принять приглашение
        </button>
      </div>
    </section>
  )
}

function WrongUser({ current, invitation }: { current: string; invitation: Invitation }) {
  const queryClient = useQueryClient()
  const logout = useMutation({
    mutationFn: signOut,
    // Остаёмся на экране: после выхода он предложит войти под адресом из приглашения
    onSuccess: () => switchUser(queryClient, false),
  })
  return (
    <section className={styles.section}>
      <p role="alert" className={styles.formError}>
        Сейчас вы вошли как {current}, а приглашение — для {invitation.email}. Выйдите и войдите под
        адресом из приглашения.
      </p>
      {logout.isError && (
        <p role="alert" className={styles.formError}>
          Не вышло выйти: {messageOf(logout.error)}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" disabled={logout.isPending} onClick={() => logout.mutate()}>
          Выйти
        </button>
      </div>
    </section>
  )
}

function SignInAndAccept({ token, invitation }: { token: string; invitation: Invitation }) {
  const openSite = useOpenSite()
  const formRef = useRef<HTMLFormElement>(null)
  const headingId = useId()
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string>()
  const [attempted, setAttempted] = useState(false)
  const passwordError = attempted && password === '' ? 'Введите пароль' : undefined

  const accept = useMutation({
    mutationFn: async () => {
      await signIn({ email: invitation.email, password })
      return acceptInvitation(token)
    },
    onSuccess: ({ siteId }) => openSite(siteId, true),
    onError: (error) => {
      setFormError(messageOf(error))
      setPassword('')
      focusField(formRef.current, 'password')
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAttempted(true)
    setFormError(undefined)
    if (password === '') {
      focusField(formRef.current, 'password')
      return
    }
    accept.mutate()
  }

  return (
    <section className={styles.section}>
      <h2 id={headingId}>Войти и принять</h2>
      <p>У адреса {invitation.email} уже есть вход в админку. Введите свой пароль.</p>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={styles.form}
        onSubmit={submit}
        noValidate
      >
        <TextField
          label="Пароль"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={passwordError}
        />
        {formError && (
          <p role="alert" className={styles.formError}>
            {formError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={accept.isPending}>
            Войти и принять
          </button>
        </div>
      </form>
      <p>
        <Link to="/forgot-password">Забыли пароль?</Link>
      </p>
    </section>
  )
}
