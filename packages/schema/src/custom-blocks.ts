import { z } from 'zod'
import { BlockInstance, type BlockType, blocks } from './blocks'
import { Button } from './common'
import { BLOCK_CATEGORIES, type BlockCategory, BlockId } from './define-block'
import { Image } from './media'

/**
 * Свои блоки: определение (поля, шаблон Liquid, CSS) хранится в базе установки, а не в коде.
 * Схема полей отсюда — одна для API, админки и MCP: из определения строится Zod-схема блока
 * (customBlockProps), как у встроенных из defineBlock
 */

/** Тип своего блока на странице: custom:<ключ>. Двоеточия нет ни в одном встроенном типе */
export const CUSTOM_BLOCK_PREFIX = 'custom:'

/** Пределы определения: чтобы форма блока оставалась формой, а рендер — быстрым */
export const CUSTOM_BLOCK_LIMITS = {
  /** Полей во всём блоке, со всеми уровнями */
  fields: 60,
  /** Полей на одном уровне (в блоке, повторителе или группе) */
  fieldsPerLevel: 30,
  /** Уровней полей: блок → повторитель → группа. Глубже форма уже не читается */
  depth: 3,
  /** Вариантов у выбора из списка */
  options: 30,
  /** Пунктов у повторителя */
  repeaterItems: 50,
  /** Знаков в JSON примера данных: у API нет общего предела тела, а пример сохраняется без проверки */
  example: 100_000,
  /** Знаков в шаблоне */
  template: 20_000,
  /** Знаков в CSS */
  css: 20_000,
  /** Знаков в текстовом поле */
  text: 2000,
  textarea: 5000,
} as const

const KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Ключи, занятые адресами API (…/custom-blocks/export и …/import) */
const RESERVED_KEYS: ReadonlySet<string> = new Set(['export', 'import'])

/**
 * Ключ своего блока: латиница в нижнем регистре, цифры и дефис между ними. Из него — тип на
 * странице (custom:tariffs), селектор CSS и имя в каталоге MCP. Ключ не меняют после создания:
 * по нему блоки на страницах находят своё определение
 */
export const CustomBlockKey = z
  .string()
  .min(2, { abort: true })
  .max(40, { abort: true })
  .regex(
    KEY_PATTERN,
    'Ключ: латиница в нижнем регистре, цифры и дефис между ними, например tariffs',
  )
  .refine((key) => !RESERVED_KEYS.has(key), 'Этот ключ занят: выберите другой')

/** Тип своего блока на странице */
export const CustomBlockType = z.templateLiteral([
  CUSTOM_BLOCK_PREFIX,
  z.string().regex(KEY_PATTERN),
])
export type CustomBlockType = z.infer<typeof CustomBlockType>

export const customBlockType = (key: string): CustomBlockType => `${CUSTOM_BLOCK_PREFIX}${key}`
export const isCustomBlockType = (type: string): type is CustomBlockType =>
  type.startsWith(CUSTOM_BLOCK_PREFIX)
/** Блок страницы — свой (по типу): сужает тип блока до своего */
export const isCustomBlock = <Block extends { type: string }>(
  block: Block,
): block is Extract<Block, { type: CustomBlockType }> => isCustomBlockType(block.type)
/** Ключ определения по типу блока на странице */
export const customBlockKeyOf = (type: CustomBlockType) => type.slice(CUSTOM_BLOCK_PREFIX.length)

// Имена, которые в шаблоне Liquid значат другое: поле с таким ключом было бы недоступно
const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'block',
  'forloop',
  'tablerowloop',
  'empty',
  'blank',
  'nil',
  'null',
  'true',
  'false',
  'and',
  'or',
  'contains',
])

/** Ключ поля: имя переменной в шаблоне ({{ title }}) и ключ в данных блока на странице */
export const CustomFieldName = z
  .string()
  .min(1, { abort: true })
  .max(40, { abort: true })
  .regex(/^[a-z][a-z0-9_]*$/, 'Ключ поля: латиница в нижнем регистре, цифры и _, с буквы')
  .refine((name) => !RESERVED_FIELD_NAMES.has(name), 'Это слово занято в шаблоне: выберите другое')

