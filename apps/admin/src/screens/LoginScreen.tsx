import { SignIn } from '@averra/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useId, useRef, useState } from 'react'
import { signIn } from '../auth'
import { messageOf } from '../errors'
import { firstInvalidField, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { safeRedirect } from '../permissions'
import { switchUser } from '../queries'
import { TextField } from '../ui/TextField'
import { usePageTitle } from '../ui/use-page-title'
import styles from './screens.module.css'

const route = getRouteApi('/login')

const fieldOrder = ['email', 'password']

export function LoginScreen() {
  const { redirect } = route.useSearch()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const formRef = useRef<HTMLFormElement>(null)
  const headingId = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string>()
  usePageTitle('Вход')

  const parsed = SignIn.safeParse({ email, password })
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const login = useMutation({
    mutationFn: signIn,
    onSuccess: async () => {
      await switchUser(queryClient, true)
      await navigate({ href: safeRedirect(redirect), replace: true })
    },
    onError: (error) => {
      setFormError(messageOf(error))
      // После неудачи пароль набирают заново: фокус сразу туда
      setPassword('')
      focusField(formRef.current, 'password')
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
    login.mutate(parsed.data)
  }

  return (
    <main className={`${styles.screen} ${styles.narrow}`}>
      <h1 id={headingId}>Вход в админку</h1>
      <section className={styles.section}>
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
            autoComplete="username"
            value={email}
            onChange={setEmail}
            error={form.errors.email}
          />
          <TextField
            label="Пароль"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            error={form.errors.password}
          />
          {formError && (
            <p role="alert" className={styles.formError}>
              {formError}
            </p>
          )}
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={login.isPending}>
              Войти
            </button>
          </div>
        </form>
      </section>
      <p className={styles.muted}>
        Регистрации нет: пользователей создаёт владелец командой <code>pnpm user:create</code>.
      </p>
    </main>
  )
}
