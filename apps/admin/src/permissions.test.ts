import { describe, expect, it } from 'vitest'
import { canDeleteMedia, canManagePages, canPublish, safeRedirect } from './permissions'

describe('возврат после входа', () => {
  it.each([
    ['/sites/abc', '/sites/abc'],
    ['/sites/abc/pages/index?x=1#top', '/sites/abc/pages/index?x=1#top'],
    ['/', '/'],
  ])('адрес внутри админки %s сохраняется', (target, expected) => {
    expect(safeRedirect(target)).toBe(expected)
  })

  it.each([
    'https://evil.example/',
    '//evil.example/path',
    '/\\evil.example',
    '/\\/evil.example',
    'javascript:alert(1)',
    'sites/abc',
    '',
    undefined,
    42,
  ])('чужой или кривой адрес %s → список сайтов', (target) => {
    expect(safeRedirect(target)).toBe('/')
  })

  it('на сам вход не возвращает: иначе после входа снова форма входа', () => {
    expect(safeRedirect('/login?redirect=/sites')).toBe('/')
  })
})

describe('что показывать роли', () => {
  it('клиенту — ни публикации, ни создания и удаления страниц', () => {
    expect([canPublish('client'), canManagePages('client')]).toEqual([false, false])
    expect([canPublish('editor'), canManagePages('editor')]).toEqual([true, true])
    expect([canPublish('owner'), canManagePages('owner')]).toEqual([true, true])
  })

  it('картинки удаляют владелец и редактор, клиент только загружает', () => {
    expect((['client', 'editor', 'owner'] as const).map(canDeleteMedia)).toEqual([
      false,
      true,
      true,
    ])
  })
})