/** Типы полей и их подписи для людей — как в ACF */
export const CUSTOM_FIELD_TYPES = {
  text: 'Текст',
  textarea: 'Многострочный текст',
  number: 'Число',
  boolean: 'Переключатель',
  select: 'Выбор из списка',
  link: 'Ссылка',
  image: 'Картинка',
  repeater: 'Повторитель',
  group: 'Группа',
} as const
export type CustomFieldType = keyof typeof CUSTOM_FIELD_TYPES
/** Поля, внутри которых свои поля */
export const CONTAINER_FIELD_TYPES: ReadonlySet<CustomFieldType> = new Set(['repeater', 'group'])

type FieldBase = { name: string; label: string; hint?: string | undefined; required: boolean }
type FieldBaseInput = Omit<FieldBase, 'required'> & { required?: boolean | undefined }

export type CustomField = FieldBase &
  (
    | {
        type: 'text' | 'textarea'
        minLength?: number | undefined
        maxLength: number
        default?: string | undefined
      }
    | {
        type: 'number'
        min?: number | undefined
        max?: number | undefined
        integer: boolean
        default?: number | undefined
      }
    | { type: 'boolean'; default: boolean }
    | {
        type: 'select'
        options: { value: string; label: string }[]
        default?: string | undefined
      }
    | { type: 'link' | 'image' }
    | { type: 'repeater'; min: number; max: number; fields: CustomField[] }
    | { type: 'group'; fields: CustomField[] }
  )

export type CustomFieldInput = FieldBaseInput &
  (
    | {
        type: 'text' | 'textarea'
        minLength?: number | undefined
        maxLength?: number | undefined
        default?: string | undefined
      }
    | {
        type: 'number'
        min?: number | undefined
        max?: number | undefined
        integer?: boolean | undefined
        default?: number | undefined
      }
    | { type: 'boolean'; default?: boolean | undefined }
    | {
        type: 'select'
        options: { value: string; label: string }[]
        default?: string | undefined
      }
    | { type: 'link' | 'image' }
    | {
        type: 'repeater'
        min?: number | undefined
        max?: number | undefined
        fields: CustomFieldInput[]
      }
    | { type: 'group'; fields: CustomFieldInput[] }
  )

const base = {
  name: CustomFieldName,
  label: z.string().trim().min(1).max(80),
  hint: z.string().trim().max(200).optional(),
  required: z.boolean().default(false),
}

const length = (max: number) => z.int().min(0).max(max)

const TextFieldDef = z.strictObject({
  type: z.literal('text'),
  ...base,
  minLength: length(CUSTOM_BLOCK_LIMITS.text).optional(),
  maxLength: length(CUSTOM_BLOCK_LIMITS.text).min(1).default(120),
  default: z.string().max(CUSTOM_BLOCK_LIMITS.text).optional(),
})

const TextareaFieldDef = z.strictObject({
  type: z.literal('textarea'),
  ...base,
  minLength: length(CUSTOM_BLOCK_LIMITS.textarea).optional(),
  maxLength: length(CUSTOM_BLOCK_LIMITS.textarea).min(1).default(1000),
  default: z.string().max(CUSTOM_BLOCK_LIMITS.textarea).optional(),
})

const NumberFieldDef = z.strictObject({
  type: z.literal('number'),
  ...base,
  min: z.number().optional(),
  max: z.number().optional(),
  integer: z.boolean().default(false),
  default: z.number().optional(),
})

const BooleanFieldDef = z.strictObject({
  type: z.literal('boolean'),
  ...base,
  default: z.boolean().default(false),
})

const SelectOption = z.strictObject({
  value: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Значение варианта: латиница в нижнем регистре, цифры, _ и -'),
  label: z.string().trim().min(1).max(60),
})

const SelectFieldDef = z.strictObject({
  type: z.literal('select'),
  ...base,
  options: z.array(SelectOption).min(2).max(CUSTOM_BLOCK_LIMITS.options),
  default: z.string().optional(),
})

const LinkFieldDef = z.strictObject({ type: z.literal('link'), ...base })
const ImageFieldDef = z.strictObject({ type: z.literal('image'), ...base })

