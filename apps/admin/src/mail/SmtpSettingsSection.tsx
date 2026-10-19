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
import { Button } from '../ui/Button'
import { TextInput } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import { Facts, FormActions, formClassName, mutedClassName, Section } from '../ui/Screen'
import { SegmentedControl } from '../ui/SegmentedControl'
import styles from './SmtpSettingsSection.module.scss'
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
  const { data: smtp } = useSuspenseQuery(mailSmtpQuery())
  // После сохранения или удаления форма собирается заново (key), а сообщение остаётся здесь
  const [notice, setNotice] = useState<string>()
  const noticeRef = useRef<HTMLParagraphElement>(null)

  // Форма собралась заново: фокус — на итог, а не в никуда
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  return (
    <Section title="Настройки SMTP" card>
      <p className={mutedClassName}>{sourceLabel(smtp)}</p>
      {smtp.settings && <SavedSettings smtp={smtp} />}
      {smtp.lock && <InlineAlert tone="info">{smtp.lock.message}</InlineAlert>}
      {smtp.editable && smtp.key === 'dev' && (
        <InlineAlert tone="warning">
          Ключ шифрования учебный (pnpm dev): он лежит в репозитории, поэтому пароль в базе
          разработки защищён только для вида. Настоящий пароль от почты здесь не вводите.
        </InlineAlert>
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
    </Section>
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
  return <Facts label="Сохранённые настройки SMTP" items={rows} />
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
      <h3 id={headingId} className="visually-hidden">
        Изменить настройки SMTP
      </h3>
      <div className={formClassName}>
        <TextInput
          label="Сервер SMTP"
          name="host"
          mono
          value={form.host}
          onChange={(event) => update('host', event.target.value)}
          error={errors.host}
          hint="Например, smtp.yandex.ru"
        />
        <SegmentedControl
          legend="Порт и шифрование"
          name="port"
          options={smtpModes.map((mode) => ({ value: String(mode.port), label: mode.label }))}
          value={String(form.port)}
          onChange={(port) => update('port', Number(port) as SmtpForm['port'])}
        />
        {errors.security && <InlineAlert tone="danger">{errors.security}</InlineAlert>}
        <TextInput
          label="Логин"
          name="user"
          value={form.user}
          onChange={(event) => update('user', event.target.value)}
          error={errors.user}
          hint="Обычно адрес ящика"
        />
        <TextInput
          label="Пароль SMTP"
          name="password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(event) => update('password', event.target.value)}
          error={errors.password}
          hint={passwordHint(smtp.settings)}
        />
        <TextInput
          label="Адрес отправителя"
          name="fromAddress"
          type="email"
          value={form.fromAddress}
          onChange={(event) => update('fromAddress', event.target.value)}
          error={errors.fromAddress}
          hint="На своём домене с настроенными SPF, DKIM и DMARC"
        />
        <TextInput
          label="Имя отправителя"
          name="fromName"
          value={form.fromName}
          onChange={(event) => update('fromName', event.target.value)}
          error={errors.fromName}
        />
      </div>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Проверка подключения</legend>
        <p className={mutedClassName}>
          Те же шаги, что у pnpm mail:test: DNS, соединение, TLS, вход и проверочное письмо — по
          настройкам из формы, ещё не сохранённым.
        </p>
        <div className={formClassName}>
          <TextInput
            label="Куда отправить проверочное письмо"
            name="to"
            type="email"
            value={to}
            onChange={(event) => {
              setTo(event.target.value)
              setServerErrors((current) => ({ ...current, to: undefined }))
            }}
            error={errors.to}
            hint={
              smtp.settings?.password === 'set' && !form.password
                ? 'С сохранённым паролем SMTP — только на вашу почту и по сохранённым настройкам'
                : undefined
            }
          />
        </div>
        <FormActions>
          <Button loading={check.isPending} disabled={busy && !check.isPending} onClick={runCheck}>
            {check.isPending ? 'Проверяю…' : 'Проверить подключение'}
          </Button>
        </FormActions>
        {checked && (
          <>
            <ol className={styles.steps} aria-label="Шаги проверки">
              {checked.steps.map((step) => (
                <li key={step.step} className={step.ok ? styles.stepOk : styles.stepFailed}>
                  <Icon name={step.ok ? 'check' : 'close'} className={styles.stepIcon} />
                  <span>
                    <span className="visually-hidden">{step.ok ? 'Пройден:' : 'Не пройден:'}</span>{' '}
                    <strong>{smtpStepTitle(step.step)}</strong>: {step.message}
                  </span>
                </li>
              ))}
            </ol>
            {checked.ok ? (
              <InlineAlert tone={checkIsFresh ? 'success' : 'warning'} live>
                {checkIsFresh
                  ? `Подключение работает: проверочное письмо ушло на ${checked.to}. Можно сохранять`
                  : 'Настройки изменились после проверки — проверьте подключение ещё раз'}
              </InlineAlert>
            ) : (
              <InlineAlert tone="danger">
                Проверка не прошла
                {failedStep ? ` на шаге «${smtpStepTitle(failedStep.step)}»` : ''}: поправьте
                настройки и проверьте ещё раз
              </InlineAlert>
            )}
          </>
        )}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Сохранение</legend>
        <div className={formClassName}>
          <TextInput
            label="Ваш пароль от админки"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value)
              setServerErrors((current) => ({ ...current, currentPassword: undefined }))
            }}
            error={errors.currentPassword}
            hint="Почту меняют только с паролем: через неё уходят ссылки сброса пароля, и украденной сессии для этого мало"
          />
        </div>
        {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        <FormActions>
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            disabled={busy && !save.isPending}
          >
            Сохранить
          </Button>
          <Button onClick={() => runSave('unchecked')} disabled={busy}>
            Сохранить без проверки
          </Button>
          {smtp.source === 'database' && (
            <Button
              variant="danger"
              icon="trash"
              loading={remove.isPending}
              disabled={busy && !remove.isPending}
              onClick={runRemove}
            >
              Удалить настройки
            </Button>
          )}
        </FormActions>
      </fieldset>
    </form>
  )
}
