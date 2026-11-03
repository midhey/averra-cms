import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { users } from '../../db/schema'
import { createTestApi, TEST_PASSWORD, testOrigins } from '../../testing'
import { LastOwnerError, membersRepo } from './repo'

// Участники сайта настоящими запросами: список, смена роли, отключение (сессии гаснут, вход
// не пускает), возврат доступа, последний владелец, передача владения и кто кого может трогать

const api = await createTestApi()
const { app, demoSiteId } = api
afterAll(api.close)

type Headers = Record<string, string>
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })
const url = (path = '') => `/api/sites/${demoSiteId}/members${path}`

const list = async (headers: Headers) => {
  const res = await app.request(url(), { headers })
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as {
    id: string
    role: string | null
    status: string
    self: boolean
    email: string
    disabledRole: string | null
  }[]
}
const setRole = (headers: Headers, userId: string, role: string) =>
  app.request(url(`/${userId}`), {
    method: 'PATCH',
    headers: json(headers),
    body: JSON.stringify({ role }),
  })
const disable = (headers: Headers, userId: string) =>
  app.request(url(`/${userId}/disable`), { method: 'POST', headers })
const restore = (headers: Headers, userId: string, role: string) =>
  app.request(url(`/${userId}/restore`), {
    method: 'POST',
    headers: json(headers),
    body: JSON.stringify({ role }),
  })
const transfer = (headers: Headers, userId: string) =>
  app.request(url(`/${userId}/transfer`), { method: 'POST', headers })
const site = (headers: Headers) => app.request(`/api/sites/${demoSiteId}`, { headers })
const me = (headers: Headers) => app.request('/api/me', { headers })

let ipCount = 0
/** Вход по HTTP, как из админки: проверяет и то, что Better Auth пускает или нет */
const signIn = (email: string, password = TEST_PASSWORD) =>
  app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: json({ origin: testOrigins.admin, 'x-forwarded-for': `198.51.100.${++ipCount}` }),
    body: JSON.stringify({ email, password }),
  })

const owner = await api.loginAs('owner')

describe('доступ к разделу', () => {
  it('без входа — 401, редактор — 403, токен — 403', async () => {
    expect((await app.request(url())).status).toBe(401)
    const editor = await api.loginAs('editor')
    expect((await app.request(url(), { headers: editor.headers })).status).toBe(403)
    const { token } = await api.createToken()
    const bearer = { authorization: `Bearer ${token}` }
    expect((await app.request(url(), { headers: bearer })).status).toBe(403)
    expect((await setRole(bearer, editor.user.id, 'client')).status).toBe(403)
  })

  it('список: владельцы и участники с ролью и состоянием, «это вы» — у себя', async () => {
    const editor = await api.loginAs('editor')
    const client = await api.loginAs('client')
    const rows = await list(owner.headers)
    expect(rows.find((row) => row.id === owner.user.id)).toMatchObject({
      role: 'owner',
      status: 'active',
      self: true,
    })
    expect(rows.find((row) => row.id === editor.user.id)).toMatchObject({
      role: 'editor',
      self: false,
    })
    expect(rows.find((row) => row.id === client.user.id)).toMatchObject({ role: 'client' })
    // Администратор сайта видит тот же список
    expect((await list(client.headers)).length).toBe(rows.length)
  })
})

