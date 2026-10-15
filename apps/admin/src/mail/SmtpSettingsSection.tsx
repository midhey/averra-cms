import { CurrentPassword, MailAddress, MailSettingsFields, smtpModes } from '@averra/schema'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import {
  type FieldErrors,
  firstInvalidField,
  issueFieldErrors,
  zodFieldErrors,
} from '../forms/field-errors'
import { focusField } from '../forms/use-form-errors'
import { formatDateTime } from '../pages-format'
import { mailSmtpQuery, meQuery, queryKeys } from '../queries'
import mailStyles from '../screens/MailScreen.module.css'
import styles from '../screens/screens.module.css'
import { TextField } from '../ui/TextField'
import {
  checkedFingerprint,
  formOf,
  passwordHint,
  passwordStateLabel,
  type SmtpForm,
  type SmtpView,
  settingsOf,
  smtpModeLabel,
  smtpStepTitle,
  sourceLabel,
} from './smtp-format'

/**
 * Настройки SMTP на экране «Почта». Окружение главнее админки, а без ключа шифрования пароль
 * хранить негде: тогда — только чтение и объяснение. Иначе форма: проверить подключение
 * по ещё не сохранённым настройкам и сохранить с паролем владельца. Пароля SMTP API не отдаёт,
 * и в форму он не возвращается: после сохранения поле пустое, рядом — «задан»
 */
export function SmtpSettingsSection() {
  const headingId = useId()
  const { data: smtp } = useSuspenseQuery(mailSmtpQuery())
  // После сохранения или удаления форма собирается заново (key), а сообщение остаётся здесь
  const [notice, setNotice] = useState<string>()
  const noticeRef = useRef<HTMLParagraphElement>(null)

  // Форма собралась заново: фокус — на итог, а не в никуда
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId}>Настройки SMTP</h2>
      <p className={mailStyles.source}>{sourceLabel(smtp)}</p>
      {smtp.settings && <SavedSettings smtp={smtp} />}
      {smtp.lock && (
        <p className={mailStyles.lock} data-reason={smtp.lock.reason}>
          {smtp.lock.message}
        </p>
      )}
      {smtp.editable && smtp.key === 'dev' && (
        <p className={mailStyles.warning}>
          Ключ шифрования учебный (pnpm dev): он лежит в репозитории, поэтому пароль в базе
          разработки защищён только для вида. Настоящий пароль от почты здесь не вводите.
        </p>
      )}
      {smtp.editable && (
        <SmtpSettingsForm
          key={`${smtp.source}-${smtp.settings?.updatedAt ?? 'none'}`}
          smtp={smtp}
          onStart={() => setNotice(undefined)}
          onDone={setNotice}
        />
      )}
      {notice && (
        <p ref={noticeRef} tabIndex={-1} role="status" className={styles.notice}>
          {notice}
        </p>
      )}
    </section>
  )
}

