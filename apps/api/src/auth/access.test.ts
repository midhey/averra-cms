import { afterAll, describe, expect, it } from 'vitest'
import { createTestApi } from '../testing'
import { can, type SiteRole } from './access'

// Права ролей через настоящие запросы: каждый тест получает сессию нужной роли или токен
// из помощников createTestApi и проверяет, что API разрешает и что запрещает

const api = await createTestApi()
const { app, demoSiteId } = api

afterAll(api.close)

type Headers = Record<string, string>

const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })
const page = (siteId: string, slug: string) => `/api/sites/${siteId}/pages/${slug}`
const draft = (title: string) => JSON.stringify({ title, content: { blocks: [] } })

const request = {
  list: (headers: Headers) => app.request('/api/sites', { headers }),
  site: (headers: Headers, siteId = demoSiteId) => app.request(`/api/sites/${siteId}`, { headers }),
  pages: (headers: Headers, siteId = demoSiteId) =>
    app.request(`/api/sites/${siteId}/pages`, { headers }),
  get: (headers: Headers, slug = 'index', siteId = demoSiteId) =>
    app.request(page(siteId, slug), { headers }),
  save: (headers: Headers, slug: string, siteId = demoSiteId) =>
    app.request(page(siteId, slug), { method: 'PUT', headers: json(headers), body: draft(slug) }),
  create: (headers: Headers, slug: string, siteId = demoSiteId) =>
    app.request(`/api/sites/${siteId}/pages`, {
      method: 'POST',
      headers: json(headers),
      body: JSON.stringify({ slug, title: slug }),
    }),
  publish: (headers: Headers, slug = 'index', siteId = demoSiteId) =>
    app.request(`${page(siteId, slug)}/publish`, { method: 'POST', headers }),
  remove: (headers: Headers, slug: string, siteId = demoSiteId) =>
    app.request(page(siteId, slug), { method: 'DELETE', headers }),
  createSite: (headers: Headers, name: string) =>
    app.request('/api/sites', {
      method: 'POST',
      headers: json(headers),
      body: JSON.stringify({ name }),
    }),
  installation: (headers: Headers) => app.request('/api/site', { headers }),
}

const owner = await api.loginAs('owner')

/**
 * Ещё один сайт в базе со страницей extra — чужой для участников демо-сайта. API сайтов не
 * создаёт (одна установка — один сайт), но так бывает в старых базах, и изоляция по site_id
 * должна держаться
 */
async function otherSite(name: string) {
  const id = await api.createSite(name)
  await request.create(owner.headers, 'extra', id)
  return id
}

/** Страница на демо-сайте, созданная владельцем, — для проверок правки и удаления */
async function ownerPage(slug: string) {
  const res = await request.create(owner.headers, slug)
  if (res.status !== 201) throw new Error(`Страница не создалась: ${res.status}`)
}

describe('таблица разрешений', () => {
  const roles: SiteRole[] = ['owner', 'editor', 'client']
  it.each([
    ['site.read', [true, true, true]],
    ['page.edit', [true, true, true]],
    ['page.create', [true, true, false]],
    ['page.publish', [true, true, false]],
    ['page.delete', [true, true, false]],
    ['media.upload', [true, true, true]],
    ['media.delete', [true, true, false]],
    ['members.invite', [true, false, false]],
  ] as const)('%s: владелец, редактор, клиент → %j', (permission, expected) => {
    expect(roles.map((role) => can(role, permission))).toEqual(expected)
  })
})

