import {
  demoSiteId,
  MAX_SVG_BYTES,
  type PageContentInput,
  svgIconMessage,
  svgInContentMessage,
  svgSocialMessage,
  svgTooLargeMessage,
} from '@averra/schema'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { mediaKey } from '../../media/storage'
import { createTestApi } from '../../testing'
import { SVG_CSP } from './routes'

// SVG в медиатеке через настоящие запросы: очистка при загрузке, отдача с CSP, где SVG можно
// поставить (логотип, иконка), а где нельзя (блоки, SEO-картинка страницы, картинка для соцсетей)

const api = await createTestApi()
const { app, storage } = api
afterAll(api.close)

const owner = await api.loginAs('owner')
const json = { ...owner.headers, 'content-type': 'application/json' }
const NS = 'xmlns="http://www.w3.org/2000/svg"'

type Uploaded = {
  id: string
  mimeType: string
  width: number
  height: number
  size: number
  variants: { format: string; width: number; height: number; size: number; url: string }[]
}

function upload(content: string | Uint8Array<ArrayBuffer>, name = 'logo.svg') {
  const body = new FormData()
  body.append('file', new File([content], name, { type: 'image/svg+xml' }))
  return app.request(`/api/sites/${demoSiteId}/media`, {
    method: 'POST',
    headers: owner.headers,
    body,
  })
}

async function uploaded(res: Response) {
  expect(res.status, await res.clone().text()).toBe(201)
  return (await res.json()) as Uploaded
}

const errorOf = async (res: Response) =>
  (
    (await res.json()) as {
      error: { code: string; message: string; issues: { path: string; message: string }[] }
    }
  ).error

const LOGO = `<?xml version="1.0" encoding="UTF-8"?>
<svg ${NS} viewBox="0 0 120 40" onload="alert(1)">
  <script>alert(document.cookie)</script>
  <rect width="120" height="40" fill="#f60"/>
  <a href="javascript:alert(1)"><circle cx="20" cy="20" r="10"/></a>
  <image href="https://evil.example/pixel.png" width="1" height="1"/>
</svg>`

