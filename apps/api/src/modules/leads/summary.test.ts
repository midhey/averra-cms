import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { leads } from '../../db/schema'
import { createTestApi } from '../../testing'
import { leadsRepo } from './repo'

const api = await createTestApi()
afterAll(api.close)

describe('сводка источников заявок', () => {
  it('считает все заявки сайта, период, источники, страницы и отдельные формы', async () => {
    const siteId = await api.createSite('Сводка')
    const otherSiteId = await api.createSite('Чужие заявки')
    const now = new Date('2026-11-16T12:00:00Z')
    const row = (age: number, overrides = {}) => ({
      siteId,
      pageSlug: 'index',
      blockId: 'form',
      formTitle: 'Заявка',
      data: [],
      consentText: 'Согласен',
      consentPolicyUrl: '/privacy',
      consentedAt: now,
      createdAt: new Date(now.getTime() - age * 86_400_000),
      ...overrides,
    })
    await api.db
      .insert(leads)
      .values([
        row(0, { attribution: { utm_source: 'ya', referrerDomain: 'search.test' } }),
        row(7, { attribution: { referrerDomain: 'search.test' } }),
        row(8, { attribution: { utm_source: 'ya' }, status: 'processed', processedAt: now }),
        row(30, { pageSlug: 'contacts', blockId: 'other' }),
        row(90),
        row(91),
        row(-1),
        row(0, { siteId: otherSiteId }),
      ])
    // Сводка шире списка (500), в том числе при одинаковом времени заявок.
    await api.db.insert(leads).values(Array.from({ length: 501 }, () => row(0)))
    const repo = leadsRepo(api.db)
    const week = await repo.summary(siteId, 7, now)
    expect(week.total).toBe(503)
    expect(week.sources).toEqual([
      { label: 'прямой заход', count: 501 },
      { label: 'search.test', count: 1 },
      { label: 'ya', count: 1 },
    ])
    expect(week.pages).toEqual([{ label: '/', count: 503 }])
    expect((await repo.summary(siteId, 30, now)).total).toBe(505)
    const quarter = await repo.summary(siteId, 90, now)
    expect(quarter.total).toBe(506)
    expect(quarter.pages).toContainEqual({ label: '/contacts', count: 1 })
    expect(quarter.forms).toHaveLength(2)
    expect(quarter.forms).toContainEqual({
      pageSlug: 'contacts',
      blockId: 'other',
      source: 'block',
      label: 'Заявка',
      count: 1,
    })
    await api.db.delete(leads).where(eq(leads.siteId, siteId))
    expect(await repo.summary(siteId, 7, now)).toEqual({
      days: 7,
      total: 0,
      sources: [],
      pages: [],
      forms: [],
    })
  })

  it('HTTP: период по умолчанию 30 дней, неизвестный период — 400', async () => {
    const siteId = await api.createSite('Периоды')
    const owner = await api.loginAs('owner')
    const url = `/api/sites/${siteId}/leads/summary`
    const res = await api.app.request(url, { headers: owner.headers })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ days: 30, total: 0 })
    expect(res.headers.get('cache-control')).toBe('no-store')
    for (const days of ['7', '30', '90']) {
      expect(
        (await api.app.request(`${url}?days=${days}`, { headers: owner.headers })).status,
      ).toBe(200)
    }
    expect((await api.app.request(`${url}?days=365`, { headers: owner.headers })).status).toBe(400)
  })

  it('группирует по фактической странице отправки, включая форму окна', async () => {
    const siteId = await api.createSite('Страницы отправки')
    const now = new Date()
    await api.db.insert(leads).values({
      siteId,
      pageSlug: 'window',
      blockId: 'form',
      formTitle: 'Запись',
      data: [],
      consentText: 'Согласен',
      consentPolicyUrl: '/privacy',
      consentedAt: now,
      createdAt: now,
      attribution: { pageUrl: 'https://site.test/services', utm_source: 'ya' },
    })
    expect((await leadsRepo(api.db).summary(siteId, 7)).pages).toEqual([
      { label: 'https://site.test/services', count: 1 },
    ])
  })
})
