import {
  defaultTheme,
  demoSiteId,
  legacyTheme,
  readTheme,
  Theme,
  themePresets,
} from '@averra/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sites } from '../../db/schema'
import type { SitePublisher } from '../../publish/queue'
import { createTestApi } from '../../testing'

// Тема сайта: черновик (PUT), публикация (POST /publish) с пересборкой, контраст как в админке,
// права и совместимость с темой в прежнем формате

type Headers = Record<string, string>
type View = { draft: Theme; published: Theme; unpublished: boolean }

const requested: string[] = []
const publisher: SitePublisher = {
  request: async (siteId) => {
    requested.push(siteId)
  },
}
const api = await createTestApi({ publisher })
afterAll(api.close)
const { app, db } = api

const owner = await api.loginAs('owner')
const url = `/api/sites/${demoSiteId}/theme`
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })
const read = (headers: Headers = owner.headers) => app.request(url, { headers })
const save = (body: unknown, headers: Headers = owner.headers) =>
  app.request(url, { method: 'PUT', headers: json(headers), body: JSON.stringify(body) })
const publish = (headers: Headers = owner.headers) =>
  app.request(`${url}/publish`, { method: 'POST', headers })

async function ok(res: Response) {
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as View
}

const issues = async (res: Response) =>
  ((await res.json()) as { error: { issues: { path: string; message: string }[] } }).error.issues

const preset = (id: string) => {
  const found = themePresets.find((item) => item.id === id)
  if (!found) throw new Error(`Нет темы ${id}`)
  return found.theme
}

/** Сайт как до редактора тем: только прежняя колонка theme */
async function resetToLegacy(theme: unknown = legacyTheme(defaultTheme)) {
  await db
    .update(sites)
    .set({ theme: theme as never, themePublished: null, themeDraft: null })
    .where(eq(sites.id, demoSiteId))
}

beforeEach(async () => {
  await resetToLegacy()
  requested.length = 0
})

describe('тема в прежнем формате', () => {
  it('сайт до редактора тем читается без потерь: те же цвета, линии из текста и фона', async () => {
    await resetToLegacy({
      ...legacyTheme(defaultTheme),
      fonts: { heading: 'serif', body: 'humanist' },
      radius: 'large',
    })
    const view = await ok(await read())
    expect(view.published.colors).toMatchObject(legacyTheme(defaultTheme).colors)
    expect(view.published.colors.border).toBe(defaultTheme.colors.border)
    expect(view.published.fonts).toEqual({ heading: 'serif', body: 'humanist' })
    expect(view.published.radius).toBe('large')
    expect(view.draft).toEqual(view.published)
    expect(view.unpublished).toBe(false)
  })

  it('снимок для сборки и сайт для админки отдают тему в новом формате', async () => {
    const snapshot = await app.request(`/api/sites/${demoSiteId}/snapshot`)
    const { site } = (await snapshot.json()) as { site: { theme: Theme } }
    expect(Theme.safeParse(site.theme).success).toBe(true)
    const res = await app.request(`/api/sites/${demoSiteId}`, { headers: owner.headers })
    expect(((await res.json()) as { theme: Theme }).theme).toEqual(site.theme)
  })
})

describe('черновик и публикация', () => {
  it('сохранение меняет только черновик: сайт и снимок прежние, сборки нет', async () => {
    const view = await ok(await save(preset('night')))
    expect(view.draft).toEqual(preset('night'))
    expect(view.published).toEqual(defaultTheme)
    expect(view.unpublished).toBe(true)
    expect(requested).toEqual([])
    const snapshot = await app.request(`/api/sites/${demoSiteId}/snapshot`)
    expect(((await snapshot.json()) as { site: { theme: Theme } }).site.theme).toEqual(defaultTheme)
  })

  it('публикация: черновик — на сайт, проекция — в прежнюю колонку, сайт пересобирается', async () => {
    await ok(await save(preset('warm')))
    const view = await ok(await publish())
    expect(view.published).toEqual(preset('warm'))
    expect(view.draft).toEqual(preset('warm'))
    expect(view.unpublished).toBe(false)
    expect(requested).toEqual([demoSiteId])

    const [row] = await db.select().from(sites).where(eq(sites.id, demoSiteId))
    expect(row?.themeDraft).toBeNull()
    // Прежняя версия API строго проверяет старую схему: без линий, шрифты — системные
    expect(row?.theme).toEqual(legacyTheme(preset('warm')))
    expect(row?.theme.fonts).toEqual({ heading: 'serif', body: 'system' })
    expect(readTheme(row?.theme).colors.accent).toBe(preset('warm').colors.accent)

    const snapshot = await app.request(`/api/sites/${demoSiteId}/snapshot`)
    expect(((await snapshot.json()) as { site: { theme: Theme } }).site.theme).toEqual(
      preset('warm'),
    )
  })

  it('без радиуса — средние скругления, как в схеме', async () => {
    const { radius: _radius, ...withoutRadius } = preset('fresh')
    expect((await ok(await save(withoutRadius))).draft.radius).toBe('medium')
  })
})

