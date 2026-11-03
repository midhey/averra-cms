import { afterAll, describe, expect, it } from 'vitest'
import { createTestApi } from '../../testing'

// Раздел «Доступ для ИИ»: маршруты /api/tokens настоящими запросами — кто может, что отдаётся,
// и как права токена ограничивают его в остальном API

const api = await createTestApi()
const { app, demoSiteId } = api
afterAll(api.close)

type Headers = Record<string, string>
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

const owner = await api.loginAs('owner')
const editor = await api.loginAs('editor')
const client = await api.loginAs('client')

const tokens = {
  list: (headers: Headers) => app.request('/api/tokens', { headers }),
  create: (headers: Headers, body: unknown) =>
    app.request('/api/tokens', {
      method: 'POST',
      headers: json(headers),
      body: JSON.stringify(body),
    }),
  rights: (headers: Headers, id: string, body: unknown) =>
    app.request(`/api/tokens/${id}`, {
      method: 'PATCH',
      headers: json(headers),
      body: JSON.stringify(body),
    }),
  revoke: (headers: Headers, id: string) =>
    app.request(`/api/tokens/${id}`, { method: 'DELETE', headers }),
}

type Item = {
  id: string
  name: string
  rights: { blocksDraft: boolean; publish: boolean; delete: boolean }
  createdBy: string | null
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}
type Created = Item & { token: string }

async function issue(body: unknown = { name: 'Claude Code' }) {
  const res = await tokens.create(owner.headers, body)
  expect(res.status).toBe(201)
  return (await res.json()) as Created
}

const listed = async (id: string) =>
  ((await (await tokens.list(owner.headers)).json()) as Item[]).find((token) => token.id === id)

const page = (slug: string) => `/api/sites/${demoSiteId}/pages/${slug}`
const missingId = '00000000-0000-4000-8000-000000000000'

describe('кто управляет токенами', () => {
  it('владелец — да; редактор, клиент и токен — 403, токен не выпускает себе новый', async () => {
    expect((await tokens.list(owner.headers)).status).toBe(200)
    const { id, token } = await issue()

    for (const who of [editor.headers, client.headers, bearer(token)]) {
      expect((await tokens.list(who)).status).toBe(403)
      expect((await tokens.create(who, { name: 'ещё' })).status).toBe(403)
      expect((await tokens.rights(who, id, { publish: true })).status).toBe(403)
      expect((await tokens.revoke(who, id)).status).toBe(403)
    }
    const fromToken = await tokens.create(bearer(token), { name: 'ещё' })
    expect(await fromToken.json()).toMatchObject({
      error: { code: 'forbidden', message: expect.stringMatching(/владелец в админке/) },
    })
    const fromEditor = await tokens.list(editor.headers)
    expect(await fromEditor.json()).toMatchObject({
      error: { message: 'Токены API выпускает и отзывает только владелец' },
    })
    // Ни права, ни отзыв не прошли
    const item = await listed(id)
    expect(item?.rights.publish).toBe(false)
    expect(item?.revokedAt).toBeNull()
  })

  it('без входа — 401', async () => {
    expect((await tokens.list({})).status).toBe(401)
  })
})

