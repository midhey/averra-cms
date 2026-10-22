import { readSiteSettings } from '@averra/schema'
import { defaultTheme } from '@averra/tokens'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../../db/client'
import { migrateDb } from '../../db/migrate'
import { pages, sites } from '../../db/schema'
import { createTestApi } from '../../testing'
import { defaultSiteName, sitesRepo } from '../sites/repo'
import { NO_INSTALLATION_SITE_ACCESS, NO_SITE_ACCESS_CODE } from './routes'

// Одна установка — один сайт: какой сайт у установки, как он появляется и что видит пришедший
// без id сайта в адресе (GET /api/site)

const api = await createTestApi({ siteUrl: 'https://example.ru' })
afterAll(api.close)

type Headers = Record<string, string>
const installation = (headers: Headers = {}) => api.app.request('/api/site', { headers })
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('сайт установки в базе', () => {
  it('пустая база: сайт создаётся один раз, сразу с главной, и повтор ничего не добавляет', async () => {
    const { db, close } = createDb()
    try {
      await migrateDb(db)
      const repo = sitesRepo(db)
      expect(await repo.installationSite()).toBeUndefined()

      const first = await repo.ensureInstallationSite('Ремонт квартир', defaultTheme)
      expect(first).toMatchObject({ created: true, site: { name: 'Ремонт квартир' } })
      const again = await repo.ensureInstallationSite('Другое название', defaultTheme)
      expect(again).toEqual({ created: false, site: first.site })

      expect(await repo.count()).toBe(1)
      const main = await db.select().from(pages).where(eq(pages.siteId, first.site.id))
      expect(main).toEqual([
        expect.objectContaining({ slug: 'index', title: 'Ремонт квартир', published: null }),
      ])
      // Новый сайт делают на настоящем домене до запуска: он скрыт от поисковиков сразу
      const [created] = await db
        .select({ settings: sites.settings })
        .from(sites)
        .where(eq(sites.id, first.site.id))
      expect(readSiteSettings(created?.settings).hideFromSearch).toBe(true)
    } finally {
      await close()
    }
  })

  it('в базе несколько сайтов: сайт установки — созданный первым, остальные не теряются', async () => {
    const { db, close } = createDb()
    try {
      await migrateDb(db)
      const repo = sitesRepo(db)
      // Время создания задано явно: правило не зависит от порядка строк в таблице
      const [younger, older] = await db
        .insert(sites)
        .values([
          { name: 'Младший', theme: defaultTheme, createdAt: new Date('2026-02-01T00:00:00Z') },
          { name: 'Старший', theme: defaultTheme, createdAt: new Date('2026-01-01T00:00:00Z') },
        ])
        .returning()
      if (!younger || !older) throw new Error('Сайты не создались')

      expect((await repo.installationSite())?.id).toBe(older.id)
      const ensured = await repo.ensureInstallationSite('Новый', defaultTheme)
      expect(ensured).toMatchObject({ created: false, site: { id: older.id } })
      expect(await repo.count()).toBe(2)
      expect(await repo.find(younger.id)).toMatchObject({ name: 'Младший' })
      // Сайт из базы до раздела «SEO» (настроек нет — {}) уже работает: он остаётся открытым
      expect(older.settings).toEqual({})
      expect(readSiteSettings(older.settings).hideFromSearch).toBe(false)
    } finally {
      await close()
    }
  })

  it('название без SITE_NAME — домен сайта, без домена — «Мой сайт»', () => {
    expect(defaultSiteName('https://remont.example.ru')).toBe('remont.example.ru')
    expect(defaultSiteName(undefined)).toBe('Мой сайт')
    const long = `https://${'a'.repeat(60)}.${'b'.repeat(60)}.ru`
    expect(defaultSiteName(long)).toHaveLength(80)
  })
})

describe('GET /api/site', () => {
  it('владельцу — демо-сайт (созданный первым), адрес сайта и сколько ещё сайтов в базе', async () => {
    const owner = await api.loginAs('owner')
    const before = await installation(owner.headers)
    expect(before.status).toBe(200)
    const { otherSites } = (await before.json()) as { otherSites: number }

    await api.createSite('Сайт из старой базы')
    const res = await installation(owner.headers)
    expect(await res.json()).toEqual({
      id: api.demoSiteId,
      name: 'Демо: ремонт квартир',
      url: 'https://example.ru',
      otherSites: otherSites + 1,
    })
  })

  it.each(['editor', 'client'] as const)(
    '%s сайта установки получает тот же сайт, но не число чужих сайтов',
    async (role) => {
      const { headers } = await api.loginAs(role)
      expect(await (await installation(headers)).json()).toEqual({
        id: api.demoSiteId,
        name: 'Демо: ремонт квартир',
        url: 'https://example.ru',
        otherSites: null,
      })
    },
  )

  it('участник только другого сайта базы — 403 с понятным текстом, а не пустая админка', async () => {
    const other = await api.createSite('Чужой сайт')
    const { headers } = await api.loginAs('editor', other)
    const res = await installation(headers)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: { code: NO_SITE_ACCESS_CODE, message: NO_INSTALLATION_SITE_ACCESS },
    })
  })

  it('участник без доступа к сайтам — тоже 403', async () => {
    const user = await api.createUser('member')
    const res = await installation(await api.sessionHeaders(user.email))
    expect(res.status).toBe(403)
  })

  it('токен — сайт, на который он выпущен', async () => {
    const other = await api.createSite('Сайт токена')
    const { token } = await api.createToken(other)
    expect(await (await installation(bearer(token))).json()).toMatchObject({
      id: other,
      name: 'Сайт токена',
      otherSites: null,
    })
  })

  it('без входа — 401', async () => {
    expect((await installation()).status).toBe(401)
  })

  it('адрес сайта не задан (SITE_URL) — url: null', async () => {
    const plain = await createTestApi()
    try {
      const owner = await plain.loginAs('owner')
      const res = await plain.app.request('/api/site', { headers: owner.headers })
      expect(await res.json()).toMatchObject({ url: null, otherSites: 0 })
    } finally {
      await plain.close()
    }
  })
})

describe('GET /api/site/snapshot', () => {
  it('открыт без входа и отдаёт опубликованный сайт установки — рендереру не нужен id', async () => {
    const res = await api.app.request('/api/site/snapshot')
    expect(res.status).toBe(200)
    const snapshot = (await res.json()) as { site: { id: string }; pages: { slug: string }[] }
    expect(snapshot.site.id).toBe(api.demoSiteId)
    expect(snapshot.pages.map((page) => page.slug)).toEqual(['index'])
  })
})
