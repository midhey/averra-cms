import { countRu } from '../format/plural'
import type { EditorBlock } from './draft'

/** Имя блока для диктора и вопросов: его заголовок, если он есть, иначе якорь */
export function blockName(block: EditorBlock) {
  const title = block.props.title
  return typeof title === 'string' && title.trim() !== '' ? title : `#${block.id}`
}

/**
 * Краткая подсказка содержимого под типом блока в списке: заголовок; без заголовка — сколько
 * в блоке пунктов или полей формы; иначе якорь, чтобы одинаковые блоки различались
 */
export function blockHint(block: EditorBlock) {
  const title = block.props.title
  if (typeof title === 'string' && title.trim() !== '') return title
  const { items, fields } = block.props
  if (Array.isArray(items) && items.length > 0) {
    return countRu(items.length, ['пункт', 'пункта', 'пунктов'])
  }
  if (Array.isArray(fields) && fields.length > 0) {
    return countRu(fields.length, ['поле формы', 'поля формы', 'полей формы'])
  }
  return `#${block.id}`
}
