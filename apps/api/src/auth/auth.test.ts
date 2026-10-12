import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { sessions } from '../db/schema'
import { createTestApi, TEST_PASSWORD, testOrigins } from '../testing'

// Вход, выход, cookie и закрытость API — через настоящие HTTP-запросы к app,
// как их шлёт админка: эндпоинты Better Auth, лимит попыток, проверка Origin

const api = await createTestApi()
const { app, demoSiteId } = api
const owner = await api.createUser('owner', 'Анна Владелец')

afterAll(api.close)

let ipCounter = 0
/** Свой IP на тест: лимит попыток входа считается по IP, тесты не должны делить его */
const freshIp = () => `203.0.113.${++ipCounter}`

function signIn(email: string, password: string, ip = freshIp()) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: testOrigins.admin,
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ email, password }),
  })
}

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')

describe('вход', () => {
  it('ставит httpOnly-cookie с SameSite=Lax, без Secure вне прода', async () => {
    const res = await signIn(owner.email, TEST_PASSWORD)
    expect(res.status).toBe(200)
    const [cookie] = res.headers.getSetCookie()
    expect(cookie).toMatch(/^better-auth\.session_token=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).not.toMatch(/Secure/i)

    const me = await app.request('/api/me', { headers: { cookie: cookieOf(res) } })
    expect(await me.json()).toEqual({
      kind: 'user',
      user: { id: owner.id, name: 'Анна Владелец', email: owner.email, role: 'owner' },
    })
  })

  it('в проде cookie только по HTTPS (Secure и префикс __Secure-)', async () => {
    const prod = await createTestApi({ production: true })
    try {
      const user = await prod.createUser('owner')
      const res = await prod.app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp() },
        body: JSON.stringify({ email: user.email, password: TEST_PASSWORD }),
      })
      expect(res.status).toBe(200)
      const [cookie] = res.headers.getSetCookie()
      expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/)
      expect(cookie).toMatch(/; Secure/i)
      expect(cookie).toMatch(/HttpOnly/i)
    } finally {
      await prod.close()
    }
  })

  it('почту принимает в любом регистре', async () => {
    const res = await signIn(owner.email.toUpperCase(), TEST_PASSWORD)
    expect(res.status).toBe(200)
  })

  it('неверный пароль — 401 в формате ApiError, по-русски, без cookie', async () => {
    const res = await signIn(owner.email, 'wrong-password-1')
    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie()).toEqual([])
    expect(await res.json()).toEqual({
      error: { code: 'invalid_email_or_password', message: 'Неверная почта или пароль' },
    })
  })

  it('неизвестная почта — тот же ответ, что и неверный пароль', async () => {
    const res = await signIn('nobody@example.test', TEST_PASSWORD)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_email_or_password' } })
  })

  it('лимит: четвёртая попытка за 10 секунд с одного IP — 429, другой IP не задет', async () => {
    const ip = freshIp()
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await signIn(owner.email, 'wrong-password-1', ip)).status).toBe(401)
    }
    // Даже с верным паролем: перебор остановлен, а не только неудачи
    const blocked = await signIn(owner.email, TEST_PASSWORD, ip)
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({
      error: { code: 'rate_limited', message: expect.stringMatching(/^Слишком много попыток/) },
    })

    expect((await signIn(owner.email, TEST_PASSWORD)).status).toBe(200)
  })

  it('регистрации с сайта нет', async () => {
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp() },
      body: JSON.stringify({ email: 'new@example.test', password: TEST_PASSWORD, name: 'Новый' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { code: 'email_password_sign_up_disabled' },
    })
    expect((await signIn('new@example.test', TEST_PASSWORD)).status).toBe(401)
  })

  it('роль через эндпоинты Better Auth не поменять', async () => {
    const member = await api.loginAs('client')
    const res = await app.request('/api/auth/update-user', {
      method: 'POST',
      headers: { ...member.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: { code: 'field_not_allowed', message: 'Это поле так поменять нельзя' },
    })
    const me = await app.request('/api/me', { headers: member.headers })
    expect(await me.json()).toMatchObject({ user: { role: 'member' } })
  })

  it('смена почты закрыта — ответ по-русски, код Better Auth как есть', async () => {
    const member = await api.loginAs('client')
    const res = await app.request('/api/auth/change-email', {
      method: 'POST',
      headers: { ...member.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ newEmail: 'other@example.test' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: { code: 'change_email_disabled', message: 'Почту сменить нельзя' },
    })
  })

  it('неизвестный эндпоинт под /api/auth — 404 «Не найдено», а не «Ошибка входа»', async () => {
    const res = await app.request('/api/auth/no-such-endpoint', {
      headers: { 'x-forwarded-for': freshIp() },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Не найдено' } })
  })
})

describe('продление сессии', () => {
  it('Better Auth продлевает сессию, и новая cookie доходит до браузера через наш маршрут', async () => {
    const { user, headers } = await api.loginAs('owner')
    // Сессия выдана двое суток назад: срок 7 дней, Better Auth продлевает раз в сутки
    const day = 24 * 60 * 60 * 1000
    const expiresAt = new Date(Date.now() + 5 * day)
    await api.db.update(sessions).set({ expiresAt }).where(eq(sessions.userId, user.id))

    const res = await app.request('/api/sites', { headers })
    expect(res.status).toBe(200)
    const [cookie] = res.headers.getSetCookie()
    expect(cookie).toMatch(/^better-auth\.session_token=/)
    expect(cookie).toMatch(/Max-Age=604800/)
    const [row] = await api.db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * day)

    // Свежая сессия cookie не трогает
    const again = await app.request('/api/sites', { headers })
    expect(again.headers.getSetCookie()).toEqual([])
  })

  it('протухшая сессия — 401, и cookie стирается', async () => {
    const { user, headers } = await api.loginAs('owner')
    await api.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, user.id))
    const res = await app.request('/api/sites', { headers })
    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie().join('\n')).toMatch(/better-auth\.session_token=;.*Max-Age=0/)
  })
})