const RepeaterFieldDef = z.strictObject({
  type: z.literal('repeater'),
  ...base,
  min: z.int().min(0).max(CUSTOM_BLOCK_LIMITS.repeaterItems).default(0),
  max: z.int().min(1).max(CUSTOM_BLOCK_LIMITS.repeaterItems).default(10),
  get fields(): z.ZodArray<z.ZodType<CustomField, CustomFieldInput>> {
    return z.array(CustomFieldDef).min(1).max(CUSTOM_BLOCK_LIMITS.fieldsPerLevel)
  },
})

const GroupFieldDef = z.strictObject({
  type: z.literal('group'),
  ...base,
  get fields(): z.ZodArray<z.ZodType<CustomField, CustomFieldInput>> {
    return z.array(CustomFieldDef).min(1).max(CUSTOM_BLOCK_LIMITS.fieldsPerLevel)
  },
})

/** Поле своего блока: что видит человек в форме и что получает шаблон */
export const CustomFieldDef: z.ZodType<CustomField, CustomFieldInput> = z.discriminatedUnion(
  'type',
  [
    TextFieldDef,
    TextareaFieldDef,
    NumberFieldDef,
    BooleanFieldDef,
    SelectFieldDef,
    LinkFieldDef,
    ImageFieldDef,
    RepeaterFieldDef,
    GroupFieldDef,
  ],
)

const categories = Object.keys(BLOCK_CATEGORIES) as [BlockCategory, ...BlockCategory[]]
const builtinTypes = blocks.map((block) => block.type) as [BlockType, ...BlockType[]]

/**
 * Определение своего блока — черновик и опубликованная версия одного вида. Сохраняется и с
 * ошибками шаблона, CSS и примера (код пишут по частям), а публикуется только без них. Структура
 * полей проверяется всегда: из неё строится форма
 */
