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
