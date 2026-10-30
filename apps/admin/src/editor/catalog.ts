import {
  BLOCK_CATEGORIES,
  type BlockCategory,
  type BlockType,
  blocks,
  CUSTOM_CATALOG_SECTION,
  type CustomBlockDraft,
  customBlockProps,
  customBlockType,
} from '@averra/schema'
import { z } from 'zod'
import type { JsonSchema } from '../forms/json-schema'

/**
 * Блоки с пометкой «новый» в каталоге — десять блоков лендинга из двух шагов, как в концепте
 * каталога. Это вид, а не данные блока: список правят руками, когда блоки перестают быть новостью
 */
const NEW_BLOCKS: ReadonlySet<BlockType> = new Set([
  'text-image',
  'stats',
  'steps',
  'pricing',
  'gallery',
  'reviews',
  'clients',
  'team',
  'faq',
  'contacts',
])

/** Блок в каталоге редактора: встроенный или свой блок сайта */
export type CatalogEntry = {
  /** Тип на странице: hero, custom:tariffs */
  type: string
  title: string
  description: string
  category: BlockCategory
  isNew: boolean
  /** Свой блок сайта: в разделе «Свои» каталога */
  custom: boolean
  /** Набросок встроенного блока. У своего — выбранный «как у», без него — общий набросок */
  sketch: BlockType | undefined
  example: unknown
  schema: JsonSchema
}

/** Каталог для редактора: название, описание, раздел, пример и JSON Schema полей каждого блока */
export const catalog: readonly CatalogEntry[] = blocks.map((block) => ({
  type: block.type,
  title: block.title,
  description: block.description,
  category: block.category,
  isNew: NEW_BLOCKS.has(block.type),
  custom: false,
  sketch: block.type,
  example: block.example,
  schema: z.toJSONSchema(block.props, { io: 'input' }) as JsonSchema,
}))

/**
 * Свои блоки сайта в каталоге — по опубликованным определениям. Схема полей строится той же
 * функцией, что в API (customBlockProps): форма в редакторе проверяет то же, что сохранение
 */
export const customCatalog = (definitions: readonly CustomBlockDraft[]): CatalogEntry[] =>
  definitions.map((definition) => ({
    type: customBlockType(definition.key),
    title: definition.title,
    description: definition.description,
    category: definition.category,
    isNew: false,
    custom: true,
    sketch: definition.sketch,
    example: definition.example,
    schema: z.toJSONSchema(customBlockProps(definition.fields), { io: 'input' }) as JsonSchema,
  }))

/** Блок каталога по типу. Нет (свой блок не опубликован или удалён) — undefined */
export const findEntry = (type: string, entries: readonly CatalogEntry[] = catalog) =>
  entries.find((candidate) => candidate.type === type)

export function catalogEntry(type: string, entries: readonly CatalogEntry[] = catalog) {
  const entry = findEntry(type, entries)
  if (!entry) throw new Error(`Блока «${type}» нет в каталоге`)
  return entry
}

/** Название блока для списка. Свой блок без опубликованного определения — его тип */
export const entryTitle = (type: string, entries: readonly CatalogEntry[] = catalog) =>
  findEntry(type, entries)?.title ?? type

/** Раздел каталога, «Все» или «Свои» — свои блоки сайта */
export type CatalogSection = BlockCategory | 'all' | 'custom'

/** Разделы для фильтра: «Все» и разделы схемы по порядку страницы */
export const catalogSections = [
  'all',
  ...(Object.keys(BLOCK_CATEGORIES) as BlockCategory[]),
] as const satisfies readonly CatalogSection[]

/** Разделы каталога с этими блоками: «Свои» — в конце, когда свои блоки есть */
export const sectionsFor = (entries: readonly CatalogEntry[]): readonly CatalogSection[] =>
  entries.some((entry) => entry.custom) ? [...catalogSections, 'custom'] : catalogSections

export const sectionTitle = (section: CatalogSection) =>
  section === 'all'
    ? 'Все'
    : section === 'custom'
      ? CUSTOM_CATALOG_SECTION
      : BLOCK_CATEGORIES[section]

/** Для поиска: без регистра, «ё» как «е», лишние пробелы не мешают */
const normalize = (text: string) => text.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ')

/**
 * Блоки раздела, подходящие под поиск. Ищем по названию и описанию: каждое слово запроса должно
 * встретиться — «цены тариф» найдёт «Услуги и цены». В «Своих» — только свои блоки, в разделах
 * схемы — и встроенные, и свои этого раздела
 */
export function filterCatalog(
  entries: readonly CatalogEntry[],
  section: CatalogSection,
  query: string,
) {
  const words = normalize(query).trim().split(' ').filter(Boolean)
  return entries.filter((entry) => {
    if (section === 'custom' && !entry.custom) return false
    if (section !== 'all' && section !== 'custom' && entry.category !== section) return false
    const text = normalize(`${entry.title} ${entry.description}`)
    return words.every((word) => text.includes(word))
  })
}
