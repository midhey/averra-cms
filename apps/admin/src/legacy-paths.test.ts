import { describe, expect, it } from 'vitest'
import { legacySiteTarget } from './legacy-paths'

const id = 'd0000000-0000-4000-8000-000000000001'

describe('старые адреса /sites/<id>/…', () => {
  it.each([
    ['/sites', '/'],
    ['/sites/', '/'],
    [`/sites/${id}`, '/'],
    [`/sites/${id}/`, '/'],
    [`/sites/${id}/pages`, '/pages'],
    [`/sites/${id}/pages/o-nas`, '/pages/o-nas'],
    [`/sites/${id}/media`, '/media'],
    [`/sites/${id}/leads`, '/leads'],
    [
      `/sites/${id}/leads/a0000000-0000-4000-8000-000000000001`,
      '/leads/a0000000-0000-4000-8000-000000000001',
    ],
    [`/sites/${id}/settings`, '/settings'],
    // id не важен: сайт у установки один, закладка на другой сайт ведёт на него же
    ['/sites/kriviy-id/pages', '/pages'],
  ])('%s → %s', (from, to) => {
    expect(legacySiteTarget(from)).toBe(to)
  })

  it('сохраняет поиск и якорь', () => {
    expect(legacySiteTarget(`/sites/${id}/leads`, '?status=new')).toBe('/leads?status=new')
    expect(legacySiteTarget(`/sites/${id}/settings`, '', 'leads')).toBe('/settings#leads')
    expect(legacySiteTarget(`/sites/${id}/pages`, '?q=1', '#new-page')).toBe('/pages?q=1#new-page')
  })

  it.each([
    [`/sites/${id}//evil.example`, '/evil.example'],
    [`/sites/${id}/\\evil.example/a`, '/evil.example/a'],
    [`/sites/${id}/\\/\\evil.example`, '/evil.example'],
    ['/sites/x//evil.com', '/evil.com'],
  ])('%s — путь на этом сайте, а не адрес другого: %s', (from, to) => {
    expect(legacySiteTarget(from)).toBe(to)
  })

  it.each(['/', '/pages', '/sitesmap', '/mail', '/status'])('%s — не старый адрес', (path) => {
    expect(legacySiteTarget(path)).toBeUndefined()
  })
})
