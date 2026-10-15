import { inspect } from 'node:util'
import { DrizzleQueryError, eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { DEV_AUTH_SECRET } from '../config'
import { sessions } from '../db/schema'
import { createTestApi, TEST_PASSWORD, testOrigins } from '../testing'
import { createAuth } from './auth'

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
  // Адрес страницы свой у каждого теста: тесты идут в любом порядке (--sequence.shuffle)
  const put = (headers: Record<string, string>, slug = 'csrf') =>
    app.request(`/api/sites/${demoSiteId}/pages/${slug}`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'CSRF', content: { blocks: [] } }),
    })

  it('с чужим Origin или без него — 403, страница не создаётся', async () => {
    const { headers } = await api.loginAs('owner')
    const evil = await put({ cookie: headers.cookie, origin: 'https://evil.example' }, 'csrf-evil')
    expect(evil.status).toBe(403)
    expect(await evil.json()).toMatchObject({ error: { code: 'forbidden' } })
    expect((await put({ cookie: headers.cookie }, 'csrf-evil')).status).toBe(403)

    const page = await app.request(`/api/sites/${demoSiteId}/pages/csrf-evil`, { headers })
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

describe('лог Better Auth', () => {
  it('сбой базы при письме сброса — в логе нет ни ссылки с токеном, ни параметров запроса', async () => {
    const own = await createTestApi({ resetResponseMs: 0 })
    const errors: string[] = []
    // Как это напечатала бы консоль: объекты — через inspect, со стеком и причинами
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(
        args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 10 }))).join(' '),
      )
    })
    try {
      const user = await own.createUser('member')
      // В тестах логи Better Auth выключены (quiet): здесь свой экземпляр с логом, как в index.ts
      const auth = createAuth({
        db: own.db,
        secret: DEV_AUTH_SECRET,
        baseURL: testOrigins.api,
        adminUrl: testOrigins.admin,
        secureCookies: false,
      })
      // Письмо сброса не ложится в очередь: CHECK, который не пропускает ни одной строки
      await own.db.execute(
        sql`alter table mail_outbox add constraint test_always_fails check (false)`,
      )
      // Better Auth ловит сбой sendResetPassword и пишет его в лог, а ответ не меняется
      await expect(
        auth.api.requestPasswordReset({ body: { email: user.email } }),
      ).resolves.toMatchObject({ status: true })

      const logged = errors.join('\n')
      // Строка — как у логгера Better Auth по умолчанию: время, уровень, источник
      expect(logged).toMatch(/Z ERROR \[Better Auth\]: Failed to run background task/)
      expect(logged).toContain('Запрос к базе не выполнен: insert into "mail_outbox"')
      // Ссылка из письма — рабочий токен сброса на час: её в логе быть не должно
      for (const secret of ['#token=', 'params:', 'Failing row', user.email]) {
        expect(logged).not.toContain(secret)
      }
    } finally {
      spy.mockRestore()
      await own.close()
    }
  })

  it('ошибка объектом вместо текста (так пишет list-sessions) — в логе без параметров, логгер не падает', async () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(
        args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 10 }))).join(' '),
      )
    })
    try {
      const auth = createAuth({
        db: api.db,
        secret: DEV_AUTH_SECRET,
        baseURL: testOrigins.api,
        adminUrl: testOrigins.admin,
        secureCookies: false,
      })
      const { logger } = await auth.$context
      const failure = new DrizzleQueryError(
        'select * from "sessions" where "user_id" = $1',
        ['SECRET-SESSION-TOKEN'],
        Object.assign(new Error('connection terminated'), { code: '57P01' }),
      )
      // Better Auth 1.7.7 сам передаёт ошибку первым аргументом: catch в GET /list-sessions
      // делает ctx.context.logger.error(e). Тип говорит «строка», на деле — объект
      expect(() => logger.error(failure as unknown as string)).not.toThrow()

      const logged = errors.join('\n')
      // Исходный сбой виден, а не TypeError из самого логгера
      expect(logged).toMatch(/Z ERROR \[Better Auth\]: Запрос к базе не выполнен: select/)
      expect(logged).toContain('connection terminated')
      expect(logged).not.toContain('TypeError')
      for (const secret of ['SECRET-SESSION-TOKEN', 'params:']) {
        expect(logged).not.toContain(secret)
      }
    } finally {
      spy.mockRestore()
    }
  })
})
