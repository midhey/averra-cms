import { ForgotPassword } from '@averra/schema'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type FormEvent, useId, useRef, useState } from 'react'
import { requestPasswordReset } from '../auth'
import { ApiRequestError, messageOf } from '../errors'
import { firstInvalidField, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { passwordResetQuery } from '../queries'
import { TextField } from '../ui/TextField'
import { usePageTitle } from '../ui/use-page-title'
import styles from './screens.module.css'

const fieldOrder = ['email']

/** «Забыли пароль?»: письмо со ссылкой, а без почты — честно, как вернуть доступ иначе */
export function ForgotPasswordScreen() {
  const { data } = useSuspenseQuery(passwordResetQuery())
  const headingId = useId()
  // Почту могли выключить, пока экран открыт: тогда API ответит mail_disabled
  const [mailOff, setMailOff] = useState(false)
  usePageTitle('Сброс пароля')

  return (
    <main className={`${styles.screen} ${styles.narrow}`}>
      <h1 id={headingId}>Сброс пароля</h1>
      {data.available && !mailOff ? (
        <ResetRequestForm headingId={headingId} onMailOff={() => setMailOff(true)} />
      ) : (
        <ResetUnavailable />
      )}
      <p>
        <Link to="/login" search={{}}>
          Ко входу
        </Link>
      </p>
    </main>
  )
}

function ResetUnavailable() {
  return (
    <section className={styles.section}>
      <p role="alert" className={styles.formError}>
        Сброс пароля по почте сейчас недоступен: в админке не настроена почта.
      </p>
      <p>Как вернуть доступ:</p>
      <ul>
        <li>попросите владельца админки задать вам новый пароль;</li>
        <li>
          если вы владелец и у вас есть доступ к серверу — остановите API и выполните{' '}
          <code>pnpm user:password --email ваша@почта</code>: пароль спросят скрыто, все входы
          завершатся;
        </li>
        <li>чтобы сброс по почте заработал, настройте SMTP (README, раздел «Почта»).</li>
      </ul>
    </section>
  )
}

function ResetRequestForm({ headingId, onMailOff }: { headingId: string; onMailOff: () => void }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [email, setEmail] = useState('')
  const [formError, setFormError] = useState<string>()

  const parsed = ForgotPassword.safeParse({ email })
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const request = useMutation({
    mutationFn: requestPasswordReset,
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === 'mail_disabled') {
        onMailOff()
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
      focusField(formRef.current, firstInvalidField(fieldOrder, zodFieldErrors(parsed.error)))
      return
    }
    request.mutate(parsed.data)
  }

  if (request.isSuccess) {
    // Одинаково для любого адреса: API не говорит, есть ли такой, и экран тоже
    return (
      <section className={styles.section}>
        <p role="status" className={styles.notice}>
          Если адрес {request.variables.email} есть в админке, на него придёт письмо со ссылкой.
          Ссылка работает час и только один раз.
        </p>
        <p className={styles.muted}>
          Письма нет через несколько минут — загляните в «Спам» или запросите ссылку ещё раз.
        </p>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <p>Пришлём на почту ссылку, по которой можно задать новый пароль.</p>
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
        {formError && (
          <p role="alert" className={styles.formError}>
            {formError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={request.isPending}>
            Отправить ссылку
          </button>
        </div>
      </form>
    </section>
  )
}
