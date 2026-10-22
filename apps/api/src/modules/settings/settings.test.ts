import { demoSiteId, SITE_ROOT_FILES, type SiteSettings } from '@averra/schema'
import { and, eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { notificationChannels, notificationRecipients, pages, sites } from '../../db/schema'
import { cachedIcons, ICO_SIZES, ICON_FILES, icoFromPngs } from '../../media/favicon'
import { channelSecretContext } from '../../notifications/channel'
import type { SitePublisher } from '../../publish/queue'
import { createTestApi } from '../../testing'
import { sameSitePathOf } from './same-site'

// Раздел «SEO»: настройки сайта целиком (GET), по частям (PATCH), права, проверки, которым нужна
// база, и всё, что из настроек выходит наружу: снимок для рендерера, иконки, редиректы и 404

type Headers = Record<string, string>
type SettingsView = { settings: SiteSettings; installationUrl: string | null; url: string | null }

const requested: string[] = []
const publisher: SitePublisher = {
  request: async (siteId) => {
    requested.push(siteId)
  },
}
const notFound = { page: undefined as string | undefined }
const logged: string[] = []
const api = await createTestApi({
  log: (line) => logged.push(line),
  siteUrl: 'https://example.ru',
  publisher,
  notFoundPage: async () => notFound.page,
})
afterAll(api.close)
const { app } = api

const owner = await api.loginAs('owner')
const url = `/api/sites/${demoSiteId}/settings`
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })
const read = (headers: Headers = owner.headers) => app.request(url, { headers })
const patch = (body: unknown, headers: Headers = owner.headers) =>
  app.request(url, { method: 'PATCH', headers: json(headers), body: JSON.stringify(body) })

async function saved(res: Response) {
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as SettingsView
}