describe('выпуск, список, права, отзыв', () => {
  it('выпуск: по умолчанию «только черновики», автор — владелец, токен в ответе один раз', async () => {
    const created = await issue({ name: '  Claude Code Алексея  ' })
    expect(created).toMatchObject({
      name: 'Claude Code Алексея',
      rights: { blocksDraft: true, publish: false, delete: false },
      createdBy: owner.user.name,
      lastUsedAt: null,
      revokedAt: null,
    })
    expect(created.token).toMatch(new RegExp(`^cms_${created.id}_[0-9a-f]{64}$`))

    // Список: тот же токен без секрета и хеша — показать его второй раз неоткуда
    const text = await (await tokens.list(owner.headers)).text()
    expect(text).not.toContain(created.token.slice(-64))
    expect(text).not.toContain('tokenHash')
    const [first] = JSON.parse(text) as Item[]
    const { token: _secret, ...view } = created
    expect(first).toEqual(view)
  })

  it('выпуск с правами; кривое имя и лишнее поле — 400 с путём до поля', async () => {
    const all = await issue({ name: 'всё', rights: { publish: true, delete: true } })
    expect(all.rights).toEqual({ blocksDraft: true, publish: true, delete: true })

    const empty = await tokens.create(owner.headers, { name: '   ' })
    expect(empty.status).toBe(400)
    expect(await empty.json()).toMatchObject({
      error: { issues: [{ path: 'name', message: 'Введите имя токена' }] },
    })
    expect((await tokens.create(owner.headers, { name: 'a\nb' })).status).toBe(400)
    const extra = await tokens.create(owner.headers, { name: 'a', rights: { admin: true } })
    expect(extra.status).toBe(400)
  })

  it('последнее использование видно в списке', async () => {
    const created = await issue()
    await app.request(page('index'), { headers: bearer(created.token) })
    expect((await listed(created.id))?.lastUsedAt).toEqual(expect.any(String))
  })

  it('права меняются по одному; пустая правка — 400, чужой id — 404', async () => {
    const created = await issue()
    const res = await tokens.rights(owner.headers, created.id, { publish: true })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Item).rights).toEqual({
      blocksDraft: true,
      publish: true,
      delete: false,
    })
    expect((await tokens.rights(owner.headers, created.id, {})).status).toBe(400)
    expect((await tokens.rights(owner.headers, missingId, { publish: true })).status).toBe(404)
    expect((await tokens.revoke(owner.headers, missingId)).status).toBe(404)
  })

  it('отзыв: 204, токен больше не пускают (401), права отозванному не меняются', async () => {
    const created = await issue()
    const read = () => app.request(page('index'), { headers: bearer(created.token) })
    expect((await read()).status).toBe(200)
    expect((await tokens.revoke(owner.headers, created.id)).status).toBe(204)
    expect((await tokens.revoke(owner.headers, created.id)).status).toBe(204)
    expect((await read()).status).toBe(401)
    expect((await tokens.rights(owner.headers, created.id, { publish: true })).status).toBe(409)
    expect((await listed(created.id))?.revokedAt).toEqual(expect.any(String))
  })
})

describe('права токена в API', () => {
  it('«только черновики»: создаёт и сохраняет страницу, но не публикует, не собирает и не удаляет', async () => {
    const { token, id } = await issue()
    const headers = bearer(token)
    const slug = 'tolko-chernoviki'
    const created = await app.request(`/api/sites/${demoSiteId}/pages`, {
      method: 'POST',
      headers: json(headers),
      body: JSON.stringify({ slug, title: 'Черновик' }),
    })
    expect(created.status).toBe(201)
    const saved = await app.request(page(slug), {
      method: 'PUT',
      headers: json(headers),
      body: JSON.stringify({ title: 'Черновик', content: { blocks: [] } }),
    })
    expect(saved.status).toBe(200)

    const publish = () => app.request(`${page(slug)}/publish`, { method: 'POST', headers })
    const remove = () => app.request(page(slug), { method: 'DELETE', headers })
    const denied = await publish()
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({
      error: {
        message: expect.stringMatching(/Публиковать этому токену не разрешено.*Доступ для ИИ/),
      },
    })
    const rebuild = await app.request(`/api/sites/${demoSiteId}/build`, {
      method: 'POST',
      headers,
    })
    expect(rebuild.status).toBe(403)
    expect((await remove()).status).toBe(403)
    const media = await app.request(`/api/sites/${demoSiteId}/media/${missingId}`, {
      method: 'DELETE',
      headers,
    })
    expect(media.status).toBe(403)
    expect(await media.json()).toMatchObject({
      error: { message: expect.stringMatching(/Удалять картинки этому токену не разрешено/) },
    })

    // Владелец включает публикацию — действует сразу, тем же токеном
    await tokens.rights(owner.headers, id, { publish: true })
    expect((await publish()).status).toBe(200)
    expect((await remove()).status).toBe(403)
    await tokens.rights(owner.headers, id, { delete: true })
    expect((await remove()).status).toBe(204)
  })

  it('свои блоки: черновик — по праву, а опубликовать и удалить блок нельзя и со всеми правами', async () => {
    const { token } = await issue({ name: 'всё', rights: { publish: true, delete: true } })
    const headers = bearer(token)
    const base = `/api/sites/${demoSiteId}/custom-blocks`
    const created = await app.request(base, {
      method: 'POST',
      headers: json(headers),
      body: JSON.stringify({ key: 'ot-tokena', title: 'От токена' }),
    })
    expect(created.status).toBe(201)
    const publish = await app.request(`${base}/ot-tokena/publish`, {
      method: 'POST',
      headers: json(headers),
      body: JSON.stringify({}),
    })
    expect(publish.status).toBe(403)
    const remove = await app.request(`${base}/ot-tokena`, { method: 'DELETE', headers })
    expect(remove.status).toBe(403)

    const noBlocks = await issue({ name: 'без блоков', rights: { blocksDraft: false } })
    const denied = await app.request(base, {
      method: 'POST',
      headers: json(bearer(noBlocks.token)),
      body: JSON.stringify({ key: 'bez-prava', title: 'Без права' }),
    })
    expect(denied.status).toBe(403)
  })
})
