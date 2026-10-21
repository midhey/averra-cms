import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { leads, media, pages } from '../../db/schema'
import { mediaKey } from '../../media/storage'
import { publishedSite } from '../../publish/published-site'
import { siteReleases } from '../../publish/releases'
import { createTestApi } from '../../testing'
import { siteDataEntries } from './site-data'

// Выгрузка «клиент не заложник»: сайт статическим архивом (текущая версия на сервере) и все
// данные сайта. ZIP распаковывается тем же fflate

const publishDir = join(tmpdir(), `averra-export-${randomUUID()}`)
mkdirSync(publishDir, { recursive: true })
const api = await createTestApi({ published: publishedSite(publishDir), version: '0.7.0' })
afterAll(async () => {
  await api.close()
  rmSync(publishDir, { recursive: true, force: true })
})

const url = (kind: 'static' | 'data', siteId = api.demoSiteId) =>
  `/api/sites/${siteId}/export/${kind}`

async function unzip(res: Response) {
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/zip')
  return unzipSync(new Uint8Array(await res.arrayBuffer()))
}

const decode = (data: Uint8Array | undefined) => new TextDecoder().decode(data)

/** Собранная версия сайта на «сервере»: релиз и ссылка current, как делает сборка */
async function buildRelease(siteId: string, name: string, files: Record<string, string>) {
  const releases = siteReleases(join(publishDir, siteId))
  const dir = await releases.prepare(name)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  await releases.publish(dir, name)
}

describe('сайт статическим архивом', () => {
  it('до первой сборки — 409, после — ZIP текущей версии целиком и только её', async () => {
    const { headers } = await api.loginAs('owner')
    // Свой сайт: папки версий других тестов файла его не задевают
    // API сайтов не создаёт (одна установка — один сайт): сайт кладётся в базу напрямую
    const siteId = await api.createSite('Выгрузка статикой')
    const before = await api.app.request(url('static', siteId), { headers })
    expect(before.status).toBe(409)
    expect(await before.json()).toMatchObject({ error: { code: 'not_built' } })

    await buildRelease(siteId, '20261015T100000Z-aaaaaa', { 'index.html': 'старая' })
    await buildRelease(siteId, '20261016T100000Z-bbbbbb', {
      'index.html': '<h1>Сайт</h1>',
      'o-nas/index.html': '<h1>О нас</h1>',
      '_astro/index.Bx1.css': 'h1{color:red}',
      'media/c6026fd5-5af8-4af9-a36e-1e08b05210a8/480.webp': 'webp',
    })
    const res = await api.app.request(url('static', siteId), { headers })
    expect(res.headers.get('content-disposition')).toMatch(
      new RegExp(`^attachment; filename="averra-${siteId.slice(0, 8)}-site-\\d{8}\\.zip"$`),
    )
    const files = await unzip(res)
    expect(Object.keys(files).sort()).toEqual([
      '_astro/index.Bx1.css',
      'index.html',
      'media/c6026fd5-5af8-4af9-a36e-1e08b05210a8/480.webp',
      'o-nas/index.html',
    ])
    expect(decode(files['index.html'])).toBe('<h1>Сайт</h1>')
  })

  it('права: любой участник сайта — да, токен — 403, чужой — 404', async () => {
    await buildRelease(api.demoSiteId, '20261016T110000Z-cccccc', { 'index.html': 'x' })
    for (const role of ['editor', 'client'] as const) {
      const { headers } = await api.loginAs(role)
      expect((await api.app.request(url('static'), { headers })).status, role).toBe(200)
    }
    const { token } = await api.createToken()
    const byToken = await api.app.request(url('static'), {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(byToken.status).toBe(403)
    // Сайт, которого у участника нет (или нет вовсе), — 404, как везде
    const { headers } = await api.loginAs('editor')
    expect((await api.app.request(url('static', randomUUID()), { headers })).status).toBe(404)
  })

  it('без публикации на сервере (PUBLISH_DIR) — 409', async () => {
    const dev = await createTestApi()
    try {
      const { headers } = await dev.loginAs('owner')
      const res = await dev.app.request(url('static', dev.demoSiteId), { headers })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ error: { code: 'publish_disabled' } })
    } finally {
      await dev.close()
    }
  })
})