describe('выход', () => {
  it('гасит сессию: старая cookie больше не пускает', async () => {
    const { headers } = await api.loginAs('owner')
    expect((await app.request('/api/me', { headers })).status).toBe(200)

    const res = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    expect((await app.request('/api/me', { headers })).status).toBe(401)
  })
})

describe('без входа', () => {
  const siteId = demoSiteId
  const json = { 'content-type': 'application/json' }
  const draft = JSON.stringify({ title: 'Взлом', content: { blocks: [] } })
  const closed: [string, string, RequestInit?][] = [
    ['GET', '/api/me'],
    ['GET', '/api/sites'],
    ['POST', '/api/sites', { headers: json, body: JSON.stringify({ name: 'Чужой' }) }],
    ['GET', `/api/sites/${siteId}`],
    ['GET', `/api/sites/${siteId}/pages`],
    ['POST', `/api/sites/${siteId}/pages`, { headers: json, body: '{"slug":"x","title":"X"}' }],
    ['GET', `/api/sites/${siteId}/pages/index`],
    ['PUT', `/api/sites/${siteId}/pages/index`, { headers: json, body: draft }],
    ['POST', `/api/sites/${siteId}/pages/index/publish`],
    ['DELETE', `/api/sites/${siteId}/pages/index`],
  ]

  it.each(closed)('%s %s — 401 в формате ApiError', async (method, path, init) => {
    const res = await app.request(path, { method, ...init })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Нужно войти' } })
  })

  it('снимок сайта открыт: опубликованное и так публично', async () => {
    const res = await app.request(`/api/sites/${siteId}/snapshot`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ site: { id: siteId }, pages: [{ slug: 'index' }] })
  })

  it('выдуманная cookie — тоже 401', async () => {
    const res = await app.request('/api/sites', {
      headers: { cookie: 'better-auth.session_token=forged.signature' },
    })
    expect(res.status).toBe(401)
  })
})

describe('изменяющие запросы с cookie', () => {
  const put = (headers: Record<string, string>) =>
    app.request(`/api/sites/${demoSiteId}/pages/csrf`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'CSRF', content: { blocks: [] } }),
    })

  it('с чужим Origin или без него — 403, страница не создаётся', async () => {
    const { headers } = await api.loginAs('owner')
    const evil = await put({ cookie: headers.cookie, origin: 'https://evil.example' })
    expect(evil.status).toBe(403)
    expect(await evil.json()).toMatchObject({ error: { code: 'forbidden' } })
    expect((await put({ cookie: headers.cookie })).status).toBe(403)

    const page = await app.request(`/api/sites/${demoSiteId}/pages/csrf`, { headers })
    expect(page.status).toBe(404)
  })

  it('из админки — проходят', async () => {
    const { headers } = await api.loginAs('owner')
    expect((await put(headers)).status).toBe(200)
  })

  it('чтение с cookie Origin не требует', async () => {
    const { headers } = await api.loginAs('owner')
    const res = await app.request('/api/sites', { headers: { cookie: headers.cookie } })
    expect(res.status).toBe(200)
  })
})
