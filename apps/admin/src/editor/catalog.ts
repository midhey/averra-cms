import { BLOCK_CATEGORIES, type BlockCategory, type BlockType, blocks } from '@averra/schema'
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

/** Каталог для редактора: название, описание, раздел, пример и JSON Schema полей каждого блока */
export const catalog = blocks.map((block) => ({
  type: block.type,
  title: block.title,
  description: block.description,
  category: block.category,
  isNew: NEW_BLOCKS.has(block.type),
  example: block.example,
  schema: z.toJSONSchema(block.props, { io: 'input' }) as JsonSchema,
}))
export type CatalogEntry = (typeof catalog)[number]

export function catalogEntry(type: BlockType) {
  const entry = catalog.find((candidate) => candidate.type === type)
  if (!entry) throw new Error(`Блока «${type}» нет в каталоге`)
  return entry
}

/** Раздел каталога или «Все» */
export type CatalogSection = BlockCategory | 'all'

/** Разделы для фильтра: «Все» и разделы схемы по порядку страницы */
export const catalogSections = [
  'all',
  ...(Object.keys(BLOCK_CATEGORIES) as BlockCategory[]),
] as const satisfies readonly CatalogSection[]

export const sectionTitle = (section: CatalogSection) =>
  section === 'all' ? 'Все' : BLOCK_CATEGORIES[section]

/** Для поиска: без регистра, «ё» как «е», лишние пробелы не мешают */
const normalize = (text: string) => text.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ')

/**
 * Блоки раздела, подходящие под поиск. Ищем по названию и описанию: каждое слово запроса должно
 * встретиться — «цены тариф» найдёт «Услуги и цены»
 */
export function filterCatalog(
  entries: readonly CatalogEntry[],
  section: CatalogSection,
  query: string,
) {
  const words = normalize(query).trim().split(' ').filter(Boolean)
  return entries.filter((entry) => {
    if (section !== 'all' && entry.category !== section) return false
    const text = normalize(`${entry.title} ${entry.description}`)
    return words.every((word) => text.includes(word))
  })
}
