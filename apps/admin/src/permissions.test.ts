import { describe, expect, it } from 'vitest'
import {
  assignableRoles,
  canDefineBlocks,
  canDeleteMedia,
  canEditHeader,
  canEditSeo,
  canEditTheme,
  canExportData,
  canInvite,
  canManageChannels,
  canManageMember,
  canManagePages,
  canPublish,
  canSeeLeads,
  safeRedirect,
} from './permissions'

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

describe('что показывать роли (как access.ts)', () => {
  const roles = ['owner', 'client', 'editor'] as const
  it.each([
    ['публикация и страницы', canPublish, [true, true, true]],
    ['создание и удаление страниц', canManagePages, [true, true, true]],
    ['удаление картинок', canDeleteMedia, [true, true, true]],
    ['участники', canInvite, [true, true, false]],
    ['заявки', canSeeLeads, [true, true, false]],
    ['SEO и «Организация»', canEditSeo, [true, true, false]],
    ['шапка и подвал', canEditHeader, [true, true, false]],
    ['выгрузка', canExportData, [true, true, false]],
    ['тема', canEditTheme, [true, false, false]],
    ['свои блоки', canDefineBlocks, [true, false, false]],
    ['каналы уведомлений', canManageChannels, [true, false, false]],
  ] as const)('%s: владелец, администратор сайта, редактор → %j', (_, can, expected) => {
    expect(roles.map((role) => can(role))).toEqual(expected)
  })

  it('администратор сайта управляет только редакторами, редактор — никем', () => {
    expect(assignableRoles.client).toEqual(['editor'])
    expect(canManageMember('client', 'editor')).toBe(true)
    expect(canManageMember('client', 'client')).toBe(false)
    expect(canManageMember('client', 'owner')).toBe(false)
    expect(canManageMember('owner', 'owner')).toBe(true)
    expect(canManageMember('editor', 'editor')).toBe(false)
    // Отключённые: по роли до отключения
    expect(canManageMember('client', null, 'editor')).toBe(true)
    expect(canManageMember('client', null, 'client')).toBe(false)
    expect(canManageMember('client', null, 'owner')).toBe(false)
    expect(canManageMember('client', null, null)).toBe(false)
    expect(canManageMember('owner', null, 'owner')).toBe(true)
    expect(canManageMember('owner', null, null)).toBe(true)
    expect(canManageMember('editor', null, 'editor')).toBe(false)
    expect(canManageMember('editor', null)).toBe(false)
  })
})
