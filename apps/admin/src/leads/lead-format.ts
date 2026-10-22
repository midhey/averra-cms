import { type LeadStatus, MailAddress, PHONE_PATTERN, patternRegExp } from '@averra/schema'
import { pluralRu } from '../format/plural'
import type { FieldErrors } from '../forms/field-errors'
import { pagePath } from '../pages-format'
import type { StatusTone } from '../ui/StatusPill'

/** Поле заявки так, как его отдаёт API: подпись и значение рядом */
export type LeadField = { name: string; label: string; type: string; value: string | boolean }

export const leadStatusLabels: Record<LeadStatus, string> = {
  new: 'Новая',
  processed: 'Обработана',
}

/** Тон плашки состояния: новая — акцентом, обработанная — спокойно */
export const leadStatusTones: Record<LeadStatus, StatusTone> = {
  new: 'info',
  processed: 'neutral',
}

const PHONE = patternRegExp(PHONE_PATTERN)

/**
 * Ссылка для значения поля: телефон — tel:, почта — mailto:. Только из значения, которое проходит
 * проверку формы (шаблон телефона, MailAddress); в tel: — цифры и «+» в начале, без пробелов
 * и скобок. Другое поле или непроверенное значение — без ссылки
 */
export function fieldHref(field: Pick<LeadField, 'type' | 'value'>) {
  if (typeof field.value !== 'string') return undefined
  const value = field.value.trim()
  if (field.type === 'phone' && PHONE.test(value)) {
    return `tel:${value.startsWith('+') ? '+' : ''}${value.replace(/\D/gu, '')}`
  }
  if (field.type === 'email') {
    const parsed = MailAddress.safeParse(value)
    if (parsed.success) return `mailto:${parsed.data}`
  }
  return undefined
}

/** Значение поля для человека: флажок — «да»/«нет», пустое — прочерк */
export function displayValue(field: Pick<LeadField, 'value'>) {
  if (typeof field.value === 'boolean') return field.value ? 'да' : 'нет'
  return field.value === '' ? '—' : field.value
}

const textOf = (field: Pick<LeadField, 'value'>) =>
  typeof field.value === 'string' ? field.value.replace(/\s+/g, ' ').trim() : ''

const cut = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

/**
 * Коротко о заявке: первые заполненные текстовые поля через «·» (обычно имя и телефон),
 * без переводов строк, не длиннее max
 */
export function leadSummary(fields: readonly LeadField[], max = 80) {
  const summary = fields
    .map(textOf)
    .filter((text) => text !== '')
    .slice(0, 2)
    .join(' · ')
  return summary === '' ? 'Без заполненных полей' : cut(summary, max)
}

/**
 * Как назвать заявку: поле «имя» формы (тип name), иначе первое заполненное поле текста или
 * выбора, иначе «Заявка». Телефон, почту, комментарий и флажки в имя не берём
 */
export function leadName(fields: readonly LeadField[], max = 60) {
  const filled = fields.filter((field) => textOf(field) !== '')
  const name =
    filled.find((field) => field.type === 'name') ??
    filled.find((field) => field.type === 'text' || field.type === 'select')
  return name ? cut(textOf(name), max) : 'Заявка'
}

/** Строка под именем в списке: комментарий посетителя, а без него — остальные поля */
export function leadPreview(fields: readonly LeadField[], max = 120) {
  const comment = fields.find((field) => field.type === 'textarea' && textOf(field) !== '')
  if (comment) return cut(textOf(comment), max)
  const name = leadName(fields)
  return leadSummary(
    fields.filter((field) => textOf(field) !== name),
    max,
  )
}

/** Почта посетителя для «Ответить письмом»: поле типа email с корректным адресом, иначе нет */
export function leadEmail(fields: readonly LeadField[]) {
  for (const field of fields) {
    if (field.type !== 'email' || typeof field.value !== 'string') continue
    const parsed = MailAddress.safeParse(field.value.trim())
    if (parsed.success) return parsed.data
  }
  return undefined
}

/**
 * «Ответить письмом»: почтовая программа человека с адресом посетителя и темой. Адрес уже
 * проверен схемой (без пробелов, ? и &), тема — через encodeURIComponent
 */
export function replyMailto(email: string, siteName: string) {
  const subject = `Ваша заявка на сайте «${siteName}»`
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`
}

/**
 * Откуда заявка: «Главная · форма «Замер»». Заголовок страницы — если экран его знает
 * (страницу могли и удалить), иначе адрес
 */
export const leadSource = (lead: { pageSlug: string; formTitle: string }, pageTitle?: string) =>
  `${pageTitle ?? pagePath(lead.pageSlug)} · форма «${lead.formTitle}»`

/** Адреса уведомлений из поля формы: через запятую, точку с запятой, пробел или с новой строки */
export const parseRecipients = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((address) => address.trim())
    .filter((address) => address !== '')

/**
 * Ошибки адресов (addresses.0, addresses.1…) — одним сообщением у поля: какой адрес не так.
 * field — имя поля со списком в схеме
 */
export function recipientsError(
  errors: FieldErrors,
  recipients: readonly string[],
  field = 'addresses',
) {
  for (const [path, message] of Object.entries(errors)) {
    if (message === undefined) continue
    if (path === field) return message
    const match = new RegExp(String.raw`^${field}\.(\d+)`).exec(path)
    if (match) return `${recipients[Number(match[1])] ?? 'Адрес'}: ${message}`
  }
  return undefined
}

/** «3 новые», «1 новая» — счётчик новых заявок словами */
export const newLeadsLabel = (count: number) =>
  `${count} ${pluralRu(count, ['новая', 'новые', 'новых'])}`

/**
 * Куда уходят уведомления, одной строкой под заголовком экрана заявок. targets — готовые
 * получатели (адреса и «Telegram «чат»»), пусто — владельцам письмом
 */
export function notificationsLine(
  notifications: { enabled: boolean; targets: readonly string[] },
  settings: { retentionDays: number },
) {
  const where = !notifications.enabled
    ? 'Уведомления не уходят'
    : notifications.targets.length === 0
      ? 'Уведомления уходят владельцам админки'
      : `Уведомления уходят: ${notifications.targets.join(', ')}`
  const days = pluralRu(settings.retentionDays, ['день', 'дня', 'дней'])
  return `${where} · хранятся ${settings.retentionDays} ${days}`
}
