import { describe, expect, it } from 'vitest'
import { roleName, seesInstallation, siteSections } from './sidebar-model'

const ids = (site: Parameters<typeof siteSections>[0]) => siteSections(site).map(({ id }) => id)

describe('разделы сайта в панели', () => {
  it('владелец и администратор сайта видят заявки, уведомления, шапку и SEO; тему, «Свои блоки» и «Скрипт сайта» — только владелец', () => {
    expect(ids({ access: 'owner', newLeads: 3 })).toEqual([
      'overview',
      'pages',
      'theme',
      'header',
      'blocks',
      'script',
      'media',
      'leads',
      'notifications',
      'seo',
      'settings',
    ])
    expect(ids({ access: 'client', newLeads: 0 })).toEqual([
      'overview',
      'pages',
      'header',
      'media',
      'leads',
      'notifications',
      'seo',
      'settings',
    ])
    expect(
      siteSections({ access: 'client', newLeads: 0 }).find(({ id }) => id === 'leads'),
    ).toEqual({ id: 'leads', label: 'Заявки', icon: 'leads', badge: 0 })
  })

  it('редактору — страницы и медиатека: ни заявок, ни темы, ни шапки, ни SEO', () => {
    expect(ids({ access: 'editor', newLeads: null })).toEqual([
      'overview',
      'pages',
      'media',
      'settings',
    ])
  })

  it('если API не отдал число заявок, пункта нет и у владельца', () => {
    expect(ids({ access: 'owner', newLeads: null })).not.toContain('leads')
  })
})

describe('установка и роль', () => {
  it('почта и состояние — только владельцу', () => {
    expect(seesInstallation('owner')).toBe(true)
    expect(seesInstallation('member')).toBe(false)
  })

  it('подпись роли', () => {
    expect(roleName('owner', 'owner')).toBe('Владелец')
    expect(roleName('owner')).toBe('Владелец')
    expect(roleName('member', 'editor')).toBe('Редактор')
    expect(roleName('member', 'client')).toBe('Администратор сайта')
    expect(roleName('member')).toBe('Участник')
  })
})