export const CustomBlockDraft = z
  .strictObject({
    key: CustomBlockKey,
    title: z.string().trim().min(1).max(60),
    description: z.string().trim().min(1).max(160),
    /** Раздел каталога: его видит нейронка в list_blocks, по нему же фильтр «Добавить блок» */
    category: z.enum(categories).default('about'),
    /** Набросок в каталоге — как у встроенного блока. Нет — общий набросок своего блока */
    sketch: z.enum(builtinTypes).optional(),
    fields: z.array(CustomFieldDef).min(1).max(CUSTOM_BLOCK_LIMITS.fieldsPerLevel),
    template: z.string().max(CUSTOM_BLOCK_LIMITS.template).default(''),
    css: z.string().max(CUSTOM_BLOCK_LIMITS.css).default(''),
    /** Пример данных: с ним блок встаёт на страницу, его видят каталог, предпросмотр и MCP */
    example: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((draft, ctx) => {
    if (JSON.stringify(draft.example).length > CUSTOM_BLOCK_LIMITS.example) {
      ctx.addIssue({
        code: 'custom',
        path: ['example'],
        message: `Пример данных слишком большой: не больше ${CUSTOM_BLOCK_LIMITS.example} знаков`,
      })
    }
    let total = 0
    const walk = (fields: readonly CustomField[], path: (string | number)[], depth: number) => {
      const names = new Set<string>()
      fields.forEach((field, index) => {
        total += 1
        const at = [...path, index]
        if (names.has(field.name)) {
          ctx.addIssue({
            code: 'custom',
            path: [...at, 'name'],
            message: `Ключ «${field.name}» уже есть на этом уровне`,
          })
        }
        names.add(field.name)
        for (const issue of fieldIssues(field)) {
          ctx.addIssue({ code: 'custom', path: [...at, issue.key], message: issue.message })
        }
        if (field.type !== 'repeater' && field.type !== 'group') return
        if (depth >= CUSTOM_BLOCK_LIMITS.depth) {
          ctx.addIssue({
            code: 'custom',
            path: [...at, 'type'],
            message: `Слишком глубоко: не больше ${CUSTOM_BLOCK_LIMITS.depth} уровней полей`,
          })
          return
        }
        walk(field.fields, [...at, 'fields'], depth + 1)
      })
    }
    walk(draft.fields, ['fields'], 1)
    if (total > CUSTOM_BLOCK_LIMITS.fields) {
      ctx.addIssue({
        code: 'custom',
        path: ['fields'],
        message: `Полей не больше ${CUSTOM_BLOCK_LIMITS.fields} во всём блоке, сейчас ${total}`,
      })
    }
  })
export type CustomBlockDraft = z.infer<typeof CustomBlockDraft>
export type CustomBlockDraftInput = z.input<typeof CustomBlockDraft>

/** Что не так с настройками одного поля (кроме вложенных): ключ настройки → текст */
function fieldIssues(field: CustomField): { key: string; message: string }[] {
  const issues: { key: string; message: string }[] = []
  switch (field.type) {
    case 'text':
    case 'textarea':
      if (field.minLength !== undefined && field.minLength > field.maxLength) {
        issues.push({ key: 'minLength', message: 'Минимум длины больше максимума' })
      }
      if (field.default !== undefined && field.default.trim().length > field.maxLength) {
        issues.push({ key: 'default', message: `Не длиннее ${field.maxLength} символов` })
      }
      break
    case 'number':
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        issues.push({ key: 'min', message: 'Минимум больше максимума' })
      }
      if (field.default !== undefined) {
        if (field.min !== undefined && field.default < field.min) {
          issues.push({ key: 'default', message: `Не меньше ${field.min}` })
        } else if (field.max !== undefined && field.default > field.max) {
          issues.push({ key: 'default', message: `Не больше ${field.max}` })
        } else if (field.integer && !Number.isInteger(field.default)) {
          issues.push({ key: 'default', message: 'Нужно целое число' })
        }
      }
      break
    case 'select': {
      const values = field.options.map((option) => option.value)
      if (new Set(values).size !== values.length) {
        issues.push({ key: 'options', message: 'Значения вариантов повторяются' })
      }
      if (field.default !== undefined && !values.includes(field.default)) {
        issues.push({ key: 'default', message: 'Такого варианта нет в списке' })
      }
      break
    }
    case 'repeater':
      if (field.min > field.max) issues.push({ key: 'min', message: 'Минимум больше максимума' })
      break
    default:
      break
  }
  return issues
}

const schemas = new WeakMap<readonly CustomField[], z.ZodObject>()

/**
 * Zod-схема данных своего блока по его полям — как props у встроенного: проверка в API и
 * админке, умолчания, JSON Schema для формы и MCP. Поля должны пройти CustomBlockDraft
 */
export function customBlockProps(fields: readonly CustomField[]): z.ZodObject {
  const cached = schemas.get(fields)
  if (cached) return cached
  const schema = z.strictObject(
    Object.fromEntries(fields.map((field) => [field.name, fieldSchema(field)])),
  )
  schemas.set(fields, schema)
  return schema
}

function fieldSchema(field: CustomField): z.ZodType {
  const meta = { title: field.label, ...(field.hint ? { description: field.hint } : {}) }
  switch (field.type) {
    case 'text':
    case 'textarea': {
      const min = field.required ? Math.max(1, field.minLength ?? 1) : (field.minLength ?? 0)
      let text = z.string().trim()
      if (min > 0) text = text.min(min)
      text = text.max(field.maxLength)
      return presence(text, field, field.default, {
        ...meta,
        ...(field.type === 'textarea' && { 'x-multiline': true }),
      })
    }
    case 'number': {
      let number = field.integer ? z.int() : z.number()
      if (field.min !== undefined) number = number.min(field.min)
      if (field.max !== undefined) number = number.max(field.max)
      return presence(number, field, field.default, meta)
    }
    case 'boolean':
      return z.boolean().default(field.default).meta(meta)
    case 'select': {
      const values = field.options.map((option) => option.value) as [string, ...string[]]
      const titles = Object.fromEntries(field.options.map((option) => [option.value, option.label]))
      return z
        .enum(values)
        .default(field.default ?? values[0])
        .meta({ ...meta, 'x-enum-titles': titles })
    }
    case 'link':
      return presence(Button, field, undefined, meta)
    case 'image':
      return presence(Image, field, undefined, { ...meta, 'x-widget': 'image' })
    case 'repeater': {
      const list = z
        .array(customBlockProps(field.fields))
        .min(Math.max(field.min, field.required ? 1 : 0))
        .max(field.max)
      return field.min === 0 && !field.required ? list.default([]).meta(meta) : list.meta(meta)
    }
    case 'group':
      return presence(customBlockProps(field.fields), field, undefined, meta)
    default: {
      const unknown: never = field
      return unknown
    }
  }
}

/** Обязательное — как есть, с умолчанием — с ним (поле можно не присылать), иначе необязательное */
function presence(
  schema: z.ZodType,
  field: { required: boolean },
  fallback: unknown,
  meta: Record<string, unknown>,
) {
  if (fallback !== undefined) return schema.default(fallback).meta(meta)
  return (field.required ? schema : schema.optional()).meta(meta)
}

/** Ошибки примера: путь от поля example определения — как его покажет форма примера */
export function exampleIssues(draft: Pick<CustomBlockDraft, 'fields' | 'example'>) {
  const result = customBlockProps(draft.fields).safeParse(draft.example)
  return (result.error?.issues ?? []).map((issue) => ({
    path: ['example', ...issue.path.map(String)].join('.'),
    message: issue.message,
  }))
}

/** Пример после схемы: значения по умолчанию подставлены. null — пример не проходит */
export function parsedExample(draft: Pick<CustomBlockDraft, 'fields' | 'example'>) {
  const result = customBlockProps(draft.fields).safeParse(draft.example)
  return result.success ? result.data : null
}

/** Блок на странице: поля — объект, их проверяет определение блока (applyCustomBlocks) */
export const CustomBlockInstance = z.strictObject({
  id: BlockId,
  type: CustomBlockType,
  props: z.record(z.string(), z.unknown()),
})
export type CustomBlockInstance = z.infer<typeof CustomBlockInstance>

/**
 * Блок страницы: встроенный или свой. JSON Schema — обычный anyOf, но разбор идёт по типу:
 * custom:… — схемой своего блока, иначе — встроенных. Простое объединение при ошибке в полях
 * встроенного блока отдало бы «не подошёл ни один вариант», а не ошибку у поля, и редактор с MCP
 * потеряли бы путь до поля. Разбор заменён у этого экземпляра: методы схемы (.meta, .optional)
 * делают копию без замены, поэтому их у PageBlock не вызываем
 */
export const PageBlock = routedByType(z.union([BlockInstance, CustomBlockInstance]))
export type PageBlock = z.infer<typeof PageBlock>

function routedByType<
  Schema extends z.ZodUnion<[typeof BlockInstance, typeof CustomBlockInstance]>,
>(schema: Schema) {
  const route: typeof schema._zod.parse = (payload, ctx) => {
    const value = payload.value
    const type =
      typeof value === 'object' && value !== null ? (value as { type?: unknown }).type : undefined
    const target =
      typeof type === 'string' && isCustomBlockType(type) ? CustomBlockInstance : BlockInstance
    return target._zod.run(payload, ctx)
  }
  // У схемы без проверок run — тот же parse, взятый при создании: меняем оба
  schema._zod.parse = route
  schema._zod.run = route
  return schema
}

/** Опубликованное определение — то, что нужно странице: поля для проверки, ключ, название */
export type CustomBlockFieldsSource = Pick<CustomBlockDraft, 'key' | 'title' | 'fields'>

type IssuePath = (string | number)[]

/**
 * Проверка своих блоков страницы по опубликованным определениям. Встроенные блоки и всё
 * остальное уже проверила PageContent. Возвращает страницу с данными своих блоков после схемы
 * (умолчания подставлены) и ошибки с путём от страницы: blocks.2.props.plans.0.title
 */
export function applyCustomBlocks<Content extends { blocks: readonly PageBlock[] }>(
  content: Content,
  definitions: readonly CustomBlockFieldsSource[],
): { content: Content; issues: { path: IssuePath; message: string }[] } {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]))
  const issues: { path: IssuePath; message: string }[] = []
  const checked = content.blocks.map((block, index) => {
    if (!isCustomBlockType(block.type)) return block
    const key = customBlockKeyOf(block.type)
    const definition = byKey.get(key)
    if (!definition) {
      issues.push({
        path: ['blocks', index, 'type'],
        message: `Своего блока «${key}» нет на сайте: его не опубликовали или удалили. Уберите блок со страницы`,
      })
      return block
    }
    const result = customBlockProps(definition.fields).safeParse(block.props)
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push({
          path: ['blocks', index, 'props', ...issue.path.map((part) => part as string | number)],
          message: issue.message,
        })
      }
      return block
    }
    return { ...block, props: result.data }
  })
  return { content: { ...content, blocks: checked }, issues }
}

