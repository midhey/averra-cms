import { demoPageTitle, type PageContentInput } from '@cms/schema'
import { testClient } from 'hono/testing'
import { afterAll, describe, expect, it } from 'vitest'
import { createTestApi } from '../../testing'

const { app, close, loginAs } = await createTestApi()
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