/** Что сохранено сейчас: без пароля, только его состояние */
function SavedSettings({ smtp }: { smtp: SmtpView }) {
  const settings = smtp.settings
  if (!settings) return null
  const rows: [string, string][] = [
    ['Сервер', `${settings.host}:${settings.port}`],
    ['Шифрование', smtpModeLabel(settings.port)],
    ['Логин', settings.user],
    ['Пароль', passwordStateLabel(settings, smtp.source)],
    ['Отправитель', `${settings.fromName} <${settings.fromAddress}>`],
  ]
  if (smtp.source === 'database') {
    rows.push([
      'Проверка подключения',
      settings.verifiedAt
        ? `пройдена ${formatDateTime(settings.verifiedAt)}`
        : 'не делалась: сохранено без проверки',
    ])
    if (settings.updatedAt) {
      rows.push([
        'Сохранено',
        `${formatDateTime(settings.updatedAt)}${settings.updatedBy ? `, ${settings.updatedBy}` : ''}`,
      ])
    }
  }
  return (
    <dl className={mailStyles.details} aria-label="Сохранённые настройки SMTP">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

type CheckResult = {
  ok: boolean
  steps: { step: string; ok: boolean; message: string }[]
  checkToken: string | null
  /** Для каких значений формы: правка после проверки делает итог чужим */
  fingerprint: string
  to: string
}

const fieldOrder = ['host', 'port', 'security', 'user', 'password', 'fromAddress', 'fromName']

type Attempts = { check?: boolean; save?: boolean; remove?: boolean }

/** С чем сохраняем: итог успешной проверки этих настроек или явное «Сохранить без проверки» */
type SaveProof = { checkToken: string } | { skipCheck: true }

function SmtpSettingsForm({
  smtp,
  onStart,
  onDone,
}: {
  smtp: SmtpView
  /** Человек начал новое действие: прежнее «сохранено» больше не про него */
  onStart: () => void
  onDone: (notice: string) => void
}) {
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const headingId = useId()
  const { data: me } = useQuery(meQuery())
  const [form, setForm] = useState<SmtpForm>(() => formOf(smtp.settings))
  const [to, setTo] = useState(me?.email ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [checked, setChecked] = useState<CheckResult>()
  // Ошибки схемы видны только после попытки — и только те, что нужны этому действию
  const [attempted, setAttempted] = useState<Attempts>({})
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string>()

  const settings = settingsOf(form)
  const fieldsParsed = MailSettingsFields.safeParse(settings)
  const toParsed = MailAddress.safeParse(to)
  const currentParsed = CurrentPassword.safeParse(currentPassword)
  const errors: FieldErrors = {
    ...serverErrors,
    ...(attempted.check || attempted.save ? zodFieldErrors(fieldsParsed.error) : {}),
    ...(attempted.check && !toParsed.success
      ? { to: toParsed.error.issues[0]?.message ?? 'Нужен адрес почты' }
      : {}),
    ...((attempted.save || attempted.remove) && !currentParsed.success
      ? { currentPassword: currentParsed.error.issues[0]?.message ?? 'Введите пароль' }
      : {}),
  }
  const fingerprint = checkedFingerprint(form, to)
  const checkIsFresh = checked?.ok === true && checked.fingerprint === fingerprint

  function update<K extends keyof SmtpForm>(name: K, value: SmtpForm[K]) {
    setForm((current) => ({ ...current, [name]: value }))
    setServerErrors((current) => ({ ...current, [name]: undefined }))
  }

  /** Ошибки ответа API: у полей — у полей, остальное — общей строкой */
  function showError(error: unknown) {
    if (error instanceof ApiRequestError && error.issues.length > 0) {
      const fieldErrors = issueFieldErrors(error.issues)
      setServerErrors(fieldErrors)
      const order = [...fieldOrder, 'to', 'currentPassword']
      const first = firstInvalidField(order, fieldErrors)
      if (first) {
        focusField(formRef.current, first)
        return
      }
      // Ошибка не у поля формы (например, итог проверки) — общей строкой
      setFormError(error.issues.map((issue) => issue.message).join('. '))
      return
    }
    if (error instanceof ApiRequestError && error.code === 'check_stale') setChecked(undefined)
    if (error instanceof ApiRequestError && error.code === 'mail_settings_locked') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mailSmtp })
    }
    setFormError(messageOf(error))
  }

  // Что проверяли, передаём в мутацию явно: пока идёт проверка, поля могут поправить
  const check = useMutation({
    mutationFn: async (checking: { fingerprint: string; to: string }) => {
      const res = await api.mail.smtp.check.$post({
        json: { ...settings, password: form.password, to: checking.to },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: (result, checking) => setChecked({ ...result, ...checking }),
    onError: (error) => {
      setChecked(undefined)
      showError(error)
    },
  })

  /** Сохранили или удалили: новые настройки в кеш, состояние почты и очередь — заново */
  async function finish(view: SmtpView, notice: string) {
    queryClient.setQueryData(queryKeys.mailSmtp, view)
    await queryClient.invalidateQueries({
      queryKey: queryKeys.mail,
      predicate: (query) => query.queryKey[1] !== 'smtp',
    })
    onDone(notice)
  }

  // Итог проверки или «без проверки» мутация получает явно (proofFor): тихо превратить одно
  // в другое она не может
  const save = useMutation({
    mutationFn: async (proof: SaveProof) => {
      const res = await api.mail.smtp.$put({
        json: { ...settings, password: form.password, currentPassword, ...proof },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (result) => {
      const changed = result.changed.length > 0 ? `Изменено: ${result.changed.join(', ')}.` : ''
      const mailed =
        result.notified > 0
          ? ` Владельцам ушло письмо «Настройки почты изменены» (${result.notified}).`
          : ''
      await finish(result.smtp, `Настройки SMTP сохранены. ${changed}${mailed}`)
    },
    onError: showError,
  })

  const remove = useMutation({
    mutationFn: async () => {
      const res = await api.mail.smtp.$delete({ json: { currentPassword } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: (result) =>
      finish(
        result.smtp,
        'Настройки SMTP удалены из админки. Почта работает так, как задано на сервере.',
      ),
    onError: showError,
  })

  const busy = check.isPending || save.isPending || remove.isPending

  function startAction(kind: keyof Attempts) {
    onStart()
    setFormError(undefined)
    setServerErrors({})
    setAttempted((current) => ({ ...current, [kind]: true }))
  }

  function runCheck() {
    startAction('check')
    if (!fieldsParsed.success) {
      focusField(formRef.current, firstInvalidField(fieldOrder, zodFieldErrors(fieldsParsed.error)))
      return
    }
    if (!toParsed.success) {
      focusField(formRef.current, 'to')
      return
    }
    check.mutate({ fingerprint, to })
  }

  /** Чем подтверждаем настройки: свежим итогом проверки или явным «без проверки». Нечем — почему */
  function proofFor(mode: 'checked' | 'unchecked'): { proof: SaveProof } | { error: string } {
    if (mode === 'unchecked') return { proof: { skipCheck: true } }
    const checkToken = checkIsFresh ? checked?.checkToken : null
    if (checkToken) return { proof: { checkToken } }
    return {
      error: checked
        ? 'Настройки изменились после проверки: проверьте подключение ещё раз — или сохраните без проверки'
        : 'Сначала проверьте подключение — или нажмите «Сохранить без проверки»',
    }
  }

  function runSave(mode: 'checked' | 'unchecked') {
    startAction('save')
    if (!fieldsParsed.success) {
      focusField(formRef.current, firstInvalidField(fieldOrder, zodFieldErrors(fieldsParsed.error)))
      return
    }
    const proof = proofFor(mode)
    if ('error' in proof) {
      setFormError(proof.error)
      return
    }
    if (!currentParsed.success) {
      focusField(formRef.current, 'currentPassword')
      return
    }
    if (
      mode === 'unchecked' &&
      !window.confirm(
        'Сохранить настройки SMTP без проверки? Если они неверны, письма (сброс пароля, приглашения) перестанут уходить',
      )
    ) {
      return
    }
    save.mutate(proof.proof)
  }

  function runRemove() {
    startAction('remove')
    if (!currentParsed.success) {
      focusField(formRef.current, 'currentPassword')
      return
    }
    if (
      !window.confirm(
        'Удалить настройки SMTP из админки? Почта вернётся к тому, что задано на сервере, — возможно, выключится',
      )
    ) {
      return
    }
    remove.mutate()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    runSave('checked')
  }

  const failedStep = checked?.steps.find((step) => !step.ok)

  return (
    <form
      ref={formRef}
      aria-labelledby={headingId}
      className={styles.form}
      onSubmit={submit}
      noValidate
    >
      <h3 id={headingId} className={styles.visuallyHidden}>
        Изменить настройки SMTP
      </h3>
      <TextField
        label="Сервер SMTP"
        name="host"
        value={form.host}
        onChange={(value) => update('host', value)}
        error={errors.host}
        hint="Например, smtp.yandex.ru"
      />
      <fieldset className={styles.choice}>
        <legend>Порт и шифрование</legend>
        {smtpModes.map((mode) => (
          <label key={mode.port}>
            <input
              type="radio"
              name="port"
              value={mode.port}
              checked={form.port === mode.port}
              onChange={() => update('port', mode.port)}
            />
            {mode.label}
          </label>
        ))}
      </fieldset>
      {errors.security && <p className={styles.formError}>{errors.security}</p>}
      <TextField
        label="Логин"
        name="user"
        value={form.user}
        onChange={(value) => update('user', value)}
        error={errors.user}
        hint="Обычно адрес ящика"
      />
      <TextField
        label="Пароль SMTP"
        name="password"
        type="password"
        autoComplete="new-password"
        value={form.password}
        onChange={(value) => update('password', value)}
        error={errors.password}
        hint={passwordHint(smtp.settings)}
      />
      <TextField
        label="Адрес отправителя"
        name="fromAddress"
        type="email"
        value={form.fromAddress}
        onChange={(value) => update('fromAddress', value)}
        error={errors.fromAddress}
        hint="На своём домене с настроенными SPF, DKIM и DMARC"
      />
      <TextField
        label="Имя отправителя"
        name="fromName"
        value={form.fromName}
        onChange={(value) => update('fromName', value)}
        error={errors.fromName}
      />

      <fieldset className={mailStyles.group}>
        <legend>Проверка подключения</legend>
        <p className={styles.muted}>
          Те же шаги, что у pnpm mail:test: DNS, соединение, TLS, вход и проверочное письмо — по
          настройкам из формы, ещё не сохранённым.
        </p>
        <TextField
          label="Куда отправить проверочное письмо"
          name="to"
          type="email"
          value={to}
          onChange={(value) => {
            setTo(value)
            setServerErrors((current) => ({ ...current, to: undefined }))
          }}
          error={errors.to}
          hint={
            smtp.settings?.password === 'set' && !form.password
              ? 'С сохранённым паролем SMTP — только на вашу почту и по сохранённым настройкам'
              : undefined
          }
        />
        <div className={styles.actions}>
          <button type="button" onClick={runCheck} disabled={busy}>
            {check.isPending ? 'Проверяю…' : 'Проверить подключение'}
          </button>
        </div>
        {checked && (
          <>
            <ol className={mailStyles.steps} aria-label="Шаги проверки">
              {checked.steps.map((step) => (
                <li key={step.step} data-ok={step.ok}>
                  <span aria-hidden="true">{step.ok ? '✓' : '✗'}</span>
                  <span className={styles.visuallyHidden}>
                    {step.ok ? 'Пройден:' : 'Не пройден:'}
                  </span>{' '}
                  <strong>{smtpStepTitle(step.step)}</strong>: {step.message}
                </li>
              ))}
            </ol>
            {checked.ok ? (
              <p role="status" className={styles.notice}>
                {checkIsFresh
                  ? `Подключение работает: проверочное письмо ушло на ${checked.to}. Можно сохранять`
                  : 'Настройки изменились после проверки — проверьте подключение ещё раз'}
              </p>
            ) : (
              <p role="alert" className={styles.formError}>
                Проверка не прошла
                {failedStep ? ` на шаге «${smtpStepTitle(failedStep.step)}»` : ''}: поправьте
                настройки и проверьте ещё раз
              </p>
            )}
          </>
        )}
      </fieldset>

      <fieldset className={mailStyles.group}>
        <legend>Сохранение</legend>
        <TextField
          label="Ваш пароль от админки"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(value) => {
            setCurrentPassword(value)
            setServerErrors((current) => ({ ...current, currentPassword: undefined }))
          }}
          error={errors.currentPassword}
          hint="Почту меняют только с паролем: через неё уходят ссылки сброса пароля, и украденной сессии для этого мало"
        />
        {formError && (
          <p role="alert" className={styles.formError}>
            {formError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={busy}>
            Сохранить
          </button>
          <button type="button" onClick={() => runSave('unchecked')} disabled={busy}>
            Сохранить без проверки
          </button>
          {smtp.source === 'database' && (
            <button type="button" className={styles.danger} onClick={runRemove} disabled={busy}>
              Удалить настройки
            </button>
          )}
        </div>
      </fieldset>
    </form>
  )
}
