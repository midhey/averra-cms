import { describe, expect, it } from 'vitest'
import {
  filterPages,
  formatDateTime,
  pageNote,
  pagePath,
  pageState,
  pagesSummary,
  pagesWithChanges,
} from './pages-format'

const at = '2026-10-12T07:30:00.000Z'

describe('состояние страницы в списке', () => {
  it('никогда не публиковалась — черновик', () => {
    expect(pageState({ publishedAt: null, hasUnpublishedChanges: true })).toEqual({
      label: 'Черновик',
      tone: 'neutral',
    })
  })

  it('опубликована, черновик совпадает', () => {
    expect(pageState({ publishedAt: at, hasUnpublishedChanges: false })).toEqual({
      label: 'Опубликована',
      tone: 'success',
    })
  })

  it('опубликована, но черновик с тех пор менялся', () => {
    expect(pageState({ publishedAt: at, hasUnpublishedChanges: true })).toEqual({
      label: 'Есть правки',
      tone: 'warning',
    })
  })
})

describe('«Опубликовать правки» и сводка', () => {
  const pages = [
    { slug: 'index', title: 'Главная', publishedAt: at, hasUnpublishedChanges: true },
    { slug: 'ceny', title: 'Цены', publishedAt: at, hasUnpublishedChanges: false },
    { slug: 'novaya', title: 'Новая', publishedAt: null, hasUnpublishedChanges: true },
  ]

  it('публикует только опубликованные страницы с правками, новый черновик не трогает', () => {
    expect(pagesWithChanges(pages).map((page) => page.slug)).toEqual(['index'])
  })

  it('сводка: сколько опубликовано и сколько черновиков', () => {
    expect(pagesSummary(pages)).toBe('2 опубликованы, 1 черновик')
    expect(pagesSummary(pages.slice(0, 1))).toBe('1 опубликована')
    expect(pagesSummary([])).toBe('Страниц нет')
  })

  it('сводка склоняет «опубликована» по числу: 21, 5, 3, 11', () => {
    const published = (count: number) =>
      Array.from({ length: count }, () => ({ publishedAt: at, hasUnpublishedChanges: false }))
    expect(pagesSummary(published(21))).toBe('21 опубликована')
    expect(pagesSummary(published(5))).toBe('5 опубликовано')
    expect(pagesSummary(published(3))).toBe('3 опубликованы')
    expect(pagesSummary(published(11))).toBe('11 опубликовано')
  })

  it('поиск — по заголовку и адресу, без регистра и «ё»', () => {
    const list = [...pages, { slug: 'otzyvy', title: 'Отзывы клиентов', publishedAt: null }]
    expect(filterPages(list, 'отзЫв').map((page) => page.slug)).toEqual(['otzyvy'])
    expect(filterPages(list, '/ceny').map((page) => page.slug)).toEqual(['ceny'])
    expect(filterPages([{ slug: 'e', title: 'Ёлка' }], 'елка')).toHaveLength(1)
    expect(filterPages(list, '  ')).toHaveLength(list.length)
  })
})

describe('адрес и дата', () => {
  it('главная открывается по корню, остальные по своему адресу', () => {
    expect(pagePath('index')).toBe('/')
    expect(pagePath('o-nas')).toBe('/o-nas')
  })

  it('служебная страница 404 помечена в списке, обычные — нет', () => {
    expect(pageNote('404')).toBe('на адресах, где страницы нет')
    expect(pageNote('o-nas')).toBeUndefined()
  })

  it('дата публикации по-русски, в часовом поясе человека', () => {
    const text = formatDateTime(at, 'Europe/Moscow')
    expect(text).toContain('2026')
    expect(text).toContain('окт')
    expect(text).toContain('10:30')
  })
})
