import { describe, expect, it } from 'vitest'
import { getIn, setIn } from './path'

describe('setIn', () => {
  it('меняет вложенное значение и не трогает исходный объект', () => {
    const value = { items: [{ title: 'А' }, { title: 'Б' }] }
    const next = setIn(value, ['items', 1, 'title'], 'В')
    expect(next).toEqual({ items: [{ title: 'А' }, { title: 'В' }] })
    expect(value.items[1]?.title).toBe('Б')
  })

  it('убирает поле, если значение undefined', () => {
    expect(setIn({ title: 'А', subtitle: 'Б' }, ['subtitle'], undefined)).toEqual({ title: 'А' })
  })

  it('создаёт недостающие объекты по пути', () => {
    expect(setIn({}, ['button', 'label'], 'Жми')).toEqual({ button: { label: 'Жми' } })
  })
})

describe('getIn', () => {
  it('достаёт значение по пути и не падает на пустых местах', () => {
    const value = { items: [{ title: 'А' }] }
    expect(getIn(value, ['items', 0, 'title'])).toBe('А')
    expect(getIn(value, ['items', 5, 'title'])).toBeUndefined()
    expect(getIn(value, ['button', 'href'])).toBeUndefined()
  })
})
