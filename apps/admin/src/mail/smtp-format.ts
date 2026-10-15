import { smtpModes } from '@averra/schema'
import type { InferResponseType } from 'hono/client'
import type { api } from '../api'

// Раздел «Настройки SMTP» на экране «Почта»: подписи и перевод формы в тело запроса.
// Типы — из ответа API: поменяется ответ, перестанет компилироваться

/** Настройки SMTP так, как их отдаёт API: без пароля, только «задан» или «не читается» */
export type SmtpView = InferResponseType<typeof api.mail.smtp.$get, 200>

export type SmtpSettingsView = NonNullable<SmtpView['settings']>

/** Режим подключения в форме: порт, а шифрование к нему одно (465 — TLS, 587 — STARTTLS) */
export type SmtpModePort = (typeof smtpModes)[number]['port']

/** Поля формы как их вводит человек: строки, режим — порт */
export type SmtpForm = {
  host: string
  port: SmtpModePort
  user: string
  password: string
  fromAddress: string
  fromName: string
}

/** Шаги проверки словами — те же, что печатает pnpm mail:test */
export const smtpStepTitles: Record<string, string> = {
  dns: 'DNS: имя сервера',
  connection: 'Соединение',
  tls: 'TLS: шифрование и сертификат',
  auth: 'Вход',
  send: 'Отправка',
}

export const smtpStepTitle = (step: string) => smtpStepTitles[step] ?? step

/** Подпись режима: «465 — TLS сразу» */
export const smtpModeLabel = (port: number) =>
  smtpModes.find((mode) => mode.port === port)?.label ?? String(port)

/** Пустая форма или сохранённые настройки. Пароль в форму не приходит никогда */
export function formOf(settings: SmtpSettingsView | null): SmtpForm {
  return {
    host: settings?.host ?? '',
    port: settings?.port === 587 ? 587 : 465,
    user: settings?.user ?? '',
    password: '',
    fromAddress: settings?.fromAddress ?? '',
    fromName: settings?.fromName ?? 'Averra CMS',
  }
}

/** Поля формы → настройки для API: шифрование выводится из порта */
export function settingsOf(form: SmtpForm) {
  const mode = smtpModes.find((item) => item.port === form.port) ?? smtpModes[0]
  return {
    host: form.host,
    port: mode.port,
    security: mode.security,
    user: form.user,
    fromAddress: form.fromAddress,
    fromName: form.fromName,
  }
}

/**
 * Отпечаток того, что проверили: любая правка поля после проверки (и пароля тоже) делает
 * итог проверки чужим — «Сохранить» снова попросит проверить. Сервер сверяет это сам,
 * а здесь — чтобы сказать заранее
 */
export const checkedFingerprint = (form: SmtpForm, to: string) =>
  JSON.stringify([
    form.host,
    form.port,
    form.user,
    form.password,
    form.fromAddress,
    form.fromName,
    to,
  ])

/** Почему сохранённый пароль не читается — как его называет API */
export type PasswordProblem = NonNullable<SmtpSettingsView['passwordProblem']>

/** Подсказка под полем пароля, когда сохранённый пароль не читается: по причине из API */
const unreadableHints: Record<PasswordProblem, string> = {
  wrong_key:
    'Сохранённый пароль не читается: сменился ключ шифрования MAIL_ENCRYPTION_KEY. Введите пароль заново',
  corrupted: 'Сохранённый пароль не читается: запись в базе повреждена. Введите пароль заново',
  format: 'Сохранённый пароль не читается: запись в базе не того формата. Введите пароль заново',
  no_key: 'Сохранённый пароль не расшифровать без ключа шифрования MAIL_ENCRYPTION_KEY',
}

/** Что сказать о пароле SMTP под полем */
export function passwordHint(settings: SmtpSettingsView | null) {
  if (!settings) return 'Пароль не задан. У Яндекса — пароль приложения, а не от почты'
  if (settings.password === 'unreadable') {
    return unreadableHints[settings.passwordProblem ?? 'corrupted']
  }
  return 'Пароль задан. Оставьте поле пустым, чтобы не менять. Введите его заново, если поменяли сервер, — или чтобы проверить подключение с изменёнными настройками'
}

/**
 * Пароль в списке сохранённых настроек. Без ключа формы нет, и «введите заново» было бы
 * некуда: тогда — что пароль не расшифровать без ключа
 */
export function passwordStateLabel(settings: SmtpSettingsView, source: SmtpView['source']) {
  if (source === 'env') return 'задан на сервере'
  if (settings.password === 'set') return 'задан'
  if (settings.passwordProblem === 'no_key') {
    return 'задан, но без ключа MAIL_ENCRYPTION_KEY его не расшифровать'
  }
  return 'не читается — введите заново'
}

/** Откуда сейчас настройки SMTP */
export function sourceLabel(view: SmtpView) {
  switch (view.source) {
    case 'env':
      return 'Почта задана на сервере — в переменных окружения API.'
    case 'database':
      return 'Настройки SMTP заданы здесь, в админке.'
    case 'none':
      return 'SMTP не задан: без него письма не уходят наружу.'
  }
}