describe('клиент', () => {
  it('читает сайт и правит черновик существующей страницы', async () => {
    await ownerPage('client-edit')
    const { headers } = await api.loginAs('client')
    expect((await request.site(headers)).status).toBe(200)
    expect(await (await request.site(headers)).json()).toMatchObject({ access: 'client' })
    expect((await request.pages(headers)).status).toBe(200)
    expect((await request.get(headers)).status).toBe(200)
    expect((await request.save(headers, 'client-edit')).status).toBe(200)
  })

  it('не публикует: 403 в формате ApiError, опубликованное не меняется', async () => {
    const { headers } = await api.loginAs('client')
    const res = await request.publish(headers)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'Публиковать может владелец или редактор сайта' },
    })
  })

  it('не удаляет страницы — 403, страница на месте', async () => {
    await ownerPage('client-delete')
    const { headers } = await api.loginAs('client')
    expect((await request.remove(headers, 'client-delete')).status).toBe(403)
    expect((await request.get(owner.headers, 'client-delete')).status).toBe(200)
  })

  it('не создаёт страниц: ни через POST (403), ни сохранением по новому адресу (404)', async () => {
    const { headers } = await api.loginAs('client')
    expect((await request.create(headers, 'client-new')).status).toBe(403)
    expect((await request.save(headers, 'client-new-put')).status).toBe(404)
    expect((await request.get(owner.headers, 'client-new-put')).status).toBe(404)
  })
})

describe('редактор', () => {
  it('создаёт, правит, публикует и удаляет страницы своего сайта', async () => {
    const { headers } = await api.loginAs('editor')
    expect(await (await request.site(headers)).json()).toMatchObject({ access: 'editor' })
    expect((await request.create(headers, 'editor-page')).status).toBe(201)
    expect((await request.save(headers, 'editor-page')).status).toBe(200)
    expect((await request.save(headers, 'editor-put')).status).toBe(200)
    expect((await request.publish(headers, 'editor-page')).status).toBe(200)
    expect((await request.remove(headers, 'editor-page')).status).toBe(204)
  })

  it('видит организацию из «SEO» для сверки «Контактов», а токен — нет', async () => {
    const organization = { name: 'ИП Иванов', phone: '+7 900 000-00-00', email: 'i@example.ru' }
    const saved = await app.request(`/api/sites/${demoSiteId}/settings`, {
      method: 'PATCH',
      headers: json(owner.headers),
      body: JSON.stringify({ organization }),
    })
    expect(saved.status).toBe(200)
    const { headers } = await api.loginAs('editor')
    // Саму «SEO → Организация» редактор не читает — только сверку в сайте
    expect((await app.request(`/api/sites/${demoSiteId}/settings`, { headers })).status).toBe(403)
    const seen = (await (await request.site(headers)).json()) as { seo: Record<string, unknown> }
    expect(seen.seo.organization).toMatchObject(organization)
    const { token } = await api.createToken()
    const bearer = { authorization: `Bearer ${token}` }
    const byToken = (await (await request.site(bearer)).json()) as { seo: Record<string, unknown> }
    expect(byToken.seo).not.toHaveProperty('organization')
  })
})

describe('создание сайтов', () => {
  it('в API его нет ни у кого: сайт установки создаёт API при первом запуске', async () => {
    const { headers } = await api.loginAs('editor')
    const { token } = await api.createToken()
    for (const who of [owner.headers, headers, { authorization: `Bearer ${token}` }]) {
      expect((await request.createSite(who, 'Свой сайт')).status).toBe(404)
    }
  })
})

describe('участник и чужой сайт', () => {
  it.each(['editor', 'client'] as const)(
    '%s видит чужой сайт как несуществующий — 404',
    async (role) => {
      const foreign = await otherSite(`Чужой для ${role}`)
      const { headers } = await api.loginAs(role)
      const notFound = { error: { code: 'not_found', message: 'Сайт не найден' } }
      for (const res of [
        await request.site(headers, foreign),
        await request.pages(headers, foreign),
        await request.get(headers, 'index', foreign),
        await request.save(headers, 'extra', foreign),
        await request.create(headers, 'new', foreign),
        await request.publish(headers, 'index', foreign),
        await request.remove(headers, 'extra', foreign),
      ]) {
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual(notFound)
      }
      // И ответ тот же, что на сайт, которого нет вовсе
      const missing = await request.site(headers, '00000000-0000-4000-8000-000000000000')
      expect(await missing.json()).toEqual(notFound)
    },
  )

  it('в списке сайтов только свои', async () => {
    const foreign = await otherSite('Чужой для списка')
    const { headers } = await api.loginAs('editor')
    const sites = (await (await request.list(headers)).json()) as { id: string }[]
    expect(sites.map((site) => site.id)).toEqual([demoSiteId])
    expect(sites.map((site) => site.id)).not.toContain(foreign)
  })

  it('без доступа к сайтам — пустой список', async () => {
    const user = await api.createUser('member')
    const headers = await api.sessionHeaders(user.email)
    expect(await (await request.list(headers)).json()).toEqual([])
  })

  it('доступ к двум сайтам — роль на каждом своя', async () => {
    const second = await otherSite('Второй сайт участника')
    const { user, headers } = await api.loginAs('client')
    await api.addMember(second, user.id, 'editor')
    expect((await request.publish(headers)).status).toBe(403)
    expect((await request.publish(headers, 'extra', second)).status).toBe(200)
    expect((await (await request.list(headers)).json()) as unknown[]).toHaveLength(2)
  })
})

