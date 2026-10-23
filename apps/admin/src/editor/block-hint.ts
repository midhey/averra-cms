import type { BlockType } from '@averra/schema'
import { countRu } from '../format/plural'
import type { EditorBlock } from './draft'

/** Имя блока для диктора и вопросов: его заголовок, если он есть, иначе якорь */
export function blockName(block: EditorBlock) {
  const title = block.props.title
  return typeof title === 'string' && title.trim() !== '' ? title : `#${block.id}`
}

type Forms = readonly [string, string, string]

/** Как называются пункты блока в подсказке: «6 фото», «2 отзыва». Остальные — «пункты» */
const itemNouns: Partial<Record<BlockType, Forms>> = {
  gallery: ['фото', 'фото', 'фото'],
  reviews: ['отзыв', 'отзыва', 'отзывов'],
  clients: ['клиент', 'клиента', 'клиентов'],
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : '')

/**
 * Краткая подсказка содержимого под типом блока в списке: заголовок; без заголовка — сколько
 * в блоке пунктов, тарифов, людей или полей формы, у контактов — телефон или адрес; иначе якорь,
 * чтобы одинаковые блоки различались
 */
export function blockHint(block: EditorBlock) {
  const title = text(block.props.title)
  if (title) return title
  const { items, fields, plans, members } = block.props
  if (Array.isArray(items) && items.length > 0) {
    return countRu(items.length, itemNouns[block.type] ?? ['пункт', 'пункта', 'пунктов'])
  }
  if (Array.isArray(plans) && plans.length > 0) {
    return countRu(plans.length, ['тариф', 'тарифа', 'тарифов'])
  }
  if (Array.isArray(members) && members.length > 0) {
    return countRu(members.length, ['человек', 'человека', 'человек'])
  }
  if (Array.isArray(fields) && fields.length > 0) {
    return countRu(fields.length, ['поле формы', 'поля формы', 'полей формы'])
  }
  const contact = text(block.props.phone) || text(block.props.address)
  if (block.type === 'contacts' && contact) return contact
  return `#${block.id}`
}
