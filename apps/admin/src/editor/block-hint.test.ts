import { describe, expect, it } from 'vitest'
import { blockHint, blockName } from './block-hint'
import type { EditorBlock } from './draft'

const block = (props: Record<string, unknown>, type: EditorBlock['type'] = 'features') => ({
  id: `${type}-1`,
  type,
  props,
})

describe('blockHint', () => {
  it('заголовок блока', () => {
    expect(blockHint(block({ title: 'Почему мы', items: [{}] }))).toBe('Почему мы')
  })

  it('без заголовка — число пунктов со склонением', () => {
    expect(blockHint(block({ items: [{}] }))).toBe('1 пункт')
    expect(blockHint(block({ items: [{}, {}, {}] }))).toBe('3 пункта')
    expect(blockHint(block({ items: Array.from({ length: 5 }, () => ({})) }))).toBe('5 пунктов')
  })

  it('без заголовка у формы — число полей', () => {
    expect(blockHint(block({ title: ' ', fields: [{}, {}] }, 'form'))).toBe('2 поля формы')
  })

  it('без заголовка у цен — число тарифов', () => {
    expect(blockHint(block({ plans: [{}, {}, {}] }, 'pricing'))).toBe('3 тарифа')
  })

  it('у работ, отзывов, клиентов и команды — свои слова', () => {
    expect(blockHint(block({ items: [{}, {}, {}] }, 'gallery'))).toBe('3 фото')
    expect(blockHint(block({ items: [{}, {}] }, 'reviews'))).toBe('2 отзыва')
    expect(blockHint(block({ items: Array(5).fill({}) }, 'clients'))).toBe('5 клиентов')
    expect(blockHint(block({ members: [{}, {}] }, 'team'))).toBe('2 человека')
  })

  it('у контактов без заголовка — телефон, иначе адрес', () => {
    expect(blockHint(block({ phone: '+7 900 000-00-00', address: 'Пермь' }, 'contacts'))).toBe(
      '+7 900 000-00-00',
    )
    expect(blockHint(block({ address: 'Пермь' }, 'contacts'))).toBe('Пермь')
    expect(blockHint(block({}, 'contacts'))).toBe('#contacts-1')
  })

  it('пусто — якорь, чтобы одинаковые блоки различались', () => {
    expect(blockHint(block({ items: [] }))).toBe('#features-1')
  })
})

describe('blockName', () => {
  it('заголовок или якорь', () => {
    expect(blockName(block({ title: 'Почему мы' }))).toBe('Почему мы')
    expect(blockName(block({ items: [{}] }))).toBe('#features-1')
  })
})
