import { describe, expect, it } from 'vitest'
import { roleName, seesInstallation, siteSections } from './sidebar-model'

const ids = (site: Parameters<typeof siteSections>[0]) => siteSections(site).map(({ id }) => id)

describe('разделы сайта в панели', () => {
  it('владелец и клиент видят заявки со счётчиком и уведомления, «SEO» — только владелец', () => {
    expect(ids({ access: 'owner', newLeads: 3 })).toEqual([
      'overview',
      'pages',
      'theme',
      'header',
      'media',
      'leads',
      'notifications',
      'seo',
      'settings',
    ])
    expect(ids({ access: 'client', newLeads: 0 })).toEqual([
      'overview',
      'pages',
      'media',
      'leads',
      'notifications',
      'settings',
    ])
    expect(
      siteSections({ access: 'client', newLeads: 0 }).find(({ id }) => id === 'leads'),
    ).toEqual({ id: 'leads', label: 'Заявки', icon: 'leads', badge: 0 })
  })

  it('редактор заявок не видит, а тему, шапку и меню меняет; клиенту их нет', () => {
    expect(ids({ access: 'editor', newLeads: null })).toEqual([
      'overview',
      'pages',
      'theme',
      'header',
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
    expect(roleName('member', 'client')).toBe('Клиент')
    expect(roleName('member')).toBe('Участник')
  })
})
