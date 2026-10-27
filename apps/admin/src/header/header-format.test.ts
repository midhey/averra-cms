import type { HeaderTargetPage } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import {
  headerStatus,
  hiddenOnText,
  linkOf,
  menuItemName,
  newHeaderButton,
  overlayHint,
  targetGroups,
  targetValue,
} from './header-format'

const page = (overrides: Partial<HeaderTargetPage>): HeaderTargetPage => ({
  slug: 'index',
  title: 'Ремонт',
  published: true,
  hideHeader: false,
  hideFooter: false,
  overlay: false,
  blocks: [],
  ...overrides,
})

const pages = [
  page({
    blocks: [
      { id: 'hero', type: 'hero', label: 'Ремонт под ключ', draft: true, published: true },
      { id: 'form-1', type: 'form', label: null, draft: true, published: false },
    ],
  }),
  page({ slug: 'akcii', title: 'Акции', published: false }),
]

describe('цель пункта меню', () => {
  it('значение выбора — страница или страница#блок, и обратно', () => {
    expect(targetValue({ page: 'index' })).toBe('index')
    expect(targetValue({ page: 'index', block: 'hero' })).toBe('index#hero')
    expect(linkOf('index#hero')).toEqual({ page: 'index', block: 'hero' })
    expect(linkOf('akcii')).toEqual({ page: 'akcii' })
  })

  it('группы по страницам: вся страница и блоки; неопубликованная — с пометкой', () => {
    expect(targetGroups(pages)).toEqual([
      {
        label: 'Главная (Ремонт)',
        options: [
          { value: 'index', label: 'Ремонт — вся страница' },
          { value: 'index#hero', label: 'Ремонт под ключ · #hero' },
          { value: 'index#form-1', label: 'Блок · #form-1' },
        ],
      },
      {
        label: 'Акции — не опубликована',
        options: [{ value: 'akcii', label: 'Акции — вся страница' }],
      },
    ])
  })

  it('пропавшая цель остаётся в списке отдельной группой, а не подменяется другой', () => {
    const groups = targetGroups(pages, { page: 'blog', block: 'top' })
    expect(groups.at(-1)).toEqual({
      label: 'Больше нет на сайте',
      options: [{ value: 'blog#top', label: '/blog/#top' }],
    })
    expect(targetGroups(pages, { page: 'index', block: 'hero' })).toHaveLength(2)
  })
})

describe('подсказки экрана', () => {
  it('кнопка по умолчанию ведёт к форме главной, если она есть', () => {
    expect(newHeaderButton(pages)).toEqual({
      label: 'Оставить заявку',
      page: 'index',
      block: 'form-1',
    })
    expect(newHeaderButton([page({})])).toEqual({ label: 'Оставить заявку', page: 'index' })
  })

  it('прозрачная — где сработает', () => {
    expect(overlayHint(pages)).toMatch(/Ни одна опубликованная страница/)
    expect(overlayHint([page({ overlay: true })])).toBe(
      'Ложится на фото «Первого экрана» в варианте «На фото»: «Ремонт». На остальных страницах шапка обычная',
    )
  })

  it('где шапка скрыта', () => {
    expect(hiddenOnText(pages)).toBeUndefined()
    expect(hiddenOnText([page({ title: 'Промо', hideHeader: true })])).toBe(
      'Шапка скрыта на страницах: «Промо»',
    )
  })

  it('состояние: не сохранено, шапки ещё нет на сайте, не опубликовано, опубликована', () => {
    expect(headerStatus({ unsaved: true, unpublished: true, onSite: true }).text).toBe(
      'Не сохранено',
    )
    expect(headerStatus({ unsaved: false, unpublished: true, onSite: false }).text).toBe(
      'Шапки пока нет на сайте',
    )
    expect(headerStatus({ unsaved: false, unpublished: true, onSite: true }).text).toBe(
      'Сохранено · не опубликовано',
    )
    expect(headerStatus({ unsaved: false, unpublished: false, onSite: true }).tone).toBe('success')
  })

  it('имя пункта: подпись или номер', () => {
    expect(menuItemName({ label: ' Цены ', page: 'index' }, 0)).toBe('Цены')
    expect(menuItemName({ label: '', page: 'index' }, 2)).toBe('Пункт 3')
  })
})
