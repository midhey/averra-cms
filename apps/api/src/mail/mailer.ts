// Только типы и чистые функции: этот файл импортируют маршруты, а их типы читает админка.
// Реализации — smtp-mailer.ts, file-mailer.ts и memory-mailer.ts, их подключают index.ts,
// testing.ts и команда mail:test

import { MailAddress, MailSenderName, MailSubject } from '@averra/schema'
import { z } from 'zod'

/** Отправитель: адрес на своём домене и имя. Приходит из конфига, а не из данных письма */
export type MailSender = { address: string; name: string }

/**
 * Готовое письмо. From ставит провайдер из конфига. Всё, что идёт в заголовки, проверяется
 * схемой ещё раз перед отправкой (OutgoingMail): тему собирает шаблон, и перевод строки
 * в ней не должен дойти до SMTP
 */
export const OutgoingMail = z.object({
  to: MailAddress,
  subject: MailSubject,
  html: z.string().min(1),
  text: z.string().min(1),
  replyTo: MailAddress.optional(),
})
export type OutgoingMail = z.input<typeof OutgoingMail>

/** Что провайдер вернул об отправке */
export type SentMail = { messageId: string }

/** Провайдер без секретов: так его видят API, админка и логи */
export type MailerInfo =
  | {
      kind: 'smtp'
      host: string
      port: number
      security: 'tls' | 'starttls'
      user: string
      from: MailSender
    }
  | { kind: 'file'; dir: string; from: MailSender }
  | { kind: 'memory'; from: MailSender }

/**
 * Отправка писем. Как MediaStorage у медиатеки: провайдер меняется (SMTP, папка, память),
 * а код писем — нет. Ошибку отправки провайдер бросает как MailSendError с текстом без секретов
 */
export type Mailer = {
  readonly info: MailerInfo
  send(mail: OutgoingMail): Promise<SentMail>
  /** Закрыть соединения. После close письма не отправляются */
  close(): Promise<void>
}

/** Почта включена или нет — так её состояние видят API и админка */
export type MailStatus =
  | { enabled: true; provider: MailerInfo }
  | { enabled: false; reason: string }

/** Что сказать владельцу, когда почта не работает: и в API, и в админке */
export const MAIL_OFF_EFFECT =
  'Не работают сброс пароля, приглашения участников и уведомления о заявках'

/**
 * Ошибка отправки: текст уже без секретов и по-русски. permanent — повторять бессмысленно
 * (сервер навсегда отказал адресу получателя или письму), такое письмо сразу помечается
 * неотправленным
 */
export class MailSendError extends Error {
  override name = 'MailSendError'
  constructor(
    message: string,
    readonly permanent = false,
    /** На каком шаге сломалось: для pnpm mail:test */
    readonly step?: MailStep,
    /**
     * Сервер отказал адресу отправителя (ответ на MAIL FROM). Это настройки (адрес не того ящика,
     * под которым вход) или лимит отправителя, а не письмо: так же откажут любому письму. Очередь
     * прерывает проход и выжидает, не тратя попыток (worker.ts)
     */
    readonly rejectedSender = false,
  ) {
    super(message)
  }
}

/**
 * Настройки SMTP: из окружения (SMTP_*) или из админки. Пароль живёт только здесь и в замыкании
 * smtpMailer — наружу идёт MailerInfo без него. Тип здесь, а не в smtp-mailer.ts: его видят
 * маршруты (настройки в админке), а smtp-mailer.ts тянет Node API
 */
export type SmtpSettings = {
  host: string
  port: number
  /** tls — TLS сразу (465), starttls — обязательный STARTTLS (587). Без шифрования нельзя */
  security: 'tls' | 'starttls'
  user: string
  password: string
  from: MailSender
}

/** Шаги отправки через SMTP: на каком из них сломалось, говорит pnpm mail:test */
export type MailStep = 'dns' | 'connection' | 'tls' | 'auth' | 'send'

/** Итог одного шага проверки (pnpm mail:test, «Проверить подключение» в админке) */
export type DiagnosisStep = { step: MailStep; ok: boolean; message: string }

/** Итог проверки по шагам: ok — письмо принято сервером */
export type SmtpDiagnosis = { ok: boolean; steps: DiagnosisStep[] }

export const mailStepTitles: Record<MailStep, string> = {
  dns: 'DNS: имя сервера',
  connection: 'Соединение',
  tls: 'TLS: шифрование и сертификат',
  auth: 'Вход',
  send: 'Отправка',
}

// Без Buffer: файл читает и админка, а у неё нет типов Node
const toBase64 = (value: string) =>
  btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(''))

/**
 * Убирает секреты из текста ошибки: сам пароль и то, как он уходит на сервер, — base64
 * в AUTH LOGIN и в AUTH PLAIN (\0логин\0пароль). Сервер может повторить в ответе то, что
 * ему прислали, а ответ сервера попадает в ошибку, лог и очередь писем
 */
export function maskSecrets(text: string, secrets: readonly (string | undefined)[]) {
  // Сначала длинные формы: base64 пароля бывает хвостом base64 строки AUTH PLAIN, и, заменив
  // его первым, мы оставили бы в тексте начало строки AUTH PLAIN
  const forms = secrets
    .filter((secret): secret is string => Boolean(secret))
    .flatMap((secret) => [secret, toBase64(secret)])
    .sort((a, b) => b.length - a.length)
  let masked = text
  for (const form of forms) masked = masked.split(form).join('***')
  return masked
}

/** Формы пароля для maskSecrets: сам пароль и строка AUTH PLAIN с логином */
export const smtpSecrets = (user: string, password: string) => [
  password,
  `\u0000${user}\u0000${password}`,
]

/** Отправитель в виде, который понимает nodemailer. Имя и адрес уже прошли схемы */
export const senderOf = (from: MailSender) => {
  MailSenderName.parse(from.name)
  return { name: from.name, address: MailAddress.parse(from.address) }
}

/** Короткое описание провайдера для лога и команды: без пароля */
export function describeMailer(info: MailerInfo) {
  const from = `${info.from.name} <${info.from.address}>`
  switch (info.kind) {
    case 'smtp':
      return `SMTP ${info.host}:${info.port} (${info.security === 'tls' ? 'TLS' : 'STARTTLS'}), вход ${info.user}, отправитель ${from}`
    case 'file':
      return `файловый ящик ${info.dir}, отправитель ${from}`
    case 'memory':
      return `письма в памяти, отправитель ${from}`
  }
}

/**
 * Письмо перед отправкой: заголовки ещё раз через схемы. Не прошло — постоянная ошибка:
 * сколько ни повторяй, перевод строки из темы не исчезнет
 */
export function checkOutgoing(mail: OutgoingMail) {
  const parsed = OutgoingMail.safeParse(mail)
  if (parsed.success) return parsed.data
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join('.')} — ${issue.message}`)
    .join('; ')
  throw new MailSendError(`Письмо не прошло проверку заголовков: ${issues}`, true, 'send')
}