/** Картинка в медиатеке демо-сайта: квадрат цвета color нужного размера */
async function uploadImage(width = 64, height = 64, color = '#3b6ea8') {
  const data = await sharp({ create: { width, height, channels: 4, background: color } })
    .png()
    .toBuffer()
  const body = new FormData()
  body.append('file', new File([new Uint8Array(data)], 'icon.png', { type: 'image/png' }))
  const res = await app.request(`/api/sites/${demoSiteId}/media`, {
    method: 'POST',
    headers: owner.headers,
    body,
  })
  expect(res.status, await res.clone().text()).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const issues = async (res: Response) =>
  ((await res.json()) as { error: { issues: { path: string; message: string }[] } }).error.issues

describe('права', () => {
  it('настройки видит и меняет только владелец: редактору, клиенту и токену — 403', async () => {
    expect((await read()).status).toBe(200)
    for (const role of ['editor', 'client'] as const) {
      const { headers } = await api.loginAs(role)
      expect((await read(headers)).status, role).toBe(403)
      expect((await patch({ description: 'x' }, headers)).status, role).toBe(403)
    }
    const { token } = await api.createToken()
    const bearer = { authorization: `Bearer ${token}` }
    expect((await read(bearer)).status).toBe(403)
    expect((await app.request(url)).status).toBe(401)
  })
})

describe('чтение и сохранение', () => {
  it('демо-сайт, как новый сайт установки, скрыт от поисковиков; адрес — адрес установки', async () => {
    const view = await saved(await read())
    expect(view.settings).toMatchObject({
      name: 'Демо: ремонт квартир',
      hideFromSearch: true,
      url: '',
      redirects: [],
    })
    expect(view.installationUrl).toBe('https://example.ru')
    expect(view.url).toBe('https://example.ru')
  })

  it('PATCH меняет только присланное и пересобирает сайт', async () => {
    requested.length = 0
    const first = await saved(
      await patch({ description: 'Ремонт квартир в Твери', titleTemplate: '%s — Ремонт' }),
    )
    expect(first.settings).toMatchObject({
      description: 'Ремонт квартир в Твери',
      titleTemplate: '%s — Ремонт',
    })
    const second = await saved(
      await patch({ name: 'Ремонт в Твери', url: 'https://Remont.example/' }),
    )
    expect(second.settings).toMatchObject({
      name: 'Ремонт в Твери',
      description: 'Ремонт квартир в Твери',
      url: 'https://remont.example',
    })
    expect(second.url).toBe('https://remont.example')
    expect(requested).toEqual([demoSiteId, demoSiteId])
    // Только редиректы — без сборки: их читает API, в релиз они не попадают
    await saved(await patch({ redirects: [{ from: '/old', to: '/' }] }))
    expect(requested).toEqual([demoSiteId, demoSiteId])
    await saved(await patch({ redirects: [], description: 'Ремонт квартир в Твери' }))
    expect(requested).toEqual([demoSiteId, demoSiteId, demoSiteId])
    // Название — то же, что у сайта: его видит боковая панель
    const site = (await (await app.request('/api/site', { headers: owner.headers })).json()) as {
      name: string
    }
    expect(site.name).toBe('Ремонт в Твери')
    await saved(await patch({ name: 'Демо: ремонт квартир', url: '' }))
  })

  it('ошибки схемы — 400 с путём до поля', async () => {
    const res = await patch({
      titleTemplate: 'Без подстановки',
      analytics: { metrika: 'abc' },
      redirects: [
        { from: '/a', to: '/b' },
        { from: '/b', to: '/a' },
      ],
    })
    expect(res.status).toBe(400)
    expect((await issues(res)).map((issue) => issue.path)).toEqual([
      'titleTemplate',
      'analytics.metrika',
      'redirects.0.to',
      'redirects.1.to',
    ])
  })

  it('редирект на чужой сайт под видом пути (/\\evil.example) — 400, ничего не сохраняется', async () => {
    for (const to of ['/\\evil.example', '/\\/evil.example']) {
      const res = await patch({ redirects: [{ from: '/evil', to }] })
      expect(res.status).toBe(400)
      expect((await issues(res)).map((issue) => issue.path)).toEqual(['redirects.0.to'])
    }
    expect((await saved(await read())).settings.redirects).toEqual([])
  })

  it('ссылка https на адрес сайта — петля: 409 у таблицы, а при смене адреса — у адреса', async () => {
    // Адрес сайта — адрес установки (https://example.ru)
    const loop = await patch({
      redirects: [
        { from: '/a', to: 'https://example.ru/b' },
        { from: '/b', to: '/a' },
      ],
    })
    expect(loop.status).toBe(409)
    expect((await issues(loop)).map((issue) => issue.path)).toEqual([
      'redirects.0.to',
      'redirects.1.to',
    ])

    // Своя ссылка на другой домен — не петля, пока адрес сайта другой
    await saved(await patch({ redirects: [{ from: '/a', to: 'https://remont.ru/a' }] }))
    const moved = await patch({ url: 'https://remont.ru' })
    expect(moved.status).toBe(409)
    expect(await issues(moved)).toEqual([
      {
        path: 'url',
        message: expect.stringMatching(/\/a → https:\/\/remont\.ru\/a ведёт по кругу/),
      },
    ])
    expect((await saved(await read())).settings.url).toBe('')
    await saved(await patch({ redirects: [] }))
  })

  it('петлю видно и через порт по умолчанию, и через домен в punycode', async () => {
    // Порт :443 — тот же сайт https://example.ru (адрес установки)
    const viaPort = await patch({
      redirects: [
        { from: '/a', to: 'https://example.ru:443/b' },
        { from: '/b', to: '/a' },
      ],
    })
    expect(viaPort.status).toBe(409)
    expect((await issues(viaPort)).map((issue) => issue.path)).toEqual([
      'redirects.0.to',
      'redirects.1.to',
    ])
    // Другой порт — уже другой адрес: не петля
    await saved(await patch({ redirects: [{ from: '/a', to: 'https://example.ru:8443/a' }] }))

    // Кириллический домен и та же ссылка в punycode
    await saved(await patch({ redirects: [], url: 'https://пример.рф' }))
    const viaPunycode = await patch({
      redirects: [{ from: '/a', to: 'https://xn--e1afmkfd.xn--p1ai/a/' }],
    })
    expect(viaPunycode.status).toBe(409)
    expect(await issues(viaPunycode)).toEqual([
      { path: 'redirects.0.to', message: 'Редирект ведёт сам на себя' },
    ])
    await saved(await patch({ redirects: [], url: '' }))
  })

  it('разбор адреса для петель: хост целиком, путь — как в адресе', () => {
    const path = sameSitePathOf('https://пример.рф')
    expect(path('https://ПРИМЕР.рф/цены?x=1')).toBe('/%D1%86%D0%B5%D0%BD%D1%8B')
    expect(path('https://xn--e1afmkfd.xn--p1ai')).toBe('/')
    expect(path('https://пример.рф.evil.example/a')).toBeUndefined()
    expect(path('http://пример.рф/a')).toBeUndefined()
    expect(path('not a url')).toBeUndefined()
  })

  it('поле, которое эта версия не понимает (после отката), читается по умолчанию и не затирается', async () => {
    const [site] = await api.db
      .select({ settings: sites.settings })
      .from(sites)
      .where(eq(sites.id, demoSiteId))
    const before = site?.settings ?? {}
    await api.db
      .update(sites)
      .set({ settings: { ...before, language: 'pl', futureField: 1 } })
      .where(eq(sites.id, demoSiteId))
    try {
      const view = await saved(await read())
      expect(view.settings.language).toBe('ru')
      // Сохранение другого поля не стирает записанное более новой версией
      await saved(await patch({ description: 'После отката' }))
      const [after] = await api.db
        .select({ settings: sites.settings })
        .from(sites)
        .where(eq(sites.id, demoSiteId))
      expect(after?.settings).toMatchObject({
        language: 'pl',
        futureField: 1,
        description: 'После отката',
      })
      // Сборка и 404 сайта тоже не падают
      expect((await app.request('/api/site/fallback/nothing')).status).toBe(404)
    } finally {
      await api.db.update(sites).set({ settings: before }).where(eq(sites.id, demoSiteId))
    }
  })

  it('картинка не из медиатеки сайта и редирект с адреса страницы — 409 у своих полей', async () => {
    const res = await patch({
      icon: '99999999-9999-4999-8999-999999999999',
      organization: { name: 'Ремонт', logo: '99999999-9999-4999-8999-999999999998' },
      redirects: [{ from: '/', to: '/x' }],
    })
    // Главная отсекается схемой раньше базы
    expect(res.status).toBe(400)

    const created = await app.request(`/api/sites/${demoSiteId}/pages`, {
      method: 'POST',
      headers: json(owner.headers),
      body: JSON.stringify({ slug: 'ceny', title: 'Цены' }),
    })
    expect(created.status).toBe(201)
    const conflict = await patch({
      icon: '99999999-9999-4999-8999-999999999999',
      organization: { name: 'Ремонт', logo: '99999999-9999-4999-8999-999999999998' },
      redirects: [
        { from: '/old', to: '/ceny' },
        { from: '/ceny/', to: '/old-price' },
      ],
    })
    expect(conflict.status).toBe(409)
    expect(await issues(conflict)).toEqual([
      { path: 'icon', message: expect.stringMatching(/медиатеке/) },
      { path: 'organization.logo', message: expect.stringMatching(/медиатеке/) },
      { path: 'redirects.1.from', message: expect.stringMatching(/страница «Цены»/) },
    ])
    await app.request(`/api/sites/${demoSiteId}/pages/ceny`, {
      method: 'DELETE',
      headers: owner.headers,
    })
  })
})

describe('картинки настроек', () => {
  it('стоят в снимке и в релизе, а удалить их из медиатеки нельзя', async () => {
    const icon = await uploadImage()
    const og = await uploadImage(1200, 630, '#ffcc00')
    await saved(await patch({ icon, ogImage: og, organization: { name: 'Ремонт', logo: og } }))

    const snapshot = (await (await app.request(`/api/site/snapshot`)).json()) as {
      site: { url: string | null; settings: SiteSettings }
      media: Record<string, unknown>
    }
    expect(snapshot.site.url).toBe('https://example.ru')
    expect(snapshot.site.settings).toMatchObject({ icon, ogImage: og })
    expect(Object.keys(snapshot.media)).toEqual(expect.arrayContaining([icon, og]))

    const removed = await app.request(`/api/sites/${demoSiteId}/media/${og}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(removed.status).toBe(409)
    expect(await removed.text()).toMatch(/картинка для соцсетей, логотип организации/)

    await saved(await patch({ ogImage: null, organization: {} }))
    const freed = await app.request(`/api/sites/${demoSiteId}/media/${og}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(freed.status).toBe(204)
  })

  it('иконка сайта: favicon.ico, apple-touch-icon и PNG для манифеста без входа', async () => {
    const icon = await uploadImage(300, 200, '#cc0000')
    await saved(await patch({ icon }))
    const file = (name: string) => app.request(`/api/sites/${demoSiteId}/icons/${name}`)

    const ico = await file('favicon.ico')
    expect(ico.status).toBe(200)
    expect(ico.headers.get('content-type')).toBe('image/x-icon')
    const icoBytes = new Uint8Array(await ico.arrayBuffer())
    // Заголовок ICO: 0, 1 (иконка), число картинок
    expect([...icoBytes.subarray(0, 6)]).toEqual([0, 0, 1, 0, ICO_SIZES.length, 0])

    for (const [name, size] of [
      ['apple-touch-icon.png', 180],
      ['icon-192.png', 192],
      ['icon-512.png', 512],
    ] as const) {
      const res = await file(name)
      expect(res.headers.get('content-type'), name).toBe('image/png')
      const meta = await sharp(new Uint8Array(await res.arrayBuffer())).metadata()
      expect([meta.width, meta.height], name).toEqual([size, size])
    }
    // apple-touch-icon — без прозрачности (iOS залил бы её чёрным), манифест — с прозрачными полями
    const apple = await sharp(
      new Uint8Array(await (await file('apple-touch-icon.png')).arrayBuffer()),
    ).stats()
    expect(apple.isOpaque).toBe(true)
    const manifest = await sharp(
      new Uint8Array(await (await file('icon-192.png')).arrayBuffer()),
    ).stats()
    expect(manifest.isOpaque).toBe(false)

    expect((await file('favicon.svg')).status).toBe(400)
    await saved(await patch({ icon: null }))
    expect((await file('favicon.ico')).status).toBe(404)
  })
})

describe('снимок для рендерера', () => {
  it('организация (телефон, ИНН) — в открытом снимке только при опубликованной главной', async () => {
    await saved(
      await patch({
        organization: { name: 'ИП Иванов', inn: '123456789012', phone: '+7 900 123-45-67' },
      }),
    )
    const organization = async () => {
      const res = await app.request('/api/site/snapshot')
      return ((await res.json()) as { site: { settings: SiteSettings } }).site.settings.organization
    }
    expect(await organization()).toMatchObject({ name: 'ИП Иванов', inn: '123456789012' })

    const main = and(eq(pages.siteId, demoSiteId), eq(pages.slug, 'index'))
    const [published] = await api.db.select().from(pages).where(main)
    if (!published) throw new Error('нет главной демо-сайта')
    await api.db
      .update(pages)
      .set({ published: null, publishedTitle: null, publishedAt: null })
      .where(main)
    try {
      expect(await organization()).toMatchObject({ name: '', inn: '', phone: '' })
      // Владелец в разделе «SEO» видит сохранённое как есть
      expect((await saved(await read())).settings.organization.inn).toBe('123456789012')
    } finally {
      const { published: content, publishedTitle, publishedAt } = published
      await api.db
        .update(pages)
        .set({ published: content, publishedTitle, publishedAt })
        .where(main)
      await saved(await patch({ organization: {} }))
    }
  })
})

describe('адреса сайта без файла (Caddy → API)', () => {
  const fallback = (path: string) => app.request(`/api/site/fallback${path}`)

  it('редирект из таблицы — 301 без входа, в любом написании адреса', async () => {
    await saved(
      await patch({
        redirects: [
          { from: '/old-price', to: '/ceny?from=old' },
          { from: '/старое', to: 'https://example.org/new' },
          { from: '/prices', to: '/цены' },
        ],
      }),
    )
    const res = await fallback('/old-price/')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/ceny?from=old')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    const encoded = await fallback('/%D1%81%D1%82%D0%B0%D1%80%D0%BE%D0%B5')
    expect(encoded.headers.get('location')).toBe('https://example.org/new')
    // В заголовке только ASCII: кириллица «куда» кодируется
    expect((await fallback('/prices')).headers.get('location')).toBe('/%D1%86%D0%B5%D0%BD%D1%8B')
    // utm-метки со старой ссылки не теряются; своя строка запроса «куда» — главнее
    expect((await fallback('/prices?utm_source=ya&utm_medium=cpc')).headers.get('location')).toBe(
      '/%D1%86%D0%B5%D0%BD%D1%8B?utm_source=ya&utm_medium=cpc',
    )
    expect((await fallback('/old-price?utm_source=ya')).headers.get('location')).toBe(
      '/ceny?from=old',
    )
    await saved(await patch({ redirects: [] }))
  })

  it('перевод строки в адресе (%0A, %0D) — тоже 404 со страницей сайта, а не «нужен вход»', async () => {
    notFound.page = '<!doctype html><title>Нет такой</title>'
    for (const path of ['/a%0Ab', '/a%0D%0Ab', '/%0A']) {
      const res = await fallback(path)
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).toBe(notFound.page)
    }
  })

  it('без редиректа — 404 со страницей 404 текущей версии сайта', async () => {
    notFound.page = '<!doctype html><title>Нет такой</title>'
    const res = await fallback('/nothing')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe(notFound.page)
  })

  it('заходы на адреса без файла не пишутся в лог API построчно', async () => {
    logged.length = 0
    await fallback('/wp-login.php')
    await app.request('/api/health')
    expect(logged.some((line) => line.includes('/api/health'))).toBe(true)
    expect(logged.some((line) => line.includes('fallback'))).toBe(false)
  })

  it('сайт ещё не собран — 404 с короткой страницей API', async () => {
    notFound.page = undefined
    const res = await fallback('/nothing')
    expect(res.status).toBe(404)
    const body = await res.text()
    expect(body).toContain('Страница не найдена')
    expect(body).toContain('noindex')
  })
})

describe('набор иконок', () => {
  it('редирект с файла иконки запрещён схемой: имена совпадают с набором', () => {
    for (const file of ICON_FILES) expect(SITE_ROOT_FILES).toContain(`/${file}`)
  })

  it('ICO: заголовок, записи и PNG по смещениям', () => {
    const images = [
      { size: 16, data: new Uint8Array([1, 2, 3]) },
      { size: 32, data: new Uint8Array([4, 5]) },
    ]
    const ico = icoFromPngs(images)
    const view = new DataView(ico.buffer)
    expect(view.getUint16(2, true)).toBe(1)
    expect(view.getUint16(4, true)).toBe(2)
    expect(view.getUint8(6)).toBe(16)
    expect(view.getUint32(6 + 8, true)).toBe(3)
    const firstOffset = view.getUint32(6 + 12, true)
    expect(firstOffset).toBe(6 + 16 * 2)
    expect([...ico.subarray(firstOffset, firstOffset + 3)]).toEqual([1, 2, 3])
    expect(view.getUint32(6 + 16 + 12, true)).toBe(firstOffset + 3)
    expect([...ico.subarray(firstOffset + 3)]).toEqual([4, 5])
  })

  it('кеш: тот же файл не обрабатывается дважды, сбой не запоминается', async () => {
    let renders = 0
    const icons = cachedIcons(async () => {
      renders += 1
      return new Uint8Array([renders])
    })
    const key = { mediaId: 'a', file: 'icon-192.png' as const, background: '#ffffff' }
    const original = async () => new Uint8Array([0])
    expect(await icons(key, original)).toEqual(new Uint8Array([1]))
    expect(await icons(key, original)).toEqual(new Uint8Array([1]))
    expect(renders).toBe(1)
    await expect(icons({ ...key, mediaId: 'b' }, async () => undefined)).rejects.toThrow()
    expect(await icons({ ...key, mediaId: 'b' }, original)).toEqual(new Uint8Array([2]))
  })
})

describe('cookie и согласие', () => {
  const legal = (document: string, headers: Headers = owner.headers) =>
    app.request(`${url}/legal-pages`, {
      method: 'POST',
      headers: json(headers),
      body: JSON.stringify({ document }),
    })
  const removePage = (slug: string) =>
    api.db.delete(pages).where(and(eq(pages.siteId, demoSiteId), eq(pages.slug, slug)))

  it('по умолчанию — согласие до аналитики; страница политики — только страница сайта', async () => {
    expect((await saved(await read())).settings.cookies).toEqual({
      mode: 'consent',
      look: 'card',
      text: '',
      policyPage: '',
    })
    const missing = await patch({ cookies: { policyPage: 'privacy' } })
    expect(missing.status).toBe(409)
    expect((await issues(missing)).map((issue) => issue.path)).toEqual(['cookies.policyPage'])

    requested.length = 0
    const view = await saved(await patch({ cookies: { look: 'bar', policyPage: 'index' } }))
    expect(view.settings.cookies).toMatchObject({ look: 'bar', policyPage: 'index' })
    expect(requested).toEqual([demoSiteId])
    await saved(await patch({ cookies: {} }))
  })

  it('политика из шаблона: черновик с реквизитами и включёнными сервисами, второй раз — 409', async () => {
    await saved(
      await patch({
        organization: { name: 'ИП Иванов', inn: '123456789012', email: 'info@example.ru' },
        analytics: { metrika: '98765432', ga4: '' },
      }),
    )
    try {
      const res = await legal('privacy')
      expect(res.status, await res.clone().text()).toBe(201)
      const page = (await res.json()) as {
        slug: string
        title: string
        draft: { blocks: { type: string; props: Record<string, string> }[] }
        published: unknown
      }
      expect(page).toMatchObject({ slug: 'privacy', title: 'Политика конфиденциальности' })
      expect(page.published).toBeNull()
      const text = JSON.stringify(page.draft)
      expect(text).toContain('проверьте с юристом')
      expect(text).toContain('ИП Иванов')
      expect(text).toContain('ИНН: 123456789012')
      expect(text).toContain('Яндекс Метрика')
      expect(text).not.toContain('Google Analytics')
      // На демо-сайте нет формы: про заявки политика не пишет
      expect(text).not.toContain('Заявки хранятся')

      const again = await legal('privacy')
      expect(again.status).toBe(409)
      expect(
        (await saved(await patch({ cookies: { policyPage: 'privacy' } }))).settings.cookies,
      ).toMatchObject({ policyPage: 'privacy' })
    } finally {
      await removePage('privacy')
      await saved(await patch({ organization: {}, analytics: {}, cookies: {} }))
    }
  })

  it('шаблоны знают про форму в черновике и Telegram; выключенный канал — не упоминают', async () => {
    const formPage = {
      blocks: [
        {
          id: 'lead',
          type: 'form',
          props: {
            title: 'Заявка',
            fields: [{ name: 'name', type: 'name', label: 'Имя' }],
            policyUrl: '/privacy',
          },
        },
      ],
    }
    const put = await app.request(`/api/sites/${demoSiteId}/pages/contacts`, {
      method: 'PUT',
      headers: json(owner.headers),
      body: JSON.stringify({ title: 'Контакты', content: formPage }),
    })
    expect(put.status, await put.clone().text()).toBe(200)
    const [recipient] = await api.db
      .insert(notificationRecipients)
      .values({ siteId: demoSiteId, channel: 'telegram', address: '-100123', events: ['lead.new'] })
      .returning()
    const draftOf = async (document: string) => {
      const res = await legal(document)
      expect(res.status, await res.clone().text()).toBe(201)
      return JSON.stringify(((await res.json()) as { draft: unknown }).draft)
    }
    try {
      const text = await draftOf('consent')
      expect(text).toContain('Согласие на обработку персональных данных')
      expect(text).toContain('Срок: 180 дней')
      expect(text).toContain('трансграничную передачу')
      // Форма пока только в черновике страницы — политика всё равно пишет про заявки
      const policy = await draftOf('privacy')
      expect(policy).toContain('Заявки хранятся на сервере Оператора')
      expect(policy).toContain('180 дней с момента получения заявки')
      expect(policy).toContain('Telegram (Telegram FZ-LLC, ОАЭ)')
      await removePage('consent')
      await removePage('privacy')

      // Канал Telegram выключен в «Уведомлениях»: заявки туда не уходят, документы о нём молчат
      await api.db.insert(notificationChannels).values({ kind: 'telegram', enabled: false })
      expect(await draftOf('consent')).not.toContain('Telegram')
      expect(await draftOf('privacy')).not.toContain('Telegram')
    } finally {
      await api.db.delete(notificationChannels).where(eq(notificationChannels.kind, 'telegram'))
      await removePage('consent')
      await removePage('privacy')
      await removePage('contacts')
      if (recipient) {
        await api.db
          .delete(notificationRecipients)
          .where(eq(notificationRecipients.id, recipient.id))
      }
    }
  })

  it('почта в шаблонах — как у отправки заявок (с письмом владельцам); ролики — если есть', async () => {
    const page = (fields: { name: string; type: string; label: string }[]) => ({
      blocks: [
        { id: 'lead', type: 'form', props: { title: 'Заявка', fields, policyUrl: '/privacy' } },
        {
          id: 'clip',
          type: 'video',
          props: { url: 'https://youtu.be/aqz-KE-bpKQ', title: 'Как мы работаем' },
        },
      ],
    })
    const save = async (fields: Parameters<typeof page>[0]) => {
      const put = await app.request(`/api/sites/${demoSiteId}/pages/contacts`, {
        method: 'PUT',
        headers: json(owner.headers),
        body: JSON.stringify({ title: 'Контакты', content: page(fields) }),
      })
      expect(put.status, await put.clone().text()).toBe(200)
    }
    await save([{ name: 'email', type: 'email', label: 'Почта' }])
    const policy = async () => {
      const res = await legal('privacy')
      expect(res.status, await res.clone().text()).toBe(201)
      await removePage('privacy')
      return JSON.stringify(((await res.json()) as { draft: unknown }).draft)
    }
    const staff = 'письма с уведомлением о заявке'
    const visitor = 'письмо-подтверждение заявки'
    // Токен бота в базе — только зашифрованным (проверка таблицы): подделка того же вида не
    // расшифровывается, как после смены MAIL_ENCRYPTION_KEY
    const sealed = `v1.${'0'.repeat(16)}.${'A'.repeat(16)}.${'A'.repeat(22)}.AAAA`
    if (!api.secretBox) throw new Error('тесту нужен ключ секретов')
    const token = api.secretBox.encrypt('123456:token', channelSecretContext('telegram'))
    const bot = { botId: 1, botUsername: 'averra_bot', botName: 'Бот', proxy: null }
    const [recipient] = await api.db
      .insert(notificationRecipients)
      .values({ siteId: demoSiteId, channel: 'email', address: 'sales@example.ru', events: [] })
      .returning()
    const [chat] = await api.db
      .insert(notificationRecipients)
      .values({ siteId: demoSiteId, channel: 'telegram', address: '-100123', events: ['lead.new'] })
      .returning()
    if (!recipient || !chat) throw new Error('нет получателей')
    try {
      // На заявки на почте никто не подписан, а Telegram без токена бота заявку не повезёт: она
      // уйдёт владельцам письмом (notify → ownerTargets). Подтверждение посетителю включено
      let text = await policy()
      expect(text).toContain(staff)
      expect(text).toContain(visitor)
      expect(text).toContain('YouTube (Google LLC, США) — плеер ролика')

      // Получателей нет вовсе — тоже письмо владельцам
      await api.db.delete(notificationRecipients).where(eq(notificationRecipients.id, chat.id))
      await api.db.update(sites).set({ leadConfirmation: false }).where(eq(sites.id, demoSiteId))
      text = await policy()
      expect(text).toContain(staff)
      expect(text).not.toContain(visitor)

      // Чат подписан, но токен бота не расшифровать: notify отправит заявку владельцам письмом
      await api.db.insert(notificationRecipients).values(chat)
      await api.db
        .insert(notificationChannels)
        .values({ kind: 'telegram', enabled: true, secretEncrypted: sealed, settings: bot })
      expect(await policy()).toContain(staff)

      // Токен читается, но бот не настроен (нет имени бота) — тоже письмо владельцам
      await api.db
        .update(notificationChannels)
        .set({ secretEncrypted: token, settings: {} })
        .where(eq(notificationChannels.kind, 'telegram'))
      expect(await policy()).toContain(staff)

      // Заявки забирает готовый Telegram, на почте подписчиков нет: письма не уходят
      await api.db
        .update(notificationChannels)
        .set({ settings: bot })
        .where(eq(notificationChannels.kind, 'telegram'))
      expect(await policy()).not.toContain('почтовый сервис')

      // Получатель на почте подписан на заявки — письма снова есть
      await api.db
        .update(notificationRecipients)
        .set({ events: ['lead.new'] })
        .where(eq(notificationRecipients.id, recipient.id))
      expect(await policy()).toContain(staff)

      // Почта выключена в «Уведомлениях»: письма сотрудникам не уходят
      await api.db.insert(notificationChannels).values({ kind: 'email', enabled: false })
      expect(await policy()).not.toContain('почтовый сервис')

      // Подтверждение включено, но в форме нет поля почты: посетителю писать некуда
      await api.db.delete(notificationChannels).where(eq(notificationChannels.kind, 'email'))
      await api.db.update(sites).set({ leadConfirmation: true }).where(eq(sites.id, demoSiteId))
      expect(await policy()).toContain(visitor)
      await save([{ name: 'phone', type: 'phone', label: 'Телефон' }])
      text = await policy()
      expect(text).not.toContain(visitor)
      expect(text).toContain(staff)
    } finally {
      await api.db
        .delete(notificationChannels)
        .where(inArray(notificationChannels.kind, ['email', 'telegram']))
      await api.db.update(sites).set({ leadConfirmation: true }).where(eq(sites.id, demoSiteId))
      await api.db
        .delete(notificationRecipients)
        .where(inArray(notificationRecipients.id, [recipient.id, chat.id]))
      await removePage('privacy')
      await removePage('contacts')
    }
  })

  it('шаблоны — только владельцу, токену API — 403; неизвестный документ — 400', async () => {
    for (const role of ['editor', 'client'] as const) {
      const { headers } = await api.loginAs(role)
      expect((await legal('privacy', headers)).status, role).toBe(403)
    }
    const { token } = await api.createToken()
    expect((await legal('privacy', { authorization: `Bearer ${token}` })).status).toBe(403)
    expect((await legal('terms')).status).toBe(400)
  })

  it('в снимке для рендерера — настройки уведомления', async () => {
    await saved(await patch({ cookies: { mode: 'notice', look: 'modal' } }))
    try {
      const res = await app.request('/api/site/snapshot')
      const snapshot = (await res.json()) as { site: { settings: SiteSettings } }
      expect(snapshot.site.settings.cookies).toMatchObject({ mode: 'notice', look: 'modal' })
    } finally {
      await saved(await patch({ cookies: {} }))
    }
  })
})
