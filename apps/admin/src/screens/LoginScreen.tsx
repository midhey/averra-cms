import { SignIn } from '@averra/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useId, useRef, useState } from 'react'
import { signIn } from '../auth'
import { messageOf } from '../errors'
import { firstInvalidField, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { safeRedirect } from '../permissions'
import { switchUser } from '../queries'
import { AuthLayout } from '../shell/AuthLayout'
import { Button } from '../ui/Button'
import { TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { formClassName } from '../ui/Screen'
import { usePageTitle } from '../ui/use-page-title'

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
    <AuthLayout
      title="Вход в админку"
      headingId={headingId}
      footer={<p>Регистрации нет: участников приглашает владелец письмом со ссылкой.</p>}
    >
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
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={form.errors.email}
        />
        <TextInput
          label="Пароль"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={form.errors.password}
        />
        {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        <Button type="submit" variant="primary" loading={login.isPending}>
          Войти
        </Button>
        <p>
          <Link to="/forgot-password">Забыли пароль?</Link>
        </p>
      </form>
    </AuthLayout>
  )
}