describe('контраст', () => {
  it('непроходящий акцент не сохраняется: 400 с путём до цвета и цифрами', async () => {
    const pale = { ...defaultTheme, colors: { ...defaultTheme.colors, accent: '#ffe066' } }
    const res = await save(pale)
    expect(res.status).toBe(400)
    const found = await issues(res)
    expect(found).toContainEqual({
      path: 'colors.accent',
      message: 'Акцент на фоне (ссылки): контраст 1,3 — нужно не меньше 3,0',
    })
    // Ничего не записано
    expect((await ok(await read())).unpublished).toBe(false)
  })

  it('бледный приглушённый текст на поверхности (блок «Призыв») — 400', async () => {
    const theme = { ...defaultTheme, colors: { ...defaultTheme.colors, surface: '#c4c8d0' } }
    const res = await save(theme)
    expect(res.status).toBe(400)
    expect((await issues(res)).map((issue) => issue.path)).toEqual(['colors.muted'])
  })

  it('акцент, плохо заметный на поверхности (рамка фокуса, кнопки), — 400', async () => {
    const colors = {
      background: '#111111',
      surface: '#222222',
      text: '#ffffff',
      muted: '#bbbbbb',
      accent: '#636363',
      onAccent: '#ffffff',
      border: '#333333',
    }
    const res = await save({ ...defaultTheme, colors })
    expect(res.status).toBe(400)
    expect((await issues(res)).map((issue) => issue.path)).toEqual(['colors.accent'])
  })

  it.each(['#ffffff;}body{display:none', '#fff}</style><script>'])(
    'цвет с решёткой и CSS после неё (%s) — 400, в черновик не попадает',
    async (value) => {
      const res = await save({ ...defaultTheme, colors: { ...defaultTheme.colors, accent: value } })
      expect(res.status).toBe(400)
      expect((await issues(res)).map((issue) => issue.path)).toEqual(['colors.accent'])
      expect((await ok(await read())).draft.colors.accent).not.toBe(value)
    },
  )

  it('старая тема с плохим контрастом не публикуется как есть — сначала поправить', async () => {
    await resetToLegacy({
      ...legacyTheme(defaultTheme),
      colors: { ...legacyTheme(defaultTheme).colors, muted: '#cccccc' },
    })
    const res = await publish()
    expect(res.status).toBe(400)
    // Приглушённый не проходит ни на фоне, ни на поверхности: две ошибки у одного поля
    expect((await issues(res)).map((issue) => issue.path)).toEqual(['colors.muted', 'colors.muted'])
    expect(requested).toEqual([])
  })

  it('шрифт не из каталога и цвет не #RRGGBB — 400', async () => {
    const font = { ...defaultTheme, fonts: { heading: 'Comic Sans', body: 'system' } }
    expect((await save(font)).status).toBe(400)
    const color = { ...defaultTheme, colors: { ...defaultTheme.colors, text: 'black' } }
    expect((await save(color)).status).toBe(400)
  })
})

describe('права', () => {
  it('меняют владелец и редактор; клиент — только читает', async () => {
    const editor = await api.loginAs('editor')
    expect((await save(preset('calm'), editor.headers)).status).toBe(200)
    expect((await publish(editor.headers)).status).toBe(200)

    const client = await api.loginAs('client')
    expect((await read(client.headers)).status).toBe(200)
    const denied = await save(preset('fresh'), client.headers)
    expect(denied.status).toBe(403)
    expect((await publish(client.headers)).status).toBe(403)
  })

  it('токен API тему читает, но не меняет', async () => {
    const { token } = await api.createToken()
    const bearer = { authorization: `Bearer ${token}` }
    expect((await read(bearer)).status).toBe(200)
    const res = await save(preset('fresh'), bearer)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { message: 'Тему сайта меняют в админке: токену API она доступна только для чтения' },
    })
    expect((await publish(bearer)).status).toBe(403)
  })

  it('без входа — 401, чужой сайт — 404', async () => {
    expect((await app.request(url)).status).toBe(401)
    const other = await api.createSite()
    const editor = await api.loginAs('editor')
    const res = await app.request(`/api/sites/${other}/theme`, { headers: editor.headers })
    expect(res.status).toBe(404)
  })
})
