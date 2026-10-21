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
import { AuthLayout } from '../shell/AuthLayout'
import { Button, Spinner } from '../ui/Button'
import { TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { formClassName, mutedClassName } from '../ui/Screen'
import { usePageTitle } from '../ui/use-page-title'
import styles from './AuthScreens.module.scss'

/** Приглашение так, как его отдаёт API: поменяется ответ — экран перестанет компилироваться */
type Invitation = InferResponseType<typeof api.invitations.lookup.$post, 200>

/** Приглашение на сайт по ссылке из письма: …/invite#token=… */
export function InviteScreen() {
  const token = useLinkToken()
  usePageTitle('Приглашение')

  return (
    <AuthLayout title="Приглашение на сайт">
      {token === undefined ? (
        <InlineAlert tone="danger">
          Ссылка неполная: в ней нет токена. Откройте ссылку из письма целиком.
        </InlineAlert>
      ) : (
        <InvitationByToken token={token} />
      )}
    </AuthLayout>
  )
}

function InvitationByToken({ token }: { token: string }) {
  const invitation = useQuery({ ...invitationQuery(token), retry: false })
  const me = useQuery(meQuery())

  if (invitation.isPending || me.isPending) {
    return (
      <p role="status" className={styles.loading}>
        <Spinner />
        Загружаю приглашение…
      </p>
    )
  }
  if (invitation.isError) {
    return (
      <div className={styles.stack}>
        <InlineAlert tone="danger">{messageOf(invitation.error)}</InlineAlert>
        <p>
          <Link to="/login" search={{}}>
            Ко входу
          </Link>
        </p>
      </div>
    )
  }

  const data = invitation.data
  return (
    <div className={styles.stack}>
      <section className={styles.about} aria-label="О приглашении">
        <p>
          {data.inviterName ?? 'Владелец'} приглашает вас работать с сайтом «{data.siteName}» в
          Averra CMS.
        </p>
        <p>
          Роль — {roleLabels[data.role].toLowerCase()}: {roleHints[data.role]}.
        </p>
        <p className={mutedClassName}>
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
    </div>
  )
}

/** Принять от имени того, кто вошёл: API сверит адрес и выдаст доступ */
async function acceptInvitation(token: string) {
  const res = await api.invitations.accept.$post({ json: { token } })
  if (res.status !== 200) throw await apiRequestError(res)
  return res.json()
}

/**
 * После принятия — на обзор сайта. Сайт у установки один, поэтому id не нужен, а вот доступ к нему
 * и роль надо загрузить заново: до принятия их не было
 */
function useOpenSite() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return async (signedIn: boolean) => {
    if (signedIn) await switchUser(queryClient, true)
    else {
      await queryClient.invalidateQueries({ queryKey: queryKeys.currentSite })
      await queryClient.invalidateQueries({ queryKey: ['sites'] })
    }
    await navigate({ to: '/', replace: true })
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
      // Пароль человек только что задал сам: входим им, чтобы не набирать его второй раз
      await signIn({ email: invitation.email, password: body.password })
    },
    onSuccess: () => openSite(true),
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
    <section className={styles.stack}>
      <h2 id={headingId} className={styles.subtitle}>
        Имя и пароль
      </h2>
      <p>
        Задайте имя и пароль: с ними вы будете входить в админку под адресом {invitation.email}.
      </p>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={formClassName}
        onSubmit={submit}
        noValidate
      >
        <TextInput
          label="Имя"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={form.errors.name}
          hint="Его видно в боковой панели админки и в истории публикаций"
        />
        <TextInput
          label="Пароль"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={form.errors.password}
          hint="От 10 символов"
        />
        <TextInput
          label="Пароль ещё раз"
          name="repeat"
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          error={form.errors.repeat}
        />
        {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        <Button type="submit" variant="primary" loading={register.isPending}>
          Принять приглашение
        </Button>
      </form>
    </section>
  )
}

function AcceptAsMe({ token }: { token: string }) {
  const openSite = useOpenSite()
  const accept = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: () => openSite(false),
  })
  return (
    <div className={styles.stack}>
      {accept.isError && <InlineAlert tone="danger">{messageOf(accept.error)}</InlineAlert>}
      <div>
        <Button variant="primary" loading={accept.isPending} onClick={() => accept.mutate()}>
          Принять приглашение
        </Button>
      </div>
    </div>
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
    <div className={styles.stack}>
      <InlineAlert tone="danger">
        Сейчас вы вошли как {current}, а приглашение — для {invitation.email}. Выйдите и войдите под
        адресом из приглашения.
      </InlineAlert>
      {logout.isError && (
        <InlineAlert tone="danger">Не вышло выйти: {messageOf(logout.error)}</InlineAlert>
      )}
      <div>
        <Button loading={logout.isPending} onClick={() => logout.mutate()}>
          Выйти
        </Button>
      </div>
    </div>
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
    onSuccess: () => openSite(true),
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
    <section className={styles.stack}>
      <h2 id={headingId} className={styles.subtitle}>
        Войти и принять
      </h2>
      <p>У адреса {invitation.email} уже есть вход в админку. Введите свой пароль.</p>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={formClassName}
        onSubmit={submit}
        noValidate
      >
        <TextInput
          label="Пароль"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={passwordError}
        />
        {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        <Button type="submit" variant="primary" loading={accept.isPending}>
          Войти и принять
        </Button>
      </form>
      <p>
        <Link to="/forgot-password">Забыли пароль?</Link>
      </p>
    </section>
  )
}