describe('смена роли', () => {
  it('владелец меняет роль, и API сразу решает по новой', async () => {
    const member = await api.loginAs('editor')
    const leadsOf = () => app.request(`/api/sites/${demoSiteId}/leads`, { headers: member.headers })
    expect((await leadsOf()).status).toBe(403)
    const res = await setRole(owner.headers, member.user.id, 'client')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ role: 'client', status: 'active' })
    // Та же сессия, без нового входа: роль читается из базы на каждом запросе
    expect(await (await site(member.headers)).json()).toMatchObject({ access: 'client' })
    expect((await leadsOf()).status).toBe(200)
  })

  it('второй владелец: ему открыта установка, строки участника нет', async () => {
    const member = await api.loginAs('client')
    expect((await setRole(owner.headers, member.user.id, 'owner')).status).toBe(200)
    expect(await (await me(member.headers)).json()).toMatchObject({ user: { role: 'owner' } })
    expect((await app.request('/api/tokens', { headers: member.headers })).status).toBe(200)
    // И обратно: второй владелец больше не владелец
    expect((await setRole(owner.headers, member.user.id, 'editor')).status).toBe(200)
    expect(await (await me(member.headers)).json()).toMatchObject({ user: { role: 'member' } })
    expect(await (await site(member.headers)).json()).toMatchObject({ access: 'editor' })
  })

  it('свою роль не поменять — 409; неизвестная роль — 400; чужой id — 404', async () => {
    const self = await setRole(owner.headers, owner.user.id, 'client')
    expect(self.status).toBe(409)
    expect(await self.json()).toMatchObject({
      error: { message: expect.stringContaining('передачей владения') },
    })
    const member = await api.loginAs('editor')
    expect((await setRole(owner.headers, member.user.id, 'admin')).status).toBe(400)
    expect((await setRole(owner.headers, crypto.randomUUID(), 'editor')).status).toBe(404)
  })

  it('администратор сайта не меняет ролей: ни редактора в администратора, ни себя', async () => {
    const admin = await api.loginAs('client')
    const editor = await api.loginAs('editor')
    const res = await setRole(admin.headers, editor.user.id, 'client')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: {
        code: 'forbidden',
        message: 'Администратор сайта управляет только редакторами. Остальных меняет владелец',
      },
    })
    const other = await api.loginAs('client')
    expect((await setRole(admin.headers, other.user.id, 'editor')).status).toBe(403)
    expect((await setRole(admin.headers, owner.user.id, 'editor')).status).toBe(403)
  })
})

describe('отключение', () => {
  it('сессии гаснут сразу, войти снова нельзя; вернуть доступ — входит с новой ролью', async () => {
    const member = await api.loginAs('client')
    // Второй браузер того же человека
    const second = await api.sessionHeaders(member.user.email)
    expect((await site(second)).status).toBe(200)

    const res = await disable(owner.headers, member.user.id)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'disabled', role: null })
    for (const headers of [member.headers, second]) {
      expect((await site(headers)).status).toBe(401)
    }
    const again = await signIn(member.user.email)
    expect(again.status).toBe(403)
    expect(await again.json()).toEqual({
      error: {
        code: 'account_disabled',
        message:
          'Доступ к админке отключён. Если это ошибка, попросите владельца установки (студию) вернуть его',
      },
    })
    // Роль к отключённому не применить, пока доступ не вернули
    expect((await setRole(owner.headers, member.user.id, 'editor')).status).toBe(409)

    expect((await restore(owner.headers, member.user.id, 'editor')).status).toBe(200)
    expect((await restore(owner.headers, member.user.id, 'editor')).status).toBe(409)
    const back = await signIn(member.user.email)
    expect(back.status).toBe(200)
    const cookie = back.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    expect(await (await site({ cookie })).json()).toMatchObject({ access: 'editor' })
  })

  it('администратор сайта отключает редактора, но не другого администратора и не владельца', async () => {
    const admin = await api.loginAs('client')
    const editor = await api.loginAs('editor')
    const other = await api.loginAs('client')
    expect((await disable(admin.headers, editor.user.id)).status).toBe(200)
    expect((await disable(admin.headers, other.user.id)).status).toBe(403)
    expect((await disable(admin.headers, owner.user.id)).status).toBe(403)
    // Вернуть — только редактором
    expect((await restore(admin.headers, editor.user.id, 'client')).status).toBe(403)
    expect((await restore(admin.headers, editor.user.id, 'editor')).status).toBe(200)
  })

  it('администратор сайта не возвращает доступ тем, кого владелец отключил не редактором', async () => {
    const admin = await api.loginAs('client')
    const otherAdmin = await api.loginAs('client')
    const formerOwner = await api.loginAs('owner')
    const editor = await api.loginAs('editor')
    for (const person of [otherAdmin, formerOwner, editor]) {
      expect((await disable(owner.headers, person.user.id)).status).toBe(200)
    }
    const rows = await list(admin.headers)
    const roleOf = (id: string) => rows.find((row) => row.id === id)?.disabledRole
    expect(roleOf(otherAdmin.user.id)).toBe('client')
    expect(roleOf(formerOwner.user.id)).toBe('owner')
    // Даже редактором: иначе администратор вернул бы в админку того, кого убрал владелец
    for (const person of [otherAdmin, formerOwner]) {
      const res = await restore(admin.headers, person.user.id, 'editor')
      expect(res.status).toBe(403)
      expect((await signIn(person.user.email)).status).toBe(403)
    }
    // Бывшего редактора — можно; владелец возвращает любого, роль до отключения стирается
    expect((await restore(admin.headers, editor.user.id, 'editor')).status).toBe(200)
    expect((await restore(owner.headers, otherAdmin.user.id, 'client')).status).toBe(200)
    const after = await list(owner.headers)
    expect(after.find((row) => row.id === otherAdmin.user.id)).toMatchObject({
      role: 'client',
      disabledRole: null,
    })
  })

  it('себя не отключить — 409', async () => {
    const res = await disable(owner.headers, owner.user.id)
    expect(res.status).toBe(409)
    expect((await site(owner.headers)).status).toBe(200)
  })
})

