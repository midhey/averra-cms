import { describe, expect, it } from 'vitest'
import { canDeleteMedia, canInvite, canManagePages, canPublish, safeRedirect } from './permissions'

describe('возврат после входа', () => {
  it.each([
    ['/pages', '/pages'],
    ['/pages/index?x=1#top', '/pages/index?x=1#top'],
    // Старый адрес с id сайта: вход вернёт на него, а роутер перенаправит без id
    ['/sites/abc/media', '/sites/abc/media'],
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
    'pages/index',
    '',
    undefined,
    42,
  ])('чужой или кривой адрес %s → обзор сайта', (target) => {
    expect(safeRedirect(target)).toBe('/')
  })

  it('на сам вход не возвращает: иначе после входа снова форма входа', () => {
    expect(safeRedirect('/login?redirect=/pages')).toBe('/')
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

it('приглашает только владелец', () => {
  expect(canInvite('owner')).toBe(true)
  expect(canInvite('editor')).toBe(false)
  expect(canInvite('client')).toBe(false)
})
