import { demoPageTitle, type PageContentInput } from '@averra/schema'
import { eq } from 'drizzle-orm'
import { testClient } from 'hono/testing'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { pages as pagesTable } from '../../db/schema'
import { createTestApi } from '../../testing'

const { app, db, close, loginAs, createSite, createToken } = await createTestApi()
// Права ролей проверяет auth/access.test.ts, здесь — сами сайты и страницы глазами владельца
const owner = await loginAs('owner')
const sites = testClient(app, undefined, undefined, { headers: owner.headers }).api.sites
const [site] = await (await sites.$get()).json()
if (!site) throw new Error('Демо-сайт не создался')
const siteId = site.id

afterAll(close)

const newContent: PageContentInput = {
  blocks: [{ id: 'hero', type: 'hero', props: { title: 'Новый заголовок' } }],
}

describe('список страниц с фильтрами', () => {
  it('сохраняет массив без параметров и ограничивает запрос с параметрами', async () => {
    const id = await createSite('Пагинация API')
    const draft = { blocks: [] }
    await db.insert(pagesTable).values([
      { siteId: id, slug: 'a-search', title: 'Витрина 100%', draft },
      {
        siteId: id,
        slug: 'b-search',
        title: 'Витрина',
        draft,
        published: draft,
        publishedTitle: 'Витрина',
        publishedAt: new Date(),
      },
      {
        siteId: id,
        slug: 'c-search',
        title: 'Новый заголовок',
        draft,
        published: draft,
        publishedTitle: 'Прежний заголовок',
        publishedAt: new Date(),
      },
    ])
    const base = `/api/sites/${id}/pages`
    const headers = { authorization: `Bearer ${(await createToken(id)).token}` }
    const request = (query = '') => app.request(`${base}${query}`, { headers })
    const legacy = await request()
    const rows = z.array(z.object({ slug: z.string() }))
    const all = rows.parse(await legacy.json())
    expect(Array.isArray(all)).toBe(true)
    expect(all.map((item) => item.slug)).toEqual(['index', 'a-search', 'b-search', 'c-search'])
    const filtered = await request('?q=SEARCH&limit=1&offset=1')
    expect(filtered.headers.get('X-Total-Count')).toBe('3')
    expect(rows.parse(await filtered.json()).map((item) => item.slug)).toEqual(['b-search'])
    for (const [state, total] of [
      ['draft', 1],
      ['published', 2],
      ['unpublished', 2],
    ]) {
      const response = await request(`?q=search&state=${state}`)
      expect(response.headers.get('X-Total-Count')).toBe(String(total))
    }
    expect(await (await request('?q=%25')).json()).toHaveLength(1)
    expect(await (await request('?q=search&offset=99')).json()).toEqual([])
    expect((await request('?q=search&offset=99')).headers.get('X-Total-Count')).toBe('3')
    for (const query of [
      'limit=0',
      'limit=101',
      'limit=1.5',
      'offset=-1',
      'offset=2147483648',
      'state=unknown',
      `q=${'a'.repeat(201)}`,
    ]) {
      expect((await request(`?${query}`)).status, query).toBe(400)
    }
    expect((await app.request(`/api/sites/${siteId}/pages?limit=1`, { headers })).status).toBe(404)
    await db.insert(pagesTable).values(
      Array.from({ length: 21 }, (_, index) => ({
        siteId: id,
        slug: `bulk-${index}`,
        title: 'Ещё страница',
        draft,
      })),
    )
    const defaultLimit = await request('?q=bulk-')
    expect(defaultLimit.headers.get('X-Total-Count')).toBe('21')
    expect(await defaultLimit.json()).toHaveLength(20)
  })
})

describe('сайты и страницы', () => {
  it('отдаёт сайт с темой', async () => {
    const res = await sites[':siteId'].$get({ param: { siteId } })
    if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
    const site = await res.json()
    expect(site.theme.colors.accent).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('отдаёт в снимке сайта опубликованный демо-лендинг', async () => {
    const res = await sites[':siteId'].snapshot.$get({ param: { siteId } })
    if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
    const { pages } = await res.json()
    expect(pages.map((page) => page.slug)).toEqual(['index'])
    expect(pages[0]?.content.blocks).toHaveLength(3)
  })

  it('страницу с пустым опубликованным заголовком из снимка не теряет', async () => {
    // API такого заголовка не пропустит, а база (CHECK только на NULL) — да: ручная правка
    const empty = { blocks: [] }
    await db.insert(pagesTable).values({
      siteId,
      slug: 'empty-title',
      title: '',
      draft: empty,
      published: empty,
      publishedTitle: '',
    })
    const res = await sites[':siteId'].snapshot.$get({ param: { siteId } })
    if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
    const { pages } = await res.json()
    expect(pages.find((page) => page.slug === 'empty-title')).toMatchObject({ title: '' })
    await db.delete(pagesTable).where(eq(pagesTable.slug, 'empty-title'))
  })

  it('сохраняет черновик, не трогая опубликованную версию', async () => {
    const param = { siteId, slug: 'index' }
    const saved = await sites[':siteId'].pages[':slug'].$put({
      param,
      json: { title: 'Новый лендинг', content: newContent },
    })
    expect(saved.status).toBe(200)

    const res = await sites[':siteId'].pages[':slug'].$get({ param })
    if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
    const page = await res.json()
    expect(page.draft.blocks).toHaveLength(1)
    expect(page.published?.blocks).toHaveLength(3)

    // Новый заголовок страницы тоже ждёт публикации: на сайте пока старый
    const snapshot = await sites[':siteId'].snapshot.$get({ param: { siteId } })
    if (snapshot.status !== 200) throw new Error(`Ожидали 200, пришёл ${snapshot.status}`)
    const { pages } = await snapshot.json()
    expect(pages[0]?.title).toBe(demoPageTitle)
  })

  it('публикует черновик, и он попадает в снимок сайта', async () => {
    const param = { siteId, slug: 'index' }
    const published = await sites[':siteId'].pages[':slug'].publish.$post({ param })
    expect(published.status).toBe(200)

    const res = await sites[':siteId'].snapshot.$get({ param: { siteId } })
    if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
    const { pages } = await res.json()
    expect(pages[0]?.title).toBe('Новый лендинг')
    expect(pages[0]?.content.blocks[0]).toMatchObject({ props: { title: 'Новый заголовок' } })
  })

  it('не сохраняет небезопасную ссылку и показывает, какое поле не так', async () => {
    const button = { label: 'Жми', href: 'javascript:alert(1)' }
    const res = await sites[':siteId'].pages[':slug'].$put({
      param: { siteId, slug: 'index' },
      json: {
        title: 'Взлом',
        content: { blocks: [{ id: 'c', type: 'cta', props: { title: 'Жми', button } }] },
      },
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { code: 'validation', issues: [{ path: 'content.blocks.0.props.button.href' }] },
    })
  })

  it('отвечает 400 на кривой id сайта и 404 на несуществующий', async () => {
    const bad = await sites[':siteId'].snapshot.$get({ param: { siteId: 'not-a-uuid' } })
    expect(bad.status).toBe(400)
    const missing = await sites[':siteId'].snapshot.$get({
      param: { siteId: '00000000-0000-4000-8000-000000000000' },
    })
    expect(missing.status).toBe(404)
  })
})