/** Ключи своих блоков на странице */
export const customBlockKeysOf = (content: { blocks: readonly { type: string }[] }) => [
  ...new Set(
    content.blocks.flatMap((block) =>
      isCustomBlockType(block.type) ? [customBlockKeyOf(block.type)] : [],
    ),
  ),
]

/** Формат файла переноса своих блоков между установками */
export const CUSTOM_BLOCKS_FILE_FORMAT = 'averra.custom-blocks'

/** Ключи блоков в файле не повторяются: решение о конфликте берётся на ключ, а не на блок */
const uniqueKeys = (blocks: readonly { key: string }[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>()
  blocks.forEach((block, index) => {
    if (seen.has(block.key)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'key'],
        message: `Ключ «${block.key}» повторяется в файле: у каждого блока свой ключ`,
      })
    }
    seen.add(block.key)
  })
}

/** Файл переноса: черновики определений. Загружаются черновиками — публикует человек */
export const CustomBlocksFile = z.object({
  format: z.literal(CUSTOM_BLOCKS_FILE_FORMAT, 'Это не файл своих блоков Averra'),
  version: z.literal(1, 'Файл другой версии: обновите установку'),
  exportedAt: z.string().optional(),
  blocks: z.array(CustomBlockDraft).min(1).max(200).superRefine(uniqueKeys),
})
export type CustomBlocksFile = z.infer<typeof CustomBlocksFile>

