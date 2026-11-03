import { afterAll, describe, expect, it } from 'vitest'
import { createTestApi, TEST_PASSWORD, testOrigins } from '../../testing'

// Свой профиль: имя, входы на других устройствах и смена пароля из админки

const api = await createTestApi()
const { app } = api
afterAll(api.close)

type Headers = Record<string, string>
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })

const rename = (headers: Headers, name: unknown) =>
  app.request('/api/me', {
    method: 'PATCH',
    headers: json(headers),
    body: JSON.stringify({ name }),
  })
const others = async (headers: Headers) =>
  ((await (await app.request('/api/me/sessions', { headers })).json()) as { others: number }).others
const revokeOthers = (headers: Headers) =>
  app.request('/api/me/sessions/revoke-others', { method: 'POST', headers })
const me = (headers: Headers) => app.request('/api/me', { headers })

describe('имя', () => {
  it('меняется и сразу видно в /api/me; с переводом строки и пустое — 400', async () => {
    const { headers } = await api.loginAs('client')
    const res = await rename(headers, '  Мария Петрова  ')
    expect(res.status).toBe(200)
    expect(await (await me(headers)).json()).toMatchObject({ user: { name: 'Мария Петрова' } })
    expect((await rename(headers, 'Мария\nПетрова')).status).toBe(400)
    expect((await rename(headers, '   ')).status).toBe(400)
  })

  it('без входа — 401, токен — 403, не из админки — 403', async () => {
    expect((await rename({}, 'Кто-то')).status).toBe(401)
    const { token } = await api.createToken()
    expect((await rename({ authorization: `Bearer ${token}` }, 'Токен')).status).toBe(403)
    const { headers } = await api.loginAs('editor')
    expect((await rename({ ...headers, origin: 'https://evil.example' }, 'Чужой')).status).toBe(403)
  })
})

describe('выйти на других устройствах', () => {
  it('другие входы гаснут, этот остаётся', async () => {
    const { user, headers } = await api.loginAs('editor')
    const second = await api.sessionHeaders(user.email)
    const third = await api.sessionHeaders(user.email)
    expect(await others(headers)).toBe(2)

    const res = await revokeOthers(headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revoked: 2 })
    expect((await me(headers)).status).toBe(200)
    for (const gone of [second, third]) expect((await me(gone)).status).toBe(401)
    expect(await others(headers)).toBe(0)
  })

  it('чужие входы не трогает', async () => {
    const one = await api.loginAs('editor')
    const two = await api.loginAs('editor')
    await revokeOthers(one.headers)
    expect((await me(two.headers)).status).toBe(200)
  })
})

describe('смена пароля', () => {
  it('текущий + новый: старый больше не подходит, другие входы завершены', async () => {
    const { user, headers } = await api.loginAs('client')
    const second = await api.sessionHeaders(user.email)
    const res = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: json(headers),
      body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: 'new-password-123' }),
    })
    expect(res.status).toBe(200)
    expect((await me(second)).status).toBe(401)
    const signIn = (password: string) =>
      app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: json({ origin: testOrigins.admin, 'x-forwarded-for': '203.0.113.7' }),
        body: JSON.stringify({ email: user.email, password }),
      })
    expect((await signIn(TEST_PASSWORD)).status).toBe(401)
    expect((await signIn('new-password-123')).status).toBe(200)
  })

  it('короткий новый пароль — 400 у поля', async () => {
    const { headers } = await api.loginAs('editor')
    const res = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: json(headers),
      body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: 'short' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { issues: [{ path: 'newPassword', message: 'Пароль — от 10 символов' }] },
    })
  })
})