describe('владелец', () => {
  it('видит все сайты и правит любой', async () => {
    const foreign = await otherSite('Сайт владельца')
    const { headers } = await api.loginAs('owner')
    const ids = ((await (await request.list(headers)).json()) as { id: string }[]).map((s) => s.id)
    expect(ids).toEqual(expect.arrayContaining([demoSiteId, foreign]))
    expect(await (await request.site(headers, foreign)).json()).toMatchObject({ access: 'owner' })
    expect((await request.publish(headers, 'extra', foreign)).status).toBe(200)
  })

  it('на несуществующий сайт — 404', async () => {
    const res = await request.site(owner.headers, '00000000-0000-4000-8000-000000000000')
    expect(res.status).toBe(404)
  })
})

describe('токен API', () => {
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

  it('работает как редактор своего сайта: черновик, публикация, удаление', async () => {
    const { token } = await api.createToken()
    expect((await request.save(bearer(token), 'by-token')).status).toBe(200)
    expect((await request.publish(bearer(token), 'by-token')).status).toBe(200)
    expect((await request.remove(bearer(token), 'by-token')).status).toBe(204)
    expect(await (await request.site(bearer(token))).json()).toMatchObject({ access: 'editor' })
  })

  it('список сайтов — только свой сайт', async () => {
    await otherSite('Чужой для токена')
    const { token } = await api.createToken()
    expect(await (await request.list(bearer(token))).json()).toEqual([
      { id: demoSiteId, name: expect.any(String) },
    ])
  })

  it('чужой сайт — 404, как у участника', async () => {
    const foreign = await otherSite('Чужой сайт для токена')
    const { token } = await api.createToken()
    expect((await request.get(bearer(token), 'index', foreign)).status).toBe(404)
    expect((await request.save(bearer(token), 'extra', foreign)).status).toBe(404)
  })

  it('токен чужого сайта не открывает демо-сайт', async () => {
    const foreign = await otherSite('Сайт со своим токеном')
    const { token } = await api.createToken(foreign)
    expect((await request.get(bearer(token), 'index', foreign)).status).toBe(200)
    expect((await request.get(bearer(token))).status).toBe(404)
  })

  it('отозванный — 401, хотя только что работал', async () => {
    const { id, token } = await api.createToken()
    expect((await request.get(bearer(token))).status).toBe(200)
    await api.revokeToken(id)
    const res = await request.get(bearer(token))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: { code: 'unauthorized', message: 'Токен API недействителен или отозван' },
    })
  })

  it('выдуманный или испорченный — 401', async () => {
    const { token } = await api.createToken()
    const spoiled = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`
    for (const value of [spoiled, 'cms_nope', 'garbage', '']) {
      expect((await request.get(bearer(value))).status).toBe(401)
    }
  })

  it('с неверным токеном на cookie не откатывается', async () => {
    const res = await request.get({ ...owner.headers, authorization: 'Bearer garbage' })
    expect(res.status).toBe(401)
  })

  it('изменяющим запросам Origin не нужен: у токена нет cookie, которую подставит браузер', async () => {
    const { token } = await api.createToken()
    const res = await request.save({ ...bearer(token), origin: 'https://evil.example' }, 'origin')
    expect(res.status).toBe(200)
  })

  it('GET /api/me отвечает, чей это токен', async () => {
    const { id, token } = await api.createToken()
    const res = await app.request('/api/me', { headers: bearer(token) })
    expect(await res.json()).toEqual({ kind: 'token', token: { id, siteId: demoSiteId } })
  })
})
