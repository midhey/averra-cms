import { z } from 'zod'
import { hasHeaderBreak, MailAddress, MailSenderName } from './mail'

// Настройки SMTP, которые владелец задаёт в админке (страница «Почта»). Схемы строгие: лишнее
// поле — ошибка, а не тихо выброшенные данные. Поэтому скрытого параметра, который снял бы
// проверку сертификата или шифрование (rejectUnauthorized, ignoreTLS…), в запросе не бывает

/** Режимы подключения: TLS сразу на 465 или обязательный STARTTLS на 587. Других нет */
export const smtpModes = [
  { port: 465, security: 'tls', label: '465 — TLS сразу' },
  { port: 587, security: 'starttls', label: '587 — STARTTLS' },
] as const

export type SmtpMode = (typeof smtpModes)[number]

export const SmtpSecurity = z.enum(['tls', 'starttls'], 'Шифрование — tls (465) или starttls (587)')

/**
 * Порт — только 465 или 587. Проверка подключения ходит туда, куда скажет владелец: с любым
 * портом сервер стал бы сканером портов чужих машин
 */
export const SmtpPort = z.union([z.literal(465), z.literal(587)], 'Порт — 465 или 587')

const BREAK_MESSAGE = 'Нельзя переводить строку и вставлять управляющие символы'

const noBreaks = (value: string) => !hasHeaderBreak(value)

/**
 * Имя SMTP-сервера или IPv4: без схемы, порта и пути. В нижнем регистре и без точки в конце —
 * так «тот же ли это сервер» (сохранённый пароль уходит только на сохранённый) сравнивается
 * простым равенством
 */
export const SmtpHost = z
  .string()
  .refine(noBreaks, BREAK_MESSAGE)
  .trim()
  .toLowerCase()
  .pipe(z.hostname('Имя сервера латиницей, без http:// и порта, например smtp.yandex.ru'))
  .transform((host) => host.replace(/\.$/, ''))

/** Логин SMTP, обычно адрес ящика. Одной строкой: он уходит серверу в AUTH */
export const SmtpUser = z
  .string()
  .refine(noBreaks, BREAK_MESSAGE)
  .trim()
  .pipe(z.string().min(1, 'Введите логин SMTP').max(254))

/**
 * Пароль SMTP. Пустая строка значит «оставить прежний» — это решает API. Переводы строк
 * и управляющие символы запрещены: в пароле приложения их не бывает, а лишний перевод строки
 * в конце — почти всегда ошибка копирования, из-за которой вход потом молча не проходит
 */
export const SmtpPassword = z
  .string()
  .max(256, 'Пароль SMTP — до 256 символов')
  .refine(
    noBreaks,
    'В пароле не должно быть переводов строки и управляющих символов: проверьте, что он скопирован без лишнего',
  )

/** Свой пароль от админки — для действий, через которые можно перехватить доступ (почта) */
export const CurrentPassword = z.string().min(1, 'Введите свой пароль от админки').max(1000)

const fields = {
  host: SmtpHost,
  port: SmtpPort,
  security: SmtpSecurity,
  user: SmtpUser,
  fromAddress: MailAddress,
  fromName: MailSenderName,
}

const modeMatches = (value: { port: number; security: string }) =>
  smtpModes.some((mode) => mode.port === value.port && mode.security === value.security)

const modeIssue = {
  path: ['security'],
  message: 'Порт и шифрование: 465 — TLS сразу, 587 — STARTTLS',
}

/** Настройки SMTP без пароля: так их видят формы и ответ API */
export const MailSettingsFields = z.strictObject(fields).refine(modeMatches, modeIssue)
export type MailSettingsFields = z.infer<typeof MailSettingsFields>

/**
 * «Проверить подключение»: настройки как в форме, ещё не сохранённые, пароль SMTP (пустой —
 * сохранённый, если сервер тот же) и куда отправить проверочное письмо
 */
export const CheckMailSettings = z
  .strictObject({ ...fields, password: SmtpPassword.optional(), to: MailAddress })
  .refine(modeMatches, modeIssue)
export type CheckMailSettings = z.input<typeof CheckMailSettings>

/**
 * Сохранить настройки: с паролем владельца и итогом успешной проверки (checkToken) — или явным
 * «Сохранить без проверки» (skipCheck). Пустой пароль SMTP — оставить прежний
 */
export const SaveMailSettings = z
  .strictObject({
    ...fields,
    password: SmtpPassword.optional(),
    currentPassword: CurrentPassword,
    checkToken: z.string().min(1).max(200).optional(),
    skipCheck: z.literal(true, 'skipCheck — только true').optional(),
  })
  .refine(modeMatches, modeIssue)
  .refine((value) => value.checkToken !== undefined || value.skipCheck === true, {
    path: ['checkToken'],
    message: 'Сначала проверьте подключение — или сохраните без проверки',
  })
  .refine((value) => value.checkToken === undefined || value.skipCheck === undefined, {
    path: ['skipCheck'],
    message: 'Либо итог проверки, либо «без проверки» — не оба сразу',
  })
export type SaveMailSettings = z.input<typeof SaveMailSettings>

/** Удалить настройки SMTP из админки — тоже только с паролем владельца */
export const DeleteMailSettings = z.strictObject({ currentPassword: CurrentPassword })
export type DeleteMailSettings = z.input<typeof DeleteMailSettings>