describe('все данные сайта', () => {
  it('site.json со страницами, историей, медиатекой и заявками, оригиналы картинок, README', async () => {
    const { headers } = await api.loginAs('owner')
    // Опубликованная версия и история: публикация главной демо-сайта
    expect(
      (
        await api.app.request(`/api/sites/${api.demoSiteId}/pages/index/publish`, {
          method: 'POST',
          headers,
        })
      ).status,
    ).toBe(200)
    const mediaId = randomUUID()
    const missingId = randomUUID()
    const original = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])
    await api.storage.put(mediaKey(api.demoSiteId, mediaId, 'original.jpg'), original)
    const row = {
      siteId: api.demoSiteId,
      originalName: 'фото.jpg',
      mimeType: 'image/jpeg' as const,
      width: 10,
      height: 10,
      size: original.length,
      variants: [{ format: 'webp' as const, width: 10, height: 10, size: 3, file: '10.webp' }],
      originalFile: 'original.jpg',
    }
    await api.db.insert(media).values([
      { ...row, id: mediaId },
      { ...row, id: missingId },
    ])
    await api.db.insert(leads).values({
      siteId: api.demoSiteId,
      pageSlug: 'index',
      blockId: 'lead',
      formTitle: 'Заявка',
      data: [{ name: 'name', label: 'Имя', type: 'name', value: 'Анна' }],
      consentText: 'Согласен',
      consentPolicyUrl: '/privacy',
      consentedAt: new Date(),
    })

    const res = await api.app.request(url('data'), { headers })
    expect(res.headers.get('content-disposition')).toMatch(
      /filename="averra-d0000000-data-\d{8}\.zip"/,
    )
    const files = await unzip(res)
    expect([...(files[`media/${mediaId}/original.jpg`] ?? [])]).toEqual([...original])
    expect(decode(files['README.txt'])).toContain('персональные данные')
    const site = JSON.parse(decode(files['site.json']))
    expect(site).toMatchObject({
      format: 'averra-site-export',
      formatVersion: 1,
      averraVersion: '0.7.0',
      site: { id: api.demoSiteId, leadSettings: { retentionDays: 180 } },
      missingFiles: [`media/${missingId}/original.jpg`],
    })
    const index = site.pages.find((page: { slug: string }) => page.slug === 'index')
    expect(index.published).not.toBeNull()
    expect(index.revisions.length).toBeGreaterThan(0)
    expect(site.media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: mediaId, file: `media/${mediaId}/original.jpg` }),
        expect.objectContaining({ id: missingId, file: null }),
      ]),
    )
    // Внутреннее имя файла варианта в хранилище наружу не нужно
    expect(site.media[0].variants[0]).not.toHaveProperty('file')
    expect(site.leads).toEqual([
      expect.objectContaining({
        pageSlug: 'index',
        consentText: 'Согласен',
        data: [{ name: 'name', label: 'Имя', type: 'name', value: 'Анна' }],
      }),
    ])
  })

  it('site.json потоком: заявки порциями с курсором — все, по одному разу; пустой сайт — валидный JSON', async () => {
    // API сайтов не создаёт (одна установка — один сайт): сайт кладётся в базу напрямую
    const siteId = await api.createSite('Выгрузка порциями')
    // Время повторяется парами: граница порции попадает внутрь одинакового времени
    const base = Date.parse('2026-10-16T10:00:00Z')
    await api.db.insert(leads).values(
      Array.from({ length: 7 }, (_, index) => ({
        siteId,
        pageSlug: 'index',
        blockId: 'lead',
        formTitle: 'Заявка',
        data: [{ name: 'name', label: 'Имя', type: 'name' as const, value: `Гость ${index}` }],
        consentText: 'Согласен',
        consentPolicyUrl: '/privacy',
        consentedAt: new Date(base),
        createdAt: new Date(base + Math.floor(index / 2) * 1000),
      })),
    )
    const read = async (id: string, leadsBatch: number) => {
      const entries = siteDataEntries({
        db: api.db,
        storage: api.storage,
        siteId: id,
        version: '0.7.0',
        now: new Date(),
        leadsBatch,
      })
      for await (const entry of entries) {
        if (entry.name !== 'site.json') continue
        if (entry.data instanceof Uint8Array) throw new Error('site.json должен идти потоком')
        const parts: string[] = []
        for await (const chunk of entry.data) parts.push(decode(chunk))
        return { parts, json: JSON.parse(parts.join('')) }
      }
      throw new Error('нет site.json')
    }
    const { parts, json } = await read(siteId, 2)
    const names = json.leads.map((lead: { data: { value: string }[] }) => lead.data[0]?.value)
    expect(names).toHaveLength(7)
    expect(new Set(names).size).toBe(7)
    // Заявки пришли несколькими кусками, а не одной строкой
    expect(parts.filter((part) => part.includes('"Гость ')).length).toBeGreaterThanOrEqual(4)
    expect(json).toMatchObject({ format: 'averra-site-export', site: { id: siteId } })
    expect(json.pages.length).toBeGreaterThan(0)

    // Сайт без заявок, страниц и картинок — тот же формат, валидный JSON
    // API сайтов не создаёт (одна установка — один сайт): сайт кладётся в базу напрямую
    const bareId = await api.createSite('Пустой')
    await api.db.delete(pages).where(eq(pages.siteId, bareId))
    const empty = await read(bareId, 2)
    expect(empty.json).toMatchObject({ pages: [], media: [], leads: [], missingFiles: [] })
  })

  it('права: владелец и клиент — да, редактор — 403, токен — 403 (в выгрузке заявки)', async () => {
    const { headers: client } = await api.loginAs('client')
    expect((await api.app.request(url('data'), { headers: client })).status).toBe(200)
    const { headers: editor } = await api.loginAs('editor')
    expect((await api.app.request(url('data'), { headers: editor })).status).toBe(403)
    const { token } = await api.createToken()
    const byToken = await api.app.request(url('data'), {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(byToken.status).toBe(403)
    expect((await api.app.request(url('data'))).status).toBe(401)
  })
})
