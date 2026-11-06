import {
  CONTAINER_FIELD_TYPES,
  CUSTOM_BLOCK_LIMITS,
  CUSTOM_FIELD_TYPES,
  CustomBlockDraft,
  type CustomBlockDraftInput,
  CustomBlocksFile,
  type CustomFieldInput,
  type CustomFieldType,
  type ImportResolution,
} from '@averra/schema'
import type { StatusTone } from '../ui/StatusPill'

/**
 * Опубликованные определения из ответа API (GET …/custom-blocks). Каждое читается схемой: тип
 * клиента Hono видит в нём JSON, а форма и проверка страницы — поля своего блока
 */
export function publishedDefinitions(blocks: readonly { published: unknown }[]) {
  return blocks.flatMap((block) => {
    const definition = CustomBlockDraft.safeParse(block.published)
    return definition.success ? [definition.data] : []
  })
}

/** Состояние своего блока для списка и экрана блока */
export function blockStatus(state: {
  published: boolean
  unpublished: boolean
  unsaved?: boolean
}): { tone: StatusTone; text: string } {
  if (state.unsaved) return { tone: 'warning', text: 'Не сохранено' }
  if (!state.published) return { tone: 'neutral', text: 'Не опубликован' }
  if (state.unpublished) return { tone: 'warning', text: 'Есть неопубликованные правки' }
  return { tone: 'success', text: 'Опубликован' }
}

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

/**
 * Ключ из названия: латиница, цифры и дефис между ними («Тарифы с наклейкой» → tarify-s-nakleykoy).
 * Начинается с буквы, не длиннее 40. Человек может поправить его до создания
 */
export function suggestKey(title: string) {
  const latin = [...title.toLowerCase()].map((char) => TRANSLIT[char] ?? char).join('')
  const key = latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return key.length >= 2 ? key : 'block'
}

/** Свободный ключ: tariffs → tariffs-2, tariffs-3… */
export function freeKey(key: string, taken: ReadonlySet<string>) {
  if (!taken.has(key)) return key
  const base = key.replace(/-\d+$/, '').slice(0, 36)
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/** Свободный ключ поля на уровне: text, text_2… */
function freeName(base: string, taken: ReadonlySet<string>) {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

const DEFAULT_NAMES: Record<CustomFieldType, string> = {
  text: 'title',
  textarea: 'text',
  number: 'number',
  boolean: 'enabled',
  select: 'variant',
  link: 'button',
  image: 'image',
  repeater: 'items',
  group: 'group',
}

/** Настройки поля, которые зависят от его вида: умолчания вида */
function typeSettings(type: CustomFieldType): Partial<CustomFieldInput> {
  switch (type) {
    case 'text':
      return { maxLength: 120 }
    case 'textarea':
      return { maxLength: 1000 }
    case 'number':
      return { integer: false }
    case 'boolean':
      return { default: false }
    case 'select':
      return {
        options: [
          { value: 'first', label: 'Первый' },
          { value: 'second', label: 'Второй' },
        ],
      }
    case 'repeater':
      return {
        min: 0,
        max: 10,
        fields: [{ type: 'text', name: 'title', label: 'Заголовок', required: true }],
      }
    case 'group':
      return { fields: [{ type: 'text', name: 'title', label: 'Заголовок' }] }
    default:
      return {}
  }
}

/** Новое поле вида type с ключом, свободным на этом уровне */
export function newField(type: CustomFieldType, siblings: readonly CustomFieldInput[]) {
  const name = freeName(DEFAULT_NAMES[type], new Set(siblings.map((field) => field.name)))
  return {
    type,
    name,
    label: CUSTOM_FIELD_TYPES[type],
    required: false,
    ...typeSettings(type),
  } as CustomFieldInput
}

/** Смена вида поля: ключ, подпись, подсказка и обязательность остаются, настройки — вида */
export function changeFieldType(field: CustomFieldInput, type: CustomFieldType): CustomFieldInput {
  const { name, label, hint, required } = field
  return {
    type,
    name,
    label,
    ...(hint !== undefined && { hint }),
    required: required ?? false,
    ...typeSettings(type),
  } as CustomFieldInput
}

/** Можно ли положить контейнер на этот уровень (1 — поля блока) */
export const containerAllowed = (depth: number) => depth < CUSTOM_BLOCK_LIMITS.depth

/** Виды полей для выбора на уровне: глубже последнего уровня контейнеров нет */
export const fieldTypesAt = (depth: number) =>
  (Object.keys(CUSTOM_FIELD_TYPES) as CustomFieldType[]).filter(
    (type) => containerAllowed(depth) || !CONTAINER_FIELD_TYPES.has(type),
  )

/** Число из поля ввода: пусто — нет значения, не число — тоже нет (ошибку покажет схема) */
export function numberOf(text: string) {
  if (text.trim() === '') return undefined
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) ? value : undefined
}

/** Файл переноса из текста: понятная ошибка вместо исключения JSON.parse */
export function readBlocksFile(
  text: string,
): { ok: true; blocks: CustomBlockDraftInput[] } | { ok: false; message: string } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, message: 'Это не JSON: выберите файл, выгруженный из «Свои блоки»' }
  }
  const file = CustomBlocksFile.safeParse(json)
  if (!file.success) {
    const issue = file.error.issues[0]
    const where = issue && issue.path.length > 0 ? ` (${issue.path.join('.')})` : ''
    return {
      ok: false,
      message: `Файл не подходит: ${issue?.message ?? 'неизвестная ошибка'}${where}`,
    }
  }
  return { ok: true, blocks: file.data.blocks }
}

