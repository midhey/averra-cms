import { type LeadSource, type LeadStatus, leadFormLabel } from '@averra/schema'
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

/** Начало файла: BOM — иначе Excel прочтёт UTF-8 как Windows-1251 */
export const CSV_BOM = '\uFEFF'

/** Строка CSV: разделитель «;» (так CSV открывает Excel с русской локалью), в конце CRLF */
export const csvLine = (row: readonly string[]) => `${row.map(csvCell).join(';')}\r\n`

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
  source: LeadSource
  formTitle: string
  data: StoredLeadField[]
}

/** Заголовок CSV заявок: дата (по Москве), статус, страница, форма и колонка на каждую подпись */
export const leadsCsvHeader = (labels: readonly string[]) => [
  'Дата (МСК)',
  'Статус',
  'Страница',
  'Форма',
  ...labels,
]

/** Строка заявки под заголовком leadsCsvHeader(labels). У заявки без такого поля ячейка пустая */
export function leadCsvRow(lead: CsvLead, labels: readonly string[]) {
  const byLabel = new Map(lead.data.map((field) => [field.label, displayValue(field)]))
  return [
    dateFormat.format(lead.createdAt),
    statusLabels[lead.status],
    pagePath(lead.pageSlug),
    leadFormLabel(lead),
    ...labels.map((label) => byLabel.get(label) ?? ''),
  ]
}
