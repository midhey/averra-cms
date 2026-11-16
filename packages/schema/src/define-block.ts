import { z } from 'zod'

/** Id экземпляра блока на странице: по нему редактор находит и переставляет блоки */
export const BlockId = z
  .string()
  .regex(/^[\w-]{1,64}$/, 'Id блока: латиница, цифры, _ и -, не длиннее 64 символов')

/** Нет флажка — блок виден: старые страницы сохраняют прежний вид */
export const BlockHidden = z.boolean().optional().meta({
  title: 'Скрыть на сайте',
  description: 'Блок остаётся в черновике и истории; на сайте исчезнет после публикации',
})

/** Блоки для сайта и предпросмотра; исходный черновик остаётся целиком */
export const visibleBlocks = <B extends { hidden?: boolean | undefined }>(blocks: readonly B[]) =>
  blocks.filter((block) => block.hidden !== true)

/**
 * Разделы каталога «Добавить блок»: в каком месте страницы и для чего блок. Ключ — для схемы и
 * MCP, подпись — для людей. Порядок — как на странице: сверху вниз
 */
export const BLOCK_CATEGORIES = {
  start: 'Начало страницы',
  about: 'О компании',
  sales: 'Продажа',
  trust: 'Доверие',
  contact: 'Связь',
} as const
export type BlockCategory = keyof typeof BLOCK_CATEGORIES

/**
 * Описание блока. Схема props — единственный источник правды о блоке:
 * из неё получаются проверка в API, TS-типы, формы в админке и JSON Schema для MCP
 */
export function defineBlock<const Type extends string, Props extends z.ZodObject>(definition: {
  type: Type
  title: string
  /** Чем блок полезен, одной фразой: её видят каталог в редакторе и нейронка в MCP */
  description: string
  /** Раздел каталога: по нему блок находят в редакторе, а нейронка — его место на странице */
  category: BlockCategory
  props: Props
  /** Пример заполнения: с ним блок появляется в редакторе, его же видит нейронка в каталоге */
  example: z.input<Props>
}) {
  return {
    ...definition,
    /** Блок, поставленный на страницу: { id, type, props, hidden? } */
    instance: z.strictObject({
      id: BlockId,
      hidden: BlockHidden,
      type: z.literal(definition.type),
      props: definition.props,
    }),
  }
}

/**
 * Миниатюры вариантов оформления для редактора (пометка x-enum-sketches в .meta() перечисления):
 * значение → какой рисунок показать на карточке варианта. Набор рисунков — у админки, поэтому
 * здесь только их имена
 */
export const ENUM_SKETCHES = [
  'centered',
  'left',
  'split',
  'cover',
  'image-left',
  'image-right',
] as const
export type EnumSketch = (typeof ENUM_SKETCHES)[number]
