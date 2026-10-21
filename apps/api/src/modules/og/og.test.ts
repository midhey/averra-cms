import { demoSiteId, type PageContentInput } from '@averra/schema'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { OgCardsBusy } from '../../og/card'
import { createTestApi } from '../../testing'

// SEO страницы целиком через API: поля в черновике, публикация, история, картинка страницы в
// медиатеке и снимке, что сайт отдаёт редактору (site.seo), и карточка из заголовка для соцсетей

type Headers = Record<string, string>

const api = await createTestApi({ siteUrl: 'https://example.ru' })
afterAll(api.close)
const { app } = api
const owner = await api.loginAs('owner')
const client = await api.loginAs('client')
const base = `/api/sites/${demoSiteId}`
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })

async function uploadImage(color = '#3b6ea8') {
  const data = await sharp({ create: { width: 1200, height: 630, channels: 4, background: color } })
    .png()
    .toBuffer()
  const body = new FormData()
  body.append('file', new File([new Uint8Array(data)], 'og.png', { type: 'image/png' }))
  const res = await app.request(`${base}/media`, { method: 'POST', headers: owner.headers, body })
  expect(res.status, await res.clone().text()).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const hero = { id: 'hero', type: 'hero' as const, props: { title: 'Цены на ремонт' } }

const save = (slug: string, content: PageContentInput, headers: Headers = owner.headers) =>
  app.request(`${base}/pages/${slug}`, {
    method: 'PUT',
    headers: json(headers),
    body: JSON.stringify({ title: 'Цены', content }),
  })
const publish = (slug: string) =>
  app.request(`${base}/pages/${slug}/publish`, { method: 'POST', headers: owner.headers })

describe('SEO страницы — часть черновика', () => {
  it('поля сохраняются, публикуются, лежат в истории и возвращаются из неё', async () => {
    const image = await uploadImage()
    const seo = {
      title: 'Цены на ремонт квартир в Твери',
      description: 'Сколько стоит ремонт под ключ: смета за день, цена в договоре',
      image: { mediaId: image },
      canonical: '/ceny/',
      noindex: true,
    }
    expect((await save('ceny', { blocks: [hero], seo })).status).toBe(200)
    expect((await publish('ceny')).status).toBe(200)

    const page = (await (
      await app.request(`${base}/pages/ceny`, { headers: owner.headers })
    ).json()) as {
      draft: { seo: unknown }
      published: { seo: unknown }
    }
    expect(page.draft.seo).toEqual(seo)
    expect(page.published.seo).toEqual(seo)

    // Картинка страницы — в справочнике картинок снимка: её вариант нужен og:image
    const snapshot = (await (await app.request(`${base}/snapshot`)).json()) as {
      media: Record<string, unknown>
      pages: { slug: string; content: { seo?: unknown } }[]
    }
    expect(Object.keys(snapshot.media)).toContain(image)
    expect(snapshot.pages.find((p) => p.slug === 'ceny')?.content.seo).toEqual(seo)

    // Новая версия без SEO, потом возврат первой — поля вернулись в черновик
    expect((await save('ceny', { blocks: [hero] })).status).toBe(200)
    expect((await publish('ceny')).status).toBe(200)
    const revisions = (await (
      await app.request(`${base}/pages/ceny/revisions`, { headers: owner.headers })
    ).json()) as { id: string; version: number }[]
    const first = revisions.find((revision) => revision.version === 1)
    if (!first) throw new Error('Нет первой версии')
    const restored = await app.request(`${base}/pages/ceny/revisions/${first.id}/restore`, {
      method: 'POST',
      headers: owner.headers,
    })
    expect(restored.status).toBe(200)
    expect(((await restored.json()) as { draft: { seo: unknown } }).draft.seo).toEqual(seo)
  })

  it('картинка не из медиатеки — 409 с путём до поля', async () => {
    const res = await save('chuzhaya', {
      blocks: [hero],
      seo: { image: { mediaId: '99999999-9999-4999-8999-999999999999' } },
    })
    expect(res.status).toBe(409)
    expect(await res.text()).toContain('content.seo.image.mediaId')
  })

  it('кривой canonical — 400 с путём до поля', async () => {
    const res = await save('canon', { blocks: [hero], seo: { canonical: '//evil.example/' } })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('content.seo.canonical')
  })

  it('картинку страницы нельзя удалить из медиатеки, пока она стоит в SEO', async () => {
    const image = await uploadImage('#aa3333')
    expect(
      (await save('akciya', { blocks: [hero], seo: { image: { mediaId: image } } })).status,
    ).toBe(200)
    const res = await app.request(`${base}/media/${image}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(res.status).toBe(409)
    expect(await res.text()).toContain('/akciya')
  })

  it('клиент правит SEO своих страниц, как и блоки', async () => {
    const res = await save(
      'index',
      { blocks: [hero], seo: { title: 'Ремонт у Ивана' } },
      client.headers,
    )
    expect(res.status).toBe(200)
  })
})

describe('что сайт отдаёт редактору страницы', () => {
  it('шаблон, описание, картинка, адрес и скрыт ли — всем, кто видит сайт, и токену', async () => {
    const patched = await app.request(`${base}/settings`, {
      method: 'PATCH',
      headers: json(owner.headers),
      body: JSON.stringify({ titleTemplate: '%s — Ремонт у Ивана', description: 'Ремонт в Твери' }),
    })
    expect(patched.status).toBe(200)
    const { token } = await api.createToken(demoSiteId, 'mcp')
    for (const headers of [owner.headers, client.headers, { authorization: `Bearer ${token}` }]) {
      const res = await app.request(base, { headers })
      expect(res.status).toBe(200)
      expect(((await res.json()) as { seo: unknown }).seo).toEqual({
        titleTemplate: '%s — Ремонт у Ивана',
        description: 'Ремонт в Твери',
        ogImage: null,
        url: 'https://example.ru',
        hideFromSearch: true,
      })
    }
  })
})

describe('карточка из заголовка', () => {
  it('опубликованной страницы — PNG 1200 × 630 без входа, по опубликованному заголовку', async () => {
    expect((await save('karta', { blocks: [hero] })).status).toBe(200)
    expect((await app.request(`${base}/og/karta`)).status).toBe(404)
    expect((await publish('karta')).status).toBe(200)

    const res = await app.request(`${base}/og/karta`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    const meta = await sharp(new Uint8Array(await res.arrayBuffer())).metadata()
    expect([meta.width, meta.height]).toEqual([1200, 630])
  })

  it('черновой заголовок наружу не виден: карточка — по опубликованному', async () => {
    expect((await save('chernovik', { blocks: [hero] })).status).toBe(200)
    expect((await publish('chernovik')).status).toBe(200)
    // Заголовок поправили в черновике, но не опубликовали
    const draft = await app.request(`${base}/pages/chernovik`, {
      method: 'PUT',
      headers: json(owner.headers),
      body: JSON.stringify({ title: 'Тайная распродажа', content: { blocks: [hero] } }),
    })
    expect(draft.status).toBe(200)

    const png = async (url: string, headers: Headers = {}) => {
      const res = await app.request(url, { headers })
      expect(res.status).toBe(200)
      return Buffer.from(await res.arrayBuffer())
    }
    const served = await png(`${base}/og/chernovik`)
    const preview = (title: string) =>
      png(`${base}/og-card?title=${encodeURIComponent(title)}`, owner.headers)
    // Сайт тот же, поэтому карточка «Цены» из предпросмотра — те же байты, что опубликованная
    expect(served.equals(await preview('Цены'))).toBe(true)
    expect(served.equals(await preview('Тайная распродажа'))).toBe(false)
  })

  it('нет страницы, чужой сайт, кривой адрес — 404 и 400', async () => {
    expect((await app.request(`${base}/og/net-takoy`)).status).toBe(404)
    const other = await api.createSite()
    expect((await app.request(`/api/sites/${other}/og/index`)).status).toBe(404)
    expect((await app.request(`${base}/og/Bad_Slug`)).status).toBe(400)
  })

  it('предпросмотр черновика — только тем, кто видит сайт', async () => {
    const url = `${base}/og-card?title=${encodeURIComponent('Новый заголовок')}`
    expect((await app.request(url)).status).toBe(401)
    const res = await app.request(url, { headers: client.headers })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
    const empty = await app.request(`${base}/og-card?title=%20`, { headers: client.headers })
    expect(empty.status).toBe(400)
  })
})

describe('очередь предпросмотра', () => {
  it('полна — 429 с понятной причиной, а карточки сайта рисуются как прежде', async () => {
    const png = new Uint8Array([137, 80, 78, 71])
    const busy = await createTestApi({
      ogCards: {
        published: async () => png,
        preview: () => Promise.reject(new OgCardsBusy()),
      },
    })
    try {
      const member = await busy.loginAs('owner')
      const res = await busy.app.request(`${base}/og-card?title=${encodeURIComponent('Цены')}`, {
        headers: member.headers,
      })
      expect(res.status).toBe(429)
      expect(await res.json()).toMatchObject({ error: { code: 'rate_limited' } })
      // Главная демо-сайта опубликована: её карточку очередь предпросмотра не задевает
      expect((await busy.app.request(`${base}/og/index`)).status).toBe(200)
    } finally {
      await busy.close()
    }
  })
})