/** Решение по ключу из файла, который уже занят на этой установке */
export type ConflictChoice = { action: 'replace' | 'skip' | 'rename'; rename: string }

/** Ключи из файла, занятые на установке, — с предложением на каждый: переименовать в свободный */
export function importConflicts(
  blocks: readonly { key: string }[],
  existing: ReadonlySet<string>,
): Record<string, ConflictChoice> {
  const taken = new Set([...existing, ...blocks.map((block) => block.key)])
  const conflicts: Record<string, ConflictChoice> = {}
  for (const block of blocks) {
    if (!existing.has(block.key)) continue
    const rename = freeKey(block.key, taken)
    taken.add(rename)
    conflicts[block.key] = { action: 'rename', rename }
  }
  return conflicts
}

/** Решения для API: заменить, пропустить или новое имя */
export const resolutionsOf = (choices: Readonly<Record<string, ConflictChoice>>) =>
  Object.fromEntries(
    Object.entries(choices).map(([key, choice]): [string, ImportResolution] => [
      key,
      choice.action === 'rename' ? { rename: choice.rename } : choice.action,
    ]),
  )

type PublishedPlace = { place: 'header' | 'footer'; field?: string; message: string }

const placeTitles = { header: 'Шапка сайта', footer: 'Подвал сайта' } as const

/**
 * Сообщение после публикации определения. Страницы и шапка/подвал, чьи данные больше не подходят,
 * называются явно: иначе блок молча пропал бы со страницы, а шапка стала бы стандартной
 */
export function publishNotice(
  placement: 'block' | 'header' | 'footer',
  result: {
    affected: readonly { title: string; message: string }[]
    places?: readonly PublishedPlace[]
  },
): { tone: 'success' | 'warning'; text: string } {
  const problems: string[] = []
  if (result.affected.length > 0) {
    problems.push(
      `Данные блока не подходят на страницах: ${result.affected
        .map((page) => `«${page.title}» — ${page.message}`)
        .join('; ')}. Там блок не покажется на сайте, пока страницу не поправят и не опубликуют`,
    )
  }
  for (const place of result.places ?? []) {
    const field = place.field ? ` (поле «${place.field}»)` : ''
    problems.push(
      `${placeTitles[place.place]}: поля своего вида не подходят${field} — ${place.message}. На сайте стандартный вид, пока поля не поправят в «Шапка и подвал» и не опубликуют`,
    )
  }
  if (problems.length > 0) return { tone: 'warning', text: `Опубликовано. ${problems.join('. ')}` }
  return {
    tone: 'success',
    text:
      placement === 'block'
        ? 'Опубликовано: блок есть в каталоге редактора, сайт пересобирается'
        : 'Опубликовано: вид можно выбрать в «Шапка и подвал», сайт пересобирается',
  }
}
