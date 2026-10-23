import { BLOCK_CATEGORIES } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import { catalog, catalogSections, filterCatalog, sectionTitle } from './catalog'

const types = (entries: readonly { type: string }[]) => entries.map((entry) => entry.type)

describe('каталог блоков', () => {
  it('порядок — как блоки идут на странице, новые помечены', () => {
    expect(types(catalog)).toEqual([
      'hero',
      'text-image',
      'features',
      'stats',
      'steps',
      'pricing',
      'faq',
      'cta',
      'form',
      'video',
      'text',
    ])
    expect(types(catalog.filter((entry) => entry.isNew))).toEqual([
      'text-image',
      'stats',
      'steps',
      'pricing',
      'faq',
    ])
  })

  it('разделы — «Все» и разделы схемы с подписями', () => {
    expect(catalogSections).toEqual(['all', ...Object.keys(BLOCK_CATEGORIES)])
    expect(catalogSections.map(sectionTitle)).toEqual([
      'Все',
      'Начало страницы',
      'О компании',
      'Продажа',
      'Доверие',
      'Связь',
    ])
  })
})

describe('filterCatalog', () => {
  it('раздел оставляет только свои блоки', () => {
    expect(types(filterCatalog(catalog, 'sales', ''))).toEqual(['steps', 'pricing', 'cta'])
    expect(types(filterCatalog(catalog, 'contact', ''))).toEqual(['form'])
    expect(filterCatalog(catalog, 'all', '')).toHaveLength(catalog.length)
  })

  it('поиск по названию и описанию, без регистра и «ё», все слова запроса', () => {
    expect(types(filterCatalog(catalog, 'all', 'ЦЕНЫ'))).toEqual(['pricing'])
    expect(types(filterCatalog(catalog, 'all', 'вопросы ответы'))).toEqual(['faq'])
    expect(types(filterCatalog(catalog, 'all', '  тарифы   карточками '))).toEqual(['pricing'])
    // «ё» в запросе находит «е» в тексте и наоборот
    const [stats] = catalog.filter((entry) => entry.type === 'stats')
    if (!stats) throw new Error('Нет «Цифр» в каталоге')
    const withYo = { ...stats, description: 'Ещё пара фактов' }
    expect(filterCatalog([withYo], 'all', 'еще')).toHaveLength(1)
    expect(filterCatalog([stats], 'all', 'объёктов')).toHaveLength(1)
  })

  it('поиск внутри раздела и пустой итог', () => {
    expect(types(filterCatalog(catalog, 'trust', 'картинк'))).toEqual([])
    expect(types(filterCatalog(catalog, 'about', 'картинк'))).toEqual(['text-image'])
    expect(filterCatalog(catalog, 'all', 'слайдер')).toEqual([])
  })
})
