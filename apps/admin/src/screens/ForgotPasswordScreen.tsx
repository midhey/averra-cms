import { ForgotPassword } from '@averra/schema'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type FormEvent, useId, useRef, useState } from 'react'
import { requestPasswordReset } from '../auth'
import { ApiRequestError, messageOf } from '../errors'
import { firstInvalidField, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { passwordResetQuery } from '../queries'
import { AuthLayout } from '../shell/AuthLayout'
import { Button } from '../ui/Button'
import { TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { formClassName, monoClassName, mutedClassName } from '../ui/Screen'
import { usePageTitle } from '../ui/use-page-title'
import styles from './AuthScreens.module.scss'

const fieldOrder = ['email']
const MAIL_DOCS_URL = 'https://midhey.github.io/averra-cms/install/mail/'

/** «Забыли пароль?»: письмо со ссылкой, а без почты — честно, как вернуть доступ иначе */
export function ForgotPasswordScreen() {
  const { data } = useSuspenseQuery(passwordResetQuery())
  const headingId = useId()
  // Почту могли выключить, пока экран открыт: тогда API ответит mail_disabled
  const [mailOff, setMailOff] = useState(false)
  usePageTitle('Сброс пароля')

  return (
    <AuthLayout
      title="Сброс пароля"
      headingId={headingId}
      footer={
        <Link to="/login" search={{}}>
          Ко входу
        </Link>
      }
    >
      {data.available && !mailOff ? (
        <ResetRequestForm headingId={headingId} onMailOff={() => setMailOff(true)} />
      ) : (
        <ResetUnavailable />
      )}
    </AuthLayout>
  )
}

function ResetUnavailable() {
  return (
    <div className={styles.stack}>
      <InlineAlert tone="danger">
        Сброс пароля по почте сейчас недоступен: в админке не настроена почта.
      </InlineAlert>
      <p>Как вернуть доступ:</p>
      <ul className={styles.list}>
        <li>попросите владельца админки задать вам новый пароль;</li>
        <li>
          если вы владелец и у вас есть доступ к серверу — в папке установки выполните{' '}
          <code className={monoClassName}>
            docker compose exec api node dist/server/user-password.js --email ваша@почта
          </code>
          : пароль спросят скрыто, все входы завершатся. В разработке —{' '}
          <code className={monoClassName}>pnpm user:password --email ваша@почта</code> при
          остановленном API;
        </li>
        <li>
          чтобы сброс по почте заработал, владелец настраивает SMTP на странице «Почта» —{' '}
          <a href={MAIL_DOCS_URL}>как настроить почту</a>.
        </li>
      </ul>
    </div>
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
      <div className={styles.stack}>
        <InlineAlert tone="success" live>
          Если адрес {request.variables.email} есть в админке, на него придёт письмо со ссылкой.
          Ссылка работает час и только один раз.
        </InlineAlert>
        <p className={mutedClassName}>
          Письма нет через несколько минут — загляните в «Спам» или запросите ссылку ещё раз.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.stack}>
      <p className={mutedClassName}>
        Пришлём на почту ссылку, по которой можно задать новый пароль.
      </p>
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
        {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        <Button type="submit" variant="primary" loading={request.isPending}>
          Отправить ссылку
        </Button>
      </form>
    </div>
  )
}