describe('загрузка SVG', () => {
  it('очищается перед сохранением: в файле нет скрипта, обработчиков и ссылок наружу', async () => {
    const media = await uploaded(await upload(LOGO))
    expect(media).toMatchObject({ mimeType: 'image/svg+xml', width: 120, height: 40 })
    expect(media.variants).toEqual([
      expect.objectContaining({
        format: 'svg',
        width: 120,
        height: 40,
        url: `/api/media/${media.id}/image.svg`,
      }),
    ])
    const stored = new TextDecoder().decode(
      await storage.get(mediaKey(demoSiteId, media.id, 'image.svg')),
    )
    expect(stored).toContain('<rect width="120" height="40" fill="#f60"/>')
    expect(stored).toContain('<circle cx="20" cy="20" r="10"/>')
    expect(stored).not.toMatch(/script|onload|javascript:|evil\.example/)
    expect(media.size).toBe(new TextEncoder().encode(stored).byteLength)
  })

  it('отдаётся без входа как image/svg+xml с CSP sandbox и nosniff', async () => {
    const media = await uploaded(await upload(LOGO))
    const res = await app.request(`/api/media/${media.id}/image.svg`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml')
    expect(res.headers.get('content-security-policy')).toBe(SVG_CSP)
    expect(SVG_CSP).toMatch(/default-src 'none'.*sandbox/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await res.text()).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  })

  it('обёртка внутри <style> не проносит @import и url() наружу', async () => {
    const media = await uploaded(
      await upload(
        `<svg ${NS} viewBox="0 0 10 10"><style><a>@import url(http://127.0.0.1:4699/evil.css); rect{fill:url(http://127.0.0.1:4699/pixel)}</a></style><style><switch>rect{fill:url(//evil.example/p)}</switch></style><rect width="10" height="10"/></svg>`,
      ),
    )
    const stored = new TextDecoder().decode(
      await storage.get(mediaKey(demoSiteId, media.id, 'image.svg')),
    )
    expect(stored).not.toMatch(/@import|url\(|127\.0\.0\.1|evil|<style/)
  })

  it('href и xlink:href на одном элементе: файл читается, иконка собирается', async () => {
    const media = await uploaded(
      await upload(
        `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><circle id="a" cx="5" cy="5" r="5"/></defs><use href="#a" xlink:href="#a"/></svg>`,
      ),
    )
    const stored = await storage.get(mediaKey(demoSiteId, media.id, 'image.svg'))
    expect(stored).toBeDefined()
    expect((await sharp(stored).metadata()).format).toBe('svg')
  })

  it(`больше ${MAX_SVG_BYTES / 1024} КБ — 413, в медиатеке пусто`, async () => {
    const count = async () => {
      const res = await app.request(`/api/sites/${demoSiteId}/media`, { headers: owner.headers })
      return ((await res.json()) as { items: unknown[] }).items.length
    }
    const before = await count()
    const padding = `<desc>${'x'.repeat(MAX_SVG_BYTES)}</desc>`
    const res = await upload(`<svg ${NS} viewBox="0 0 1 1">${padding}</svg>`)
    expect(res.status).toBe(413)
    expect((await errorOf(res)).message).toBe(svgTooLargeMessage())
    expect(await count()).toBe(before)
  })

  it('DOCTYPE с сущностями — 415 с объяснением', async () => {
    const res = await upload(
      `<!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><svg ${NS} viewBox="0 0 1 1"><text>&b;</text></svg>`,
    )
    expect(res.status).toBe(415)
    expect((await errorOf(res)).message).toMatch(/сущност/)
  })

  it('без размеров — 415 «нужен viewBox»', async () => {
    const res = await upload(`<svg ${NS}><rect width="1" height="1"/></svg>`)
    expect(res.status).toBe(415)
    expect((await errorOf(res)).message).toMatch(/viewBox/)
  })

  it('HTML вместо SVG — 415', async () => {
    const res = await upload('<html><script>alert(1)</script></html>', 'page.svg')
    expect(res.status).toBe(415)
  })

  it('вложенная PNG — можно; JPEG под видом PNG — 415', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .png()
      .toBuffer()
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .jpeg()
      .toBuffer()
    const withImage = (data: Buffer) =>
      `<svg ${NS} viewBox="0 0 4 4"><image width="4" height="4" href="data:image/png;base64,${data.toString('base64')}"/></svg>`
    await uploaded(await upload(withImage(png)))
    const res = await upload(withImage(jpeg))
    expect(res.status).toBe(415)
    expect((await errorOf(res)).message).toMatch(/внутри SVG/)
  })

  it('удаление убирает файл SVG', async () => {
    const media = await uploaded(await upload(LOGO))
    const res = await app.request(`/api/sites/${demoSiteId}/media/${media.id}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(res.status).toBe(204)
    expect(await storage.get(mediaKey(demoSiteId, media.id, 'image.svg'))).toBeUndefined()
    expect((await app.request(`/api/media/${media.id}/image.svg`)).status).toBe(404)
  })
})

describe('где SVG можно', () => {
  const settings = (body: unknown) =>
    app.request(`/api/sites/${demoSiteId}/settings`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify(body),
    })

  it('логотип организации и иконка — да; картинка для соцсетей — нет', async () => {
    const svg = await uploaded(await upload(LOGO))
    expect((await settings({ organization: { name: 'Ремонт', logo: svg.id } })).status).toBe(200)

    const social = await settings({ ogImage: svg.id })
    expect(social.status).toBe(409)
    expect((await errorOf(social)).issues).toEqual([{ path: 'ogImage', message: svgSocialMessage }])

    expect((await settings({ icon: svg.id })).status).toBe(200)
    // Иконка из SVG растеризуется в тот же набор: квадрат 512 без размытия маленького viewBox
    const icon = await app.request(`/api/sites/${demoSiteId}/icons/icon-512.png`)
    expect(icon.status).toBe(200)
    expect(icon.headers.get('content-type')).toBe('image/png')
    const meta = await sharp(new Uint8Array(await icon.arrayBuffer())).metadata()
    expect([meta.width, meta.height]).toEqual([512, 512])
    const ico = await app.request(`/api/sites/${demoSiteId}/icons/favicon.ico`)
    expect(ico.status).toBe(200)

    await settings({ icon: null, organization: {} })
  })

  it.each([
    ['чертёж A4 в сотых миллиметра', '0 0 21000 29700'],
    ['огромный квадрат', '0 0 50000 50000'],
    ['крошечный viewBox', '0 0 0.1 0.1'],
    ['вытянутый', '0 0 5000 3'],
    ['с href и xlink:href', '0 0 10 10'],
  ])('иконка из SVG «%s» собирается вся', async (_, viewBox) => {
    const svg = await uploaded(
      await upload(
        `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBox}"><defs><rect id="r" width="100%" height="100%" fill="#f60"/></defs><use href="#r" xlink:href="#r"/></svg>`,
      ),
    )
    expect((await settings({ icon: svg.id })).status).toBe(200)
    for (const file of ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
      const res = await app.request(`/api/sites/${demoSiteId}/icons/${file}`)
      expect(res.status, file).toBe(200)
    }
    const icon = await app.request(`/api/sites/${demoSiteId}/icons/icon-512.png`)
    const meta = await sharp(new Uint8Array(await icon.arrayBuffer())).metadata()
    expect([meta.width, meta.height]).toEqual([512, 512])
    await settings({ icon: null })
  })

  it('SVG, из которого не выходит иконка, — 409 у поля icon, иконка прежняя', async () => {
    const svg = await uploaded(await upload(LOGO))
    // Файл в хранилище портится в обход загрузки: так выглядит SVG, который sharp не осилит
    await storage.put(mediaKey(demoSiteId, svg.id, 'image.svg'), new TextEncoder().encode('<svg'))
    const res = await settings({ icon: svg.id })
    expect(res.status).toBe(409)
    expect((await errorOf(res)).issues).toEqual([{ path: 'icon', message: svgIconMessage }])
    const site = await app.request(`/api/sites/${demoSiteId}/settings`, { headers: owner.headers })
    expect(((await site.json()) as { settings: { icon?: string | null } }).settings.icon).not.toBe(
      svg.id,
    )
  })

  it('в блок и SEO-картинку страницы — нет: 409 с причиной у поля', async () => {
    const svg = await uploaded(await upload(LOGO))
    const content: PageContentInput = {
      blocks: [
        {
          id: 'hero',
          type: 'hero',
          props: { variant: 'split', title: 'Логотип', image: { mediaId: svg.id, alt: 'Лого' } },
        },
      ],
      seo: { image: { mediaId: svg.id } },
    }
    const res = await app.request(`/api/sites/${demoSiteId}/pages/svg-v-bloke`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ title: 'SVG в блоке', content }),
    })
    expect(res.status).toBe(409)
    expect((await errorOf(res)).issues).toEqual([
      { path: 'content.blocks.0.props.image.mediaId', message: svgInContentMessage },
      { path: 'content.seo.image.mediaId', message: svgInContentMessage },
    ])
  })
})
