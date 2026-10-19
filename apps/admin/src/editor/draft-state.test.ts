import { describe, expect, it } from 'vitest'
import { draftState, type ServerPage, stableJson } from './draft-state'

const draft = {
  blocks: [{ id: 'hero', type: 'hero', props: { title: 'Ремонт', variant: 'left' } }],
}

const page = (overrides: Partial<ServerPage> = {}): ServerPage => ({
  title: 'Главная',
  draft,
  publishedTitle: 'Главная',
  published: draft,
  publishedAt: '2026-10-12T10:30:00.000Z',
  ...overrides,
})

describe('stableJson', () => {
  it('другой порядок ключей — та же строка', () => {
    expect(stableJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      stableJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
    )
  })

  it('порядок в массиве важен', () => {
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]))
  })
})

describe('draftState', () => {
  it('несохранённые правки — главнее всего', () => {
    expect(draftState(true, page())).toEqual({
      label: 'Есть несохранённые правки',
      tone: 'warning',
    })
  })

  it('страницу не публиковали', () => {
    expect(
      draftState(false, page({ publishedAt: null, published: null, publishedTitle: null })),
    ).toEqual({ label: 'Черновик сохранён · не опубликован', tone: 'warning' })
  })

  it('на сайте то же, что в черновике, — «Опубликовано», даже с другим порядком ключей', () => {
    const reordered = {
      blocks: [{ props: { variant: 'left', title: 'Ремонт' }, type: 'hero', id: 'hero' }],
    }
    expect(draftState(false, page({ published: reordered }))).toEqual({
      label: 'Опубликовано',
      tone: 'success',
    })
  })

  it('черновик новее сайта', () => {
    const changed = { blocks: [{ ...draft.blocks[0], props: { title: 'Другой' } }] }
    expect(draftState(false, page({ draft: changed })).label).toBe(
      'Сохранено · правки не опубликованы',
    )
  })

  it('изменён только заголовок страницы — тоже не опубликовано', () => {
    expect(draftState(false, page({ title: 'Новое название' })).label).toBe(
      'Сохранено · правки не опубликованы',
    )
  })
})
