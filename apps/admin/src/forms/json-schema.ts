import type { EnumSketch } from '@averra/schema'

/**
 * Та часть JSON Schema, которую понимает конструктор форм. Её же отдаёт Zod через z.toJSONSchema
 */
export type JsonSchema = {
  type?: string
  title?: string
  description?: string
  enum?: readonly (string | number)[]
  default?: unknown
  maxLength?: number
  pattern?: string
  properties?: Record<string, JsonSchema>
  required?: readonly string[]
  items?: JsonSchema
  minItems?: number
  maxItems?: number
  /** Свой виджет вместо обычных полей: пометку ставит схема в @averra/schema (например, Image) */
  'x-widget'?: string
  /** Подписи вариантов выбора для людей: значение → подпись (тип поля формы: phone → «Телефон») */
  'x-enum-titles'?: Readonly<Record<string, string>>
  /**
   * Миниатюры вариантов оформления: значение → рисунок на карточке варианта (у первого экрана)
   */
  'x-enum-sketches'?: Readonly<Record<string, EnumSketch>>
}

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'object'
  | 'list'
  | 'image'
  | 'unsupported'

/** Каким полем формы показывать значение. Длинный текст — многострочным полем */
export function fieldKind(schema: JsonSchema): FieldKind {
  // Картинка по устройству — объект { mediaId, alt }, но человеку нужен выбор из медиатеки
  if (schema['x-widget'] === 'image') return 'image'
  if (schema.enum) return 'select'
  switch (schema.type) {
    case 'string':
      // Строка с шаблоном (ссылка и т.п.) всегда однострочная, даже если допускает 2048 символов
      return (schema.maxLength ?? 0) > 150 && !schema.pattern ? 'textarea' : 'text'
    case 'boolean':
      return 'checkbox'
    case 'object':
      return 'object'
    case 'array':
      return schema.items?.type === 'object' ? 'list' : 'unsupported'
    default:
      return 'unsupported'
  }
}

/** Пустое значение для нового элемента: значения по умолчанию и пустые обязательные поля */
export function emptyValue(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return structuredClone(schema.default)
  if (schema.enum) return schema.enum[0]
  switch (schema.type) {
    case 'string':
      return ''
    case 'array':
      return []
    case 'object': {
      const value: Record<string, unknown> = {}
      for (const key of schema.required ?? []) {
        const child = schema.properties?.[key]
        if (child) value[key] = emptyValue(child)
      }
      return value
    }
    default:
      return undefined
  }
}

/** Подпись варианта выбора для людей: из x-enum-titles, иначе само значение */
export const enumLabel = (schema: JsonSchema, option: string | number) =>
  schema['x-enum-titles']?.[String(option)] ?? String(option)

/** Короткий выбор помещается дорожкой сегментов: не больше стольких вариантов… */
const SEGMENTS_MAX_OPTIONS = 4
/** …и подписи не длиннее (иначе на узкой колонке полей дорожка вылезла бы за край) */
const SEGMENTS_MAX_LABEL = 14

/**
 * Каким элементом выбирать из вариантов: варианты оформления с миниатюрами — карточками,
 * короткий выбор («Колонок»: 2, 3, 4) — сегментами, длинный (тип поля формы) — списком
 */
export function enumAppearance(schema: JsonSchema): 'cards' | 'segments' | 'select' {
  const options = schema.enum ?? []
  const sketches = schema['x-enum-sketches']
  if (sketches && options.every((option) => sketches[String(option)] !== undefined)) return 'cards'
  const short = options.every((option) => enumLabel(schema, option).length <= SEGMENTS_MAX_LABEL)
  return options.length <= SEGMENTS_MAX_OPTIONS && short ? 'segments' : 'select'
}

/** Строка по шаблону (ссылка, адрес) — моноширинным: в адресе важен каждый знак */
export const isMonospace = (schema: JsonSchema) =>
  schema.type === 'string' && schema.pattern !== undefined
