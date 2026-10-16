import type { LeadStatus } from '@averra/schema'
import type { FieldErrors } from '../forms/field-errors'

/** Поле заявки так, как его отдаёт API: подпись и значение рядом */
export type LeadField = { name: string; label: string; type: string; value: string | boolean }

export const leadStatusLabels: Record<LeadStatus, string> = {
  new: 'Новая',
  processed: 'Обработана',
}

/** Значение поля для человека: флажок — «да»/«нет», пустое — прочерк */
export function displayValue(field: Pick<LeadField, 'value'>) {
  if (typeof field.value === 'boolean') return field.value ? 'да' : 'нет'
  return field.value === '' ? '—' : field.value
}

/**
 * Коротко о заявке для строки списка: первые заполненные текстовые поля через «·» (обычно
 * имя и телефон), без переводов строк, не длиннее max
 */
export function leadSummary(fields: readonly LeadField[], max = 80) {
  const parts = fields
    .filter((field) => typeof field.value === 'string' && field.value.trim() !== '')
    .slice(0, 2)
    .map((field) => String(field.value).replace(/\s+/g, ' ').trim())
  const summary = parts.join(' · ')
  if (summary === '') return 'Без заполненных полей'
  return summary.length <= max ? summary : `${summary.slice(0, max - 1).trimEnd()}…`
}

/** Адреса уведомлений из поля формы: через запятую, точку с запятой, пробел или с новой строки */
export const parseRecipients = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((address) => address.trim())
    .filter((address) => address !== '')

/** Ошибки адресов (recipients.0, recipients.1…) — одним сообщением у поля: какой адрес не так */
export function recipientsError(errors: FieldErrors, recipients: readonly string[]) {
  for (const [path, message] of Object.entries(errors)) {
    if (message === undefined) continue
    if (path === 'recipients') return message
    const match = /^recipients\.(\d+)/.exec(path)
    if (match) return `${recipients[Number(match[1])] ?? 'Адрес'}: ${message}`
  }
  return undefined
}

/** «3 новые», «1 новая» — для ссылки «Заявки» в навигации сайта */
export function newLeadsLabel(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} новая`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} новые`
  return `${count} новых`
}
