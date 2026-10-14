/** Та часть JSON Schema, которую понимает конструктор форм. Её же отдаёт Zod через z.toJSONSchema */
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
}

export type FieldKind = 'text' | 'textarea' | 'select' | 'object' | 'list' | 'image' | 'unsupported'

/** Каким полем формы показывать значение. Длинный текст — многострочным полем */
export function fieldKind(schema: JsonSchema): FieldKind {
  // Картинка по устройству — объект { mediaId, alt }, но человеку нужен выбор из медиатеки
  if (schema['x-widget'] === 'image') return 'image'
  if (schema.enum) return 'select'
  switch (schema.type) {
    case 'string':
      // Строка с шаблоном (ссылка и т.п.) всегда однострочная, даже если допускает 2048 символов
      return (schema.maxLength ?? 0) > 150 && !schema.pattern ? 'textarea' : 'text'
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