describe('последний владелец', () => {
  it('единственного владельца не понизить и не отключить: 409 и в API, и в обход его', async () => {
    // Отдельная установка: в общей владельцев много (каждый loginAs('owner') — новый)
    const solo = await createTestApi()
    try {
      const first = await solo.loginAs('owner')
      const second = await solo.loginAs('owner')
      const members = (path: string, init: RequestInit) =>
        solo.app.request(`/api/sites/${solo.demoSiteId}/members${path}`, init)
      // Владельцев двое: второй отключает первого — можно
      const off = await members(`/${first.user.id}/disable`, {
        method: 'POST',
        headers: second.headers,
      })
      expect(off.status).toBe(200)
      // Теперь второй — последний. Себя он не понизит и не отключит (409), а репозиторий не даст
      // сделать это и в обход проверки «себя нельзя»: владелец остаётся всегда
      const self = await members(`/${second.user.id}/disable`, {
        method: 'POST',
        headers: second.headers,
      })
      expect(self.status).toBe(409)
      const repo = membersRepo(solo.db)
      await expect(repo.setRole(solo.demoSiteId, second.user.id, 'client')).rejects.toThrow(
        LastOwnerError,
      )
      await expect(repo.disable(second.user.id, 'owner')).rejects.toThrow(LastOwnerError)
      const [row] = await solo.db
        .select({ role: users.role, disabledAt: users.disabledAt })
        .from(users)
        .where(eq(users.id, second.user.id))
      expect(row).toEqual({ role: 'owner', disabledAt: null })
      expect((await solo.app.request('/api/me', { headers: second.headers })).status).toBe(200)
    } finally {
      await solo.close()
    }
  })
})

describe('передача владения', () => {
  it('он — владелец, я — администратор сайта; одной транзакцией', async () => {
    const from = await api.loginAs('owner')
    const to = await api.loginAs('editor')
    const res = await transfer(from.headers, to.user.id)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      yourRole: 'client',
      message: expect.stringContaining('Ваша роль — «Администратор сайта»'),
    })
    expect(await (await me(to.headers)).json()).toMatchObject({ user: { role: 'owner' } })
    expect(await (await me(from.headers)).json()).toMatchObject({ user: { role: 'member' } })
    expect(await (await site(from.headers)).json()).toMatchObject({ access: 'client' })
    // Уже не владелец — передать ещё раз не может
    expect((await transfer(from.headers, to.user.id)).status).toBe(403)
  })

  it('владельцу, себе, отключённому — нельзя; администратор сайта не передаёт', async () => {
    const from = await api.loginAs('owner')
    const other = await api.loginAs('owner')
    expect((await transfer(from.headers, other.user.id)).status).toBe(409)
    expect((await transfer(from.headers, from.user.id)).status).toBe(409)
    const off = await api.loginAs('editor')
    await disable(from.headers, off.user.id)
    expect((await transfer(from.headers, off.user.id)).status).toBe(409)
    const admin = await api.loginAs('client')
    const editor = await api.loginAs('editor')
    expect((await transfer(admin.headers, editor.user.id)).status).toBe(403)
  })
})
