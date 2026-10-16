import type { LeadStatus } from '@averra/schema'
import type { StoredLeadField } from '../../db/schema'
import { displayValue, pagePath } from './service'

// Выгрузка заявок в CSV для Excel и Google Таблиц. Значения пишет посетитель сайта, а таблица
// считает формулой ячейку, которая начинается с = + - @ (а Excel — ещё и с табуляции и возврата
// каретки). Формула в выгрузке — это CSV-инъекция: =HYPERLINK(…) уводит на чужой сайт,
// а DDE в старом Excel запускает команды. Такие значения получают впереди апостроф

const FORMULA_START = /^[=+\-@\t\r]/

/** Ячейка CSV: в кавычках, кавычки удвоены, начало формулы обезврежено апострофом */
export function csvCell(value: string) {
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

/**
 * Таблица в CSV: разделитель «;» (так CSV открывает Excel с русской локалью), строки через CRLF,
 * в начале BOM — иначе Excel прочтёт UTF-8 как Windows-1251
 */
export function toCsv(rows: readonly (readonly string[])[]) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
})

const statusLabels: Record<LeadStatus, string> = { new: 'новая', processed: 'обработана' }

type CsvLead = {
  createdAt: Date
  status: LeadStatus
  pageSlug: string
  formTitle: string
  data: StoredLeadField[]
}

/**
 * Заявки в CSV: дата (по Москве), статус, страница, форма и поля всех форм — колонка на каждую
 * подпись, в порядке, в каком подписи встретились. У заявки без такого поля ячейка пустая
 */
export function leadsCsv(leads: readonly CsvLead[]) {
  const labels: string[] = []
  for (const lead of leads) {
    for (const field of lead.data) if (!labels.includes(field.label)) labels.push(field.label)
  }
  const header = ['Дата (МСК)', 'Статус', 'Страница', 'Форма', ...labels]
  const rows = leads.map((lead) => {
    const byLabel = new Map(lead.data.map((field) => [field.label, displayValue(field)]))
    return [
      dateFormat.format(lead.createdAt),
      statusLabels[lead.status],
      pagePath(lead.pageSlug),
      lead.formTitle,
      ...labels.map((label) => byLabel.get(label) ?? ''),
    ]
  })
  return toCsv([header, ...rows])
}
