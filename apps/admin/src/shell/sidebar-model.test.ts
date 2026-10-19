import { describe, expect, it } from 'vitest'
import { roleName, seesInstallation, siteSections, switcherExpandable } from './sidebar-model'

const ids = (site: Parameters<typeof siteSections>[0]) => siteSections(site).map(({ id }) => id)

describe('разделы сайта в панели', () => {
  it('владелец и клиент видят заявки со счётчиком новых', () => {
    expect(ids({ access: 'owner', newLeads: 3 })).toEqual([
      'overview',
      'pages',
      'media',
      'leads',
      'settings',
    ])
    expect(
      siteSections({ access: 'client', newLeads: 0 }).find(({ id }) => id === 'leads'),
    ).toEqual({ id: 'leads', label: 'Заявки', icon: 'leads', badge: 0 })
  })

  it('редактор заявок не видит', () => {
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

describe('установка, роль и переключатель сайта', () => {
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

  it('переключатель раскрывается, когда есть куда переключиться', () => {
    expect(switcherExpandable('member', 1)).toBe(false)
    expect(switcherExpandable('member', 2)).toBe(true)
    expect(switcherExpandable('owner', 1)).toBe(true)
  })
})
