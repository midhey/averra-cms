import { describe, expect, it } from 'vitest'
import { formatDateTime, pagePath, pageState } from './pages-format'

describe('состояние страницы в списке', () => {
  it('никогда не публиковалась', () => {
    expect(pageState({ publishedAt: null, hasUnpublishedChanges: true })).toBe('Не опубликована')
  })

  it('опубликована, черновик совпадает', () => {
    const page = { publishedAt: '2026-10-12T07:30:00.000Z', hasUnpublishedChanges: false }
    expect(pageState(page)).toBe('Опубликована')
  })

  it('опубликована, но черновик с тех пор менялся', () => {
    const page = { publishedAt: '2026-10-12T07:30:00.000Z', hasUnpublishedChanges: true }
    expect(pageState(page)).toBe('Есть неопубликованные изменения')
  })
})

describe('адрес и дата', () => {
  it('главная открывается по корню, остальные по своему адресу', () => {
    expect(pagePath('index')).toBe('/')
    expect(pagePath('o-nas')).toBe('/o-nas')
  })

  it('дата публикации по-русски, в часовом поясе человека', () => {
    const text = formatDateTime('2026-10-12T07:30:00.000Z', 'Europe/Moscow')
    expect(text).toContain('2026')
    expect(text).toContain('окт')
    expect(text).toContain('10:30')
  })
})
