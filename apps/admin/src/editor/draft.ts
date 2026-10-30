import { customBlockKeyOf, isCustomBlockType } from '@averra/schema'
import { type CatalogEntry, catalog, catalogEntry } from './catalog'

/**
 * Блок в редакторе: поля как есть, пока без гарантий. Проверяет их схема при каждом изменении.
 * Тип — встроенного блока (hero) или своего (custom:tariffs)
 */
export type EditorBlock = { id: string; type: string; props: Record<string, unknown> }

/**
 * Новый блок с примером содержимого. Id читаемый и годится как якорь: hero-2, cta-3; у своего
 * блока — по ключу: tariffs-1
 */
export function createBlock(
  type: string,
  existing: readonly EditorBlock[],
  entries: readonly CatalogEntry[] = catalog,
): EditorBlock {
  const taken = new Set(existing.map((block) => block.id))
  const base = isCustomBlockType(type) ? customBlockKeyOf(type) : type
  let n = 1
  while (taken.has(`${base}-${n}`)) n += 1
  const example = catalogEntry(type, entries).example
  return { id: `${base}-${n}`, type, props: structuredClone(example) as Record<string, unknown> }
}

/** Вставка после блока afterId. Без него или если блок не найден — в конец */
export function insertBlock(list: readonly EditorBlock[], block: EditorBlock, afterId?: string) {
  const index = list.findIndex((candidate) => candidate.id === afterId)
  return index === -1 ? [...list, block] : list.toSpliced(index + 1, 0, block)
}

export function removeBlock(list: readonly EditorBlock[], id: string) {
  return list.filter((block) => block.id !== id)
}

export function updateBlockProps(
  list: readonly EditorBlock[],
  id: string,
  props: Record<string, unknown>,
) {
  return list.map((block) => (block.id === id ? { ...block, props } : block))
}
