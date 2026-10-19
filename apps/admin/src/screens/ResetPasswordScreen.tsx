import { ResetPasswordToken } from '@averra/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { resetPassword } from '../auth'
import { ApiRequestError, messageOf } from '../errors'
import { firstInvalidField, zodFieldErrors } from '../forms/field-errors'
import { NewPasswordForm } from '../forms/password'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { useLinkToken } from '../link-token'
import { switchUser } from '../queries'
import { AuthLayout } from '../shell/AuthLayout'
import { Button } from '../ui/Button'
import { TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { formClassName } from '../ui/Screen'
import { usePageTitle } from '../ui/use-page-title'
import styles from './AuthScreens.module.scss'

const fieldOrder = ['password', 'repeat']

/** Ссылка не годится ещё до запроса в API: что сказать и куда идти дальше */
function BrokenLink({ message }: { message: string }) {
  return (
    <div className={styles.stack}>
      <InlineAlert tone="danger">{message}</InlineAlert>
      <p>
        <Link to="/forgot-password">Запросить новую ссылку</Link>
      </p>
    </div>
  )
}

/** Новый пароль по ссылке из письма: …/reset-password#token=… */
export function ResetPasswordScreen() {
  const token = useLinkToken()
  const headingId = useId()
  usePageTitle('Новый пароль')
  // Формат токена — той же схемой, что у API. Обрезанная при копировании ссылка — «повреждена»,
  // а не «устарела или заменена»: так ответил бы API, не отличая её от мёртвой
  const damaged =
    token === undefined ? undefined : ResetPasswordToken.safeParse(token).error?.issues[0]?.message

  return (
    <AuthLayout title="Новый пароль" headingId={headingId}>
      {token === undefined ? (
        <BrokenLink message="Ссылка неполная: в ней нет токена. Откройте ссылку из письма целиком или запросите новую." />
      ) : damaged !== undefined ? (
        <BrokenLink message={damaged} />
      ) : (
        <NewPassword token={token} headingId={headingId} />
      )}
    </AuthLayout>
  )
}

function NewPassword({ token, headingId }: { token: string; headingId: string }) {
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const doneRef = useRef<HTMLParagraphElement>(null)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [formError, setFormError] = useState<{ text: string; deadLink: boolean }>()

  const parsed = NewPasswordForm.safeParse({ password, repeat })
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const reset = useMutation({
    mutationFn: resetPassword,
    // API завершил все входы пользователя, и, если он был в этом браузере, его cookie уже
    // ничего не значит: всё загруженное от его имени сбрасываем
    onSuccess: () => switchUser(queryClient, false),
    onError: (error) =>
      setFormError({
        text: messageOf(error),
        deadLink: error instanceof ApiRequestError && error.code === 'invalid_token',
      }),
  })

  // Форма пропала — фокус на сообщение, а не в никуда
  useEffect(() => {
    if (reset.isSuccess) doneRef.current?.focus()
  }, [reset.isSuccess])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    form.attempt()
    setFormError(undefined)
    if (!parsed.success) {
      focusField(formRef.current, firstInvalidField(fieldOrder, zodFieldErrors(parsed.error)))
      return
    }
    reset.mutate({ token, newPassword: parsed.data.password })
  }

  if (reset.isSuccess) {
    return (
      <div className={styles.stack}>
        <p ref={doneRef} tabIndex={-1} role="status" className={styles.done}>
          Пароль изменён. Все входы с этим паролем на других устройствах завершены.
        </p>
        <p>
          <Link to="/login" search={{}}>
            Войти
          </Link>
        </p>
      </div>
    )
  }

  return (
    <form
      ref={formRef}
      aria-labelledby={headingId}
      className={formClassName}
      onSubmit={submit}
      noValidate
    >
      <TextInput
        label="Новый пароль"
        name="password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={form.errors.password}
        hint="От 10 символов"
      />
      <TextInput
        label="Новый пароль ещё раз"
        name="repeat"
        type="password"
        autoComplete="new-password"
        value={repeat}
        onChange={(event) => setRepeat(event.target.value)}
        error={form.errors.repeat}
      />
      {formError && (
        <InlineAlert tone="danger">
          <p>{formError.text}</p>
          {formError.deadLink && <Link to="/forgot-password">Запросить новую ссылку</Link>}
        </InlineAlert>
      )}
      <Button type="submit" variant="primary" loading={reset.isPending}>
        Сохранить пароль
      </Button>
    </form>
  )
}
