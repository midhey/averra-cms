import type { BlockType } from '@averra/schema'
import { catalogEntry } from './catalog'

/** Блок в редакторе: поля как есть, пока без гарантий. Проверяет их схема при каждом изменении */
export type EditorBlock = { id: string; type: BlockType; props: Record<string, unknown> }

/** Новый блок с примером содержимого. Id читаемый и годится как якорь: hero-2, cta-3 */
export function createBlock(type: BlockType, existing: readonly EditorBlock[]): EditorBlock {
  const taken = new Set(existing.map((block) => block.id))
  let n = 1
  while (taken.has(`${type}-${n}`)) n += 1
  return { id: `${type}-${n}`, type, props: structuredClone(catalogEntry(type).example) }
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
