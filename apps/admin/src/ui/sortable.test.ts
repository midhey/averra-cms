import type { Active, Over } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'
import { dragAnnouncements, dragInstructions, moveItem } from './sortable'

describe('moveItem', () => {
  const list = ['a', 'b', 'c', 'd']

  it('переносит элемент вперёд и назад', () => {
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })

  it('на то же место и за край возвращает тот же список', () => {
    expect(moveItem(list, 1, 1)).toBe(list)
    expect(moveItem(list, 0, -1)).toBe(list)
    expect(moveItem(list, 3, 4)).toBe(list)
    expect(moveItem(list, 4, 0)).toBe(list)
  })
})

// dnd-kit передаёт в объявления целые объекты, тексты берут из них только id
const active = (id: string) => ({ id }) as Active
const over = (id: string) => ({ id }) as Over

describe('объявления перетаскивания', () => {
  const blocks = dragAnnouncements(
    [
      { id: 'hero-1', label: 'Ремонт под ключ' },
      { id: 'features-1', label: 'Почему мы' },
      { id: 'cta-1', label: 'Звоните' },
    ],
    'блок',
  )

  it('называют блок по имени и позицию «N из M»', () => {
    expect(blocks.onDragStart({ active: active('features-1') })).toBe(
      'Блок «Почему мы» поднят. Позиция 2 из 3.',
    )
    expect(blocks.onDragOver({ active: active('features-1'), over: over('cta-1') })).toBe(
      'Блок «Почему мы» на позиции 3 из 3.',
    )
    expect(blocks.onDragEnd({ active: active('features-1'), over: over('hero-1') })).toBe(
      'Блок «Почему мы» поставлен на позицию 1 из 3.',
    )
  })

  it('не перебивают «поднят» и не повторяют ту же позицию', () => {
    const fresh = dragAnnouncements(
      [
        { id: 'a', label: 'А' },
        { id: 'b', label: 'Б' },
      ],
      'блок',
    )
    fresh.onDragStart({ active: active('a') })
    // dnd-kit сразу после подъёма сообщает «над собой»: молчим, пусть диктор дочитает
    expect(fresh.onDragOver({ active: active('a'), over: over('a') })).toBeUndefined()
    expect(fresh.onDragOver({ active: active('a'), over: over('b') })).toBe(
      'Блок «А» на позиции 2 из 2.',
    )
    expect(fresh.onDragOver({ active: active('a'), over: over('b') })).toBeUndefined()
    // Вернулся на своё место — это смена позиции, о ней говорим
    expect(fresh.onDragOver({ active: active('a'), over: over('a') })).toBe(
      'Блок «А» на позиции 1 из 2.',
    )
  })

  it('отпущенный вне списка и отменённый блок остаются на месте', () => {
    expect(blocks.onDragOver({ active: active('cta-1'), over: null })).toBe(
      'Блок «Звоните» вне списка.',
    )
    expect(blocks.onDragEnd({ active: active('cta-1'), over: null })).toBe(
      'Блок «Звоните» остался на позиции 3 из 3.',
    )
    expect(blocks.onDragCancel({ active: active('hero-1'), over: over('cta-1') })).toBe(
      'Перетаскивание отменено. Блок «Ремонт под ключ» остался на позиции 1 из 3.',
    )
  })

  it('говорят о пунктах, если переставляют пункты', () => {
    const items = dragAnnouncements([{ id: 'k1', label: '№ 1' }], 'пункт')
    expect(items.onDragStart({ active: active('k1') })).toBe('Пункт «№ 1» поднят. Позиция 1 из 1.')
  })

  it('подсказка объясняет клавиши по-русски', () => {
    const text = dragInstructions('блок')
    expect(text).toContain('переставить блок')
    for (const key of ['пробел', 'Enter', 'стрелками', 'Escape']) expect(text).toContain(key)
  })
})
