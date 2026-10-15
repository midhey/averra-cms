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
import { TextField } from '../ui/TextField'
import { usePageTitle } from '../ui/use-page-title'
import styles from './screens.module.css'

const fieldOrder = ['password', 'repeat']

/** Новый пароль по ссылке из письма: …/reset-password#token=… */
export function ResetPasswordScreen() {
  const token = useLinkToken()
  const headingId = useId()
  usePageTitle('Новый пароль')

  return (
    <main className={`${styles.screen} ${styles.narrow}`}>
      <h1 id={headingId}>Новый пароль</h1>
      {token === undefined ? (
        <section className={styles.section}>
          <p role="alert" className={styles.formError}>
            Ссылка неполная: в ней нет токена. Откройте ссылку из письма целиком или запросите
            новую.
          </p>
          <p>
            <Link to="/forgot-password">Запросить новую ссылку</Link>
          </p>
        </section>
      ) : (
        <NewPassword token={token} headingId={headingId} />
      )}
    </main>
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
      <section className={styles.section}>
        <p ref={doneRef} tabIndex={-1} role="status" className={styles.notice}>
          Пароль изменён. Все входы с этим паролем на других устройствах завершены.
        </p>
        <p>
          <Link to="/login" search={{}}>
            Войти
          </Link>
        </p>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={styles.form}
        onSubmit={submit}
        noValidate
      >
        <TextField
          label="Новый пароль"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={form.errors.password}
          hint="От 10 символов"
        />
        <TextField
          label="Новый пароль ещё раз"
          name="repeat"
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={setRepeat}
          error={form.errors.repeat}
        />
        {formError && (
          <div role="alert" className={styles.formError}>
            <p>{formError.text}</p>
            {formError.deadLink && <Link to="/forgot-password">Запросить новую ссылку</Link>}
          </div>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={reset.isPending}>
            Сохранить пароль
          </button>
        </div>
      </form>
    </section>
  )
}