/** Что сделать с блоком из файла, если ключ уже занят */
export const ImportResolution = z.union([
  z.literal('replace'),
  z.literal('skip'),
  z.strictObject({ rename: CustomBlockKey }),
])
export type ImportResolution = z.infer<typeof ImportResolution>

/** Загрузка файла: блоки и решение на каждый занятый ключ */
export const CustomBlocksImport = z.strictObject({
  blocks: z.array(CustomBlockDraft).min(1).max(200).superRefine(uniqueKeys),
  resolutions: z.record(z.string(), ImportResolution).default({}),
})
export type CustomBlocksImport = z.infer<typeof CustomBlocksImport>

/** Что присылают, чтобы создать свой блок: ключ и название, остальное — заготовка */
export const NewCustomBlock = z.strictObject({
  key: CustomBlockKey,
  title: z.string().trim().min(1).max(60),
})

/**
 * Публикация своего блока: черновик, который человек видел. Черновик пишет и токен MCP — если он
 * поменялся с тех пор, публикация отказывает, чтобы на сайт не ушёл код, которого никто не читал
 */
export const CustomBlockPublish = z.strictObject({ draft: CustomBlockDraft })
export type CustomBlockPublish = z.infer<typeof CustomBlockPublish>

/** Заготовка нового блока: заголовок и текст, шаблон и CSS на переменных темы */
export function starterCustomBlock(key: string, title: string): CustomBlockDraft {
  return CustomBlockDraft.parse({
    key,
    title,
    description: 'Опишите одной фразой, чем блок полезен',
    category: 'about',
    fields: [
      { type: 'text', name: 'title', label: 'Заголовок', required: true, maxLength: 120 },
      { type: 'textarea', name: 'text', label: 'Текст', maxLength: 1000 },
    ],
    template: [
      '<div class="box">',
      '  <h2 class="title">{{ title }}</h2>',
      '  {% if text %}<div class="text">{{ text | paragraphs }}</div>{% endif %}',
      '</div>',
      '',
    ].join('\n'),
    css: [
      '.box {',
      '  display: grid;',
      '  gap: var(--space-4);',
      '}',
      '',
      '.title {',
      '  font-family: var(--font-heading);',
      '  font-size: var(--text-2xl);',
      '}',
      '',
    ].join('\n'),
    example: { title: title, text: '[Текст блока]' },
  })
}

/** Раздел каталога «Свои» в «Добавить блок»: в нём все свои блоки */
export const CUSTOM_CATALOG_SECTION = 'Свои'
