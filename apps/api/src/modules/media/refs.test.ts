import { demoSiteId, type PageContentInput } from '@averra/schema'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { createTestApi } from '../../testing'

// Страница ссылается на картинку по id. API следит, чтобы ссылка вела в медиатеку того же
// сайта: при сохранении черновика, при возврате версии и в снимке для рендерера

const api = await createTestApi()
const { app, loginAs } = api
afterAll(api.close)

const owner = await loginAs('owner')
const json = { ...owner.headers, 'content-type': 'application/json' }

async function uploadTo(siteId: string) {
  const data = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#777' } })
    .jpeg()
    .toBuffer()
  const body = new FormData()
  body.append('file', new File([new Uint8Array(data)], 'photo.jpg', { type: 'image/jpeg' }))
  const res = await app.request(`/api/sites/${siteId}/media`, {
    method: 'POST',
    headers: owner.headers,
    body,
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; width: number; height: number }
}

async function createSite(name: string) {
  const res = await app.request('/api/sites', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ name }),
  })
  return ((await res.json()) as { id: string }).id
}

const withImage = (mediaId: string, extra: PageContentInput['blocks'] = []): PageContentInput => ({
  blocks: [
    {
      id: 'hero',
      type: 'hero',
      props: { variant: 'split', title: 'Ремонт', image: { mediaId, alt: 'Готовая кухня' } },
    },
    ...extra,
  ],
})

const pageUrl = (slug: string, siteId = demoSiteId) => `/api/sites/${siteId}/pages/${slug}`
const save = (slug: string, content: PageContentInput, siteId = demoSiteId) =>
  app.request(pageUrl(slug, siteId), {
    method: 'PUT',
    headers: json,
    body: JSON.stringify({ title: 'Страница', content }),
  })
const publish = (slug: string, siteId = demoSiteId) =>
  app.request(`${pageUrl(slug, siteId)}/publish`, { method: 'POST', headers: owner.headers })

async function snapshotMedia(siteId = demoSiteId) {
  const res = await app.request(`/api/sites/${siteId}/snapshot`)
  return ((await res.json()) as { media: Record<string, unknown> }).media
}

describe('черновик со ссылкой на картинку', () => {
  it('картинку своего сайта сохраняет', async () => {
    const media = await uploadTo(demoSiteId)
    expect((await save('svoya', withImage(media.id))).status).toBe(200)
  })

  it('картинку чужого сайта не пускает: 409 с путём до поля', async () => {
    const otherSiteId = await createSite('Сайт с чужой картинкой')
    const foreign = await uploadTo(otherSiteId)

    const res = await save('chuzhaya', withImage(foreign.id))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: {
        code: 'conflict',
        issues: [
          {
            path: 'content.blocks.0.props.image.mediaId',
            message: expect.stringMatching(/нет в медиатеке/),
          },
        ],
      },
    })
    const page = await app.request(pageUrl('chuzhaya'), { headers: owner.headers })
    expect(page.status).toBe(404)
  })

  it('несуществующую картинку не пускает, каждая кривая ссылка — со своим путём', async () => {
    const own = await uploadTo(demoSiteId)
    const missing = '00000000-0000-4000-8000-00000000abcd'
    const content = withImage(own.id, [
      {
        id: 'second',
        type: 'hero',
        props: { variant: 'split', title: 'Ещё', image: { mediaId: missing, alt: 'Нет' } },
      },
    ])
    const res = await save('vydumannaya', content)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: { issues: [{ path: 'content.blocks.1.props.image.mediaId' }] },
    })
  })
})

describe('снимок сайта', () => {
  it('отдаёт справочник только по картинкам опубликованных страниц', async () => {
    const siteId = await createSite('Сайт со снимком')
    const published = await uploadTo(siteId)
    const draftOnly = await uploadTo(siteId)
    await uploadTo(siteId)

    expect((await save('glavnaya', withImage(published.id), siteId)).status).toBe(200)
    expect((await publish('glavnaya', siteId)).status).toBe(200)
    expect((await save('chernovik', withImage(draftOnly.id), siteId)).status).toBe(200)

    const media = await snapshotMedia(siteId)
    expect(Object.keys(media)).toEqual([published.id])
    expect(media[published.id]).toMatchObject({
      width: 640,
      height: 480,
      variants: expect.arrayContaining([
        expect.objectContaining({
          format: 'avif',
          width: 480,
          url: `/api/media/${published.id}/480.avif`,
        }),
      ]),
    })
  })

  it('сайт без картинок — пустой справочник', async () => {
    const siteId = await createSite('Сайт без картинок')
    expect(await snapshotMedia(siteId)).toEqual({})
  })
})

describe('возврат версии', () => {
  it('версию с удалённой картинкой вернуть нельзя: 409, черновик не тронут', async () => {
    const siteId = await createSite('Сайт с историей картинок')
    const media = await uploadTo(siteId)
    expect((await save('istoriya', withImage(media.id), siteId)).status).toBe(200)
    expect((await publish('istoriya', siteId)).status).toBe(200)
    // Убрали картинку со страницы и с сайта — теперь её можно удалить
    expect((await save('istoriya', { blocks: [] }, siteId)).status).toBe(200)
    expect((await publish('istoriya', siteId)).status).toBe(200)
    const removed = await app.request(`/api/sites/${siteId}/media/${media.id}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(removed.status).toBe(204)

    const list = await app.request(`${pageUrl('istoriya', siteId)}/revisions`, {
      headers: owner.headers,
    })
    const revisions = (await list.json()) as { id: string; version: number }[]
    const first = revisions.find((revision) => revision.version === 1)
    if (!first) throw new Error('Нет версии 1')

    const res = await app.request(`${pageUrl('istoriya', siteId)}/revisions/${first.id}/restore`, {
      method: 'POST',
      headers: owner.headers,
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: {
        message: expect.stringMatching(/Версии 1|В версии 1/),
        issues: [{ path: 'content.blocks.0.props.image.mediaId' }],
      },
    })
    const page = await app.request(pageUrl('istoriya', siteId), { headers: owner.headers })
    expect(((await page.json()) as { draft: unknown }).draft).toEqual({ blocks: [] })
  })
})
