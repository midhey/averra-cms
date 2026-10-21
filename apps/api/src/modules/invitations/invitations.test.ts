import { eq, type SQL, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { userInvitations } from '../../db/schema'
import type { MemoryMail } from '../../mail/memory-mailer'
import { processOutbox } from '../../mail/worker'
import { createTestApi, TEST_PASSWORD, type TestApi, testOrigins } from '../../testing'
import { invitationsRepo } from './repo'
import { INVITES_PER_ADDRESS, INVITES_PER_INVITER } from './routes'
import { registerByInvitation } from './service'

// Приглашения на сайт: владелец приглашает, человек по ссылке из письма принимает.
// Всё — настоящими запросами, как их шлёт админка; письма — в ящике памяти через очередь

const api = await createTestApi({ resetResponseMs: 0 })
const { app } = api
afterAll(api.close)

type Headers = Record<string, string>
const json = (headers: Headers = {}) => ({ ...headers, 'content-type': 'application/json' })

const owner = await api.loginAs('owner')
const editor = await api.loginAs('editor')
const client = await api.loginAs('client')

let siteCount = 0
/**
 * Свой сайт в базе на каждый тест, чтобы приглашения не пересекались. API сайтов не создаёт
 * (одна установка — один сайт), сайт кладётся напрямую (testing.ts)
 */
async function newSite(testApi: TestApi = api) {
  siteCount += 1
  return testApi.createSite(`Сайт ${siteCount}`)
}

const invitationsUrl = (siteId: string) => `/api/sites/${siteId}/invitations`

const invite = (
  siteId: string,
  body: unknown,
  headers: Headers = owner.headers,
  testApi: TestApi = api,
) =>
  testApi.app.request(invitationsUrl(siteId), {
    method: 'POST',
    headers: json(headers),
    body: JSON.stringify(body),
  })

const list = (siteId: string, headers: Headers = owner.headers) =>
  app.request(invitationsUrl(siteId), { headers })

const revoke = (siteId: string, id: string, headers: Headers = owner.headers) =>
  app.request(`${invitationsUrl(siteId)}/${id}`, { method: 'DELETE', headers })

const lookup = (token: string) =>
  app.request('/api/invitations/lookup', {
    method: 'POST',
    headers: json(),
    body: JSON.stringify({ token }),
  })

const register = (token: string, name = 'Новый участник', password = 'invited-password-1') =>
  app.request('/api/invitations/register', {
    method: 'POST',
    headers: json(),
    body: JSON.stringify({ token, name, password }),
  })

const accept = (token: string, headers: Headers) =>
  app.request('/api/invitations/accept', {
    method: 'POST',
    headers: json(headers),
    body: JSON.stringify({ token }),
  })

let emailCount = 0
const freshEmail = () => `invitee-${++emailCount}@example.test`

/** Отправить всё из очереди и вернуть письма этому адресу */
async function inbox(email: string): Promise<MemoryMail[]> {
  const mailer = api.mailer
  if (!mailer) throw new Error('Почта выключена')
  // Пачками, пока очередь не опустеет: тест лимита ставит в неё десятки писем
  while ((await processOutbox({ db: api.db, mailer, ...api.mailSettings })).claimed > 0) {}
  return (mailer as unknown as { sent: MemoryMail[] }).sent.filter((mail) => mail.to === email)
}

/** Токен из ссылки письма: …/invite#token=<токен> */
function tokenOf(mail: MemoryMail | undefined) {
  const match = /\/invite#token=([^\s"<]+)/.exec(mail?.text ?? '')
  if (!match?.[1]) throw new Error('В письме нет ссылки приглашения')
  return decodeURIComponent(match[1])
}

/** Пригласить и достать токен из письма */
async function invited(siteId: string, email: string, role: 'editor' | 'client' = 'client') {
  const res = await invite(siteId, { email, role })
  expect(res.status, await res.clone().text()).toBe(201)
  const { id } = (await res.json()) as { id: string }
  const mails = await inbox(email)
  return { id, token: tokenOf(mails.at(-1)) }
}

const signIn = async (email: string, password: string) => {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: json({ origin: testOrigins.admin, 'x-forwarded-for': `192.0.2.${++emailCount}` }),
    body: JSON.stringify({ email, password }),
  })
  expect(res.status).toBe(200)
  const cookie = res.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  return { cookie, origin: testOrigins.admin }
}

const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code

describe('права', () => {
  it('без входа — 401: список, приглашение, отзыв и принятие', async () => {
    const siteId = await newSite()
    expect((await list(siteId, {})).status).toBe(401)
    expect((await invite(siteId, { email: freshEmail(), role: 'client' }, {})).status).toBe(401)
    expect((await revoke(siteId, crypto.randomUUID(), {})).status).toBe(401)
    expect((await accept(`inv_${crypto.randomUUID()}_${'a'.repeat(64)}`, {})).status).toBe(401)
  })

  it('редактор и клиент сайта — 403: приглашает только владелец', async () => {
    for (const { headers } of [editor, client]) {
      const res = await list(api.demoSiteId, headers)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({
        error: { code: 'forbidden', message: 'Приглашать участников может только владелец' },
      })
      const created = await invite(api.demoSiteId, { email: freshEmail(), role: 'client' }, headers)
      expect(created.status).toBe(403)
      expect((await revoke(api.demoSiteId, crypto.randomUUID(), headers)).status).toBe(403)
    }
  })

  it('токен API — 403, чужой сайт — 404', async () => {
    const { token } = await api.createToken(api.demoSiteId)
    const bearer = { authorization: `Bearer ${token}` }
    expect((await list(api.demoSiteId, bearer)).status).toBe(403)
    expect(
      (await invite(api.demoSiteId, { email: freshEmail(), role: 'client' }, bearer)).status,
    ).toBe(403)

    const other = await newSite()
    for (const headers of [editor.headers, client.headers]) {
      const res = await list(other, headers)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Сайт не найден' } })
      expect((await invite(other, { email: freshEmail(), role: 'client' }, headers)).status).toBe(
        404,
      )
    }
    expect((await list(crypto.randomUUID())).status).toBe(404)
  })
})

describe('приглашение', () => {
  it('201, в списке «ждёт», письмо со ссылкой в админку; в базе только хеш токена', async () => {
    const siteId = await newSite()
    const email = freshEmail()
    const wakes = api.mailWakes.count
    const res = await invite(siteId, { email: email.toUpperCase(), role: 'editor' })
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created).toMatchObject({
      email,
      role: 'editor',
      status: 'pending',
      invitedBy: 'Тестовый owner',
    })
    expect(api.mailWakes.count).toBe(wakes + 1)

    const listed = await (await list(siteId)).json()
    expect(listed).toEqual([
      expect.objectContaining({ id: (created as { id: string }).id, email, status: 'pending' }),
    ])
    expect(JSON.stringify(listed)).not.toMatch(/token/i)

    const [mail] = await inbox(email)
    expect(mail?.subject).toBe(`Приглашение на сайт «Сайт ${siteCount}» в Averra CMS`)
    expect(mail?.text).toContain('Тестовый owner приглашает вас')
    expect(mail?.text).toContain('Ваша роль — редактор')
    expect(mail?.text).toContain(`${testOrigins.admin}/invite#token=inv_`)
    expect(mail?.text).toContain('Ссылка действует 7 дней')
    const token = tokenOf(mail)

    const [row] = await api.db
      .select()
      .from(userInvitations)
      .where(eq(userInvitations.id, (created as { id: string }).id))
    expect(JSON.stringify(row)).not.toContain(token.split('_')[2])
    const week = (row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)
    expect(week).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('кривая почта или роль — 400 с путём до поля', async () => {
    const siteId = await newSite()
    const res = await invite(siteId, { email: 'не почта', role: 'owner' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { issues: { path: string }[] } }
    expect(body.error.issues.map((issue) => issue.path)).toEqual(['email', 'role'])
  })

  it('владельца и уже участника сайта не пригласить — 409 у поля почты', async () => {
    const siteId = await newSite()
    const ownerRes = await invite(siteId, { email: owner.user.email, role: 'client' })
    expect(ownerRes.status).toBe(409)
    expect(await ownerRes.json()).toMatchObject({
      error: { code: 'conflict', issues: [{ path: 'email' }] },
    })

    const member = await api.createUser('member')
    await api.addMember(siteId, member.id, 'client')
    const memberRes = await invite(siteId, { email: member.email, role: 'editor' })
    expect(memberRes.status).toBe(409)
    expect(await memberRes.json()).toMatchObject({
      error: { message: expect.stringContaining('Уже участник этого сайта (клиент)') },
    })
  })

  it('повторное приглашение того же адреса отзывает прежнее', async () => {
    const siteId = await newSite()
    const email = freshEmail()
    const first = await invited(siteId, email)
    const second = await invited(siteId, email, 'editor')

    expect((await lookup(first.token)).status).toBe(410)
    expect(await errorCode(await lookup(first.token))).toBe('invitation_revoked')
    expect((await lookup(second.token)).status).toBe(200)
    const statuses = ((await (await list(siteId)).json()) as { id: string; status: string }[]).map(
      ({ id, status }) => [id, status],
    )
    expect(statuses).toEqual([
      [second.id, 'pending'],
      [first.id, 'revoked'],
    ])
  })

  it('почта выключена — 503, приглашение не создаётся', async () => {
    const off = await createTestApi({ mail: 'off' })
    try {
      const offOwner = await off.loginAs('owner')
      const siteId = await newSite(off)
      const res = await invite(
        siteId,
        { email: freshEmail(), role: 'client' },
        offOwner.headers,
        off,
      )
      expect(res.status).toBe(503)
      expect(await errorCode(res)).toBe('mail_disabled')
      expect(await off.db.select().from(userInvitations)).toEqual([])
    } finally {
      await off.close()
    }
  })
})

describe('новый пользователь по ссылке', () => {
  it('видит приглашение, задаёт имя и пароль и получает только этот сайт с ролью', async () => {
    const siteId = await newSite()
    const email = freshEmail()
    const { token } = await invited(siteId, email, 'client')

    const info = await lookup(token)
    expect(info.status).toBe(200)
    expect(await info.json()).toEqual({
      email,
      role: 'client',
      siteName: `Сайт ${siteCount}`,
      inviterName: 'Тестовый owner',
      expiresAt: expect.any(String),
      userExists: false,
    })

    const res = await register(token, '  Мария  ', 'maria-password-1')
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ siteId, email })

    const headers = await signIn(email, 'maria-password-1')
    expect(await (await app.request('/api/me', { headers })).json()).toMatchObject({
      user: { name: 'Мария', email, role: 'member' },
    })
    const sites = (await (await app.request('/api/sites', { headers })).json()) as { id: string }[]
    expect(sites.map((site) => site.id)).toEqual([siteId])
    expect(await (await app.request(`/api/sites/${siteId}`, { headers })).json()).toMatchObject({
      access: 'client',
    })
    expect((await app.request(`/api/sites/${api.demoSiteId}`, { headers })).status).toBe(404)

    const statuses = (await (await list(siteId)).json()) as { status: string }[]
    expect(statuses.map((item) => item.status)).toEqual(['accepted'])
  })

  it('ссылка одноразовая: второй раз — 410 invitation_used', async () => {
    const siteId = await newSite()
    const { token } = await invited(siteId, freshEmail())
    expect((await register(token)).status).toBe(201)

    const again = await register(token, 'Другой', 'other-password-1')
    expect(again.status).toBe(410)
    expect(await again.json()).toEqual({
      error: {
        code: 'invitation_used',
        message: 'Приглашение уже принято. Войдите в админку своей почтой и паролем',
      },
    })
    expect(await errorCode(await lookup(token))).toBe('invitation_used')
  })

  it('имя с переводом строки и короткий пароль — 400, приглашение не тратится', async () => {
    const siteId = await newSite()
    const { token } = await invited(siteId, freshEmail())
    expect((await register(token, 'Анна\nBcc: x@evil.test')).status).toBe(400)
    expect((await register(token, 'Анна', 'short')).status).toBe(400)
    expect((await register(token)).status).toBe(201)
  })
})

describe('существующий пользователь', () => {
  it('принимает после входа: доступ с ролью из приглашения', async () => {
    const siteId = await newSite()
    const member = await api.createUser('member')
    const { token } = await invited(siteId, member.email, 'editor')
    expect(await (await lookup(token)).json()).toMatchObject({ userExists: true })

    // Пароль задавать нельзя: вход у него уже есть
    const registered = await register(token)
    expect(registered.status).toBe(409)
    expect(await errorCode(registered)).toBe('user_exists')

    // Принять может только он сам
    const stranger = await api.createUser('member')
    const wrong = await accept(token, await api.sessionHeaders(stranger.email))
    expect(wrong.status).toBe(403)
    expect(await wrong.json()).toMatchObject({
      error: { message: expect.stringContaining(`Приглашение для ${member.email}`) },
    })

    const headers = await api.sessionHeaders(member.email)
    const res = await accept(token, headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ siteId })
    expect(await (await app.request(`/api/sites/${siteId}`, { headers })).json()).toMatchObject({
      access: 'editor',
    })
    // Пароль прежний
    await signIn(member.email, TEST_PASSWORD)

    expect(await errorCode(await accept(token, headers))).toBe('invitation_used')
  })

  it('уже участник (роль выдали после приглашения) — роль не меняется, приглашение гасится', async () => {
    for (const [invitedAs, givenLater] of [
      ['client', 'editor'],
      ['editor', 'client'],
    ] as const) {
      const siteId = await newSite()
      const member = await api.createUser('member')
      const { id, token } = await invited(siteId, member.email, invitedAs)
      // Владелец передумал и выдал роль командой pnpm member:add
      await api.addMember(siteId, member.id, givenLater)

      const headers = await api.sessionHeaders(member.email)
      const res = await accept(token, headers)
      expect(res.status).toBe(200)
      expect(await (await app.request(`/api/sites/${siteId}`, { headers })).json()).toMatchObject({
        access: givenLater,
      })
      expect((await (await list(siteId)).json()) as unknown[]).toEqual([
        expect.objectContaining({ id, status: 'accepted' }),
      ])
    }
  })

  it('токен API принять не может — 403', async () => {
    const siteId = await newSite()
    const { token } = await invited(siteId, freshEmail())
    const { token: apiToken } = await api.createToken(siteId)
    const res = await accept(token, { authorization: `Bearer ${apiToken}` })
    expect(res.status).toBe(403)
  })
})

describe('отзыв и срок', () => {
  it('отозванное не работает (410), повторный отзыв — 204, принятое не отзывается — 409', async () => {
    const siteId = await newSite()
    const { id, token } = await invited(siteId, freshEmail())
    expect((await revoke(siteId, id)).status).toBe(204)
    expect((await revoke(siteId, id)).status).toBe(204)

    const res = await register(token)
    expect(res.status).toBe(410)
    expect(await errorCode(res)).toBe('invitation_revoked')
    expect((await (await list(siteId)).json()) as unknown[]).toEqual([
      expect.objectContaining({ id, status: 'revoked' }),
    ])

    const acceptedOne = await invited(siteId, freshEmail())
    expect((await register(acceptedOne.token)).status).toBe(201)
    const conflictRes = await revoke(siteId, acceptedOne.id)
    expect(conflictRes.status).toBe(409)
  })

  it('чужое или несуществующее приглашение — 404', async () => {
    const siteId = await newSite()
    const other = await newSite()
    const { id } = await invited(siteId, freshEmail())
    expect((await revoke(other, id)).status).toBe(404)
    expect((await revoke(siteId, crypto.randomUUID())).status).toBe(404)
  })

  it('истёкшее — 410 invitation_expired и «истекло» в списке', async () => {
    const siteId = await newSite()
    const { id, token } = await invited(siteId, freshEmail())
    await api.db
      .update(userInvitations)
      .set({
        createdAt: sql`now() - interval '8 days'`,
        expiresAt: sql`now() - interval '1 day'`,
      })
      .where(eq(userInvitations.id, id))

    const info = await lookup(token)
    expect(info.status).toBe(410)
    expect(await info.json()).toEqual({
      error: {
        code: 'invitation_expired',
        message: 'Срок приглашения истёк. Попросите владельца сайта прислать новое',
      },
    })
    expect(await errorCode(await register(token))).toBe('invitation_expired')
    expect((await (await list(siteId)).json()) as unknown[]).toEqual([
      expect.objectContaining({ id, status: 'expired' }),
    ])
  })

  it('неизвестный токен и чужой секрет — 404, кривой формат — 400', async () => {
    const siteId = await newSite()
    const { id } = await invited(siteId, freshEmail())
    const unknown = await lookup(`inv_${crypto.randomUUID()}_${'a'.repeat(64)}`)
    expect(unknown.status).toBe(404)
    expect(await errorCode(unknown)).toBe('invitation_not_found')
    // Id настоящий, секрет — нет
    expect((await lookup(`inv_${id}_${'b'.repeat(64)}`)).status).toBe(404)
    expect((await lookup('inv_broken')).status).toBe(400)
  })

  it('по негодной ссылке пароль даже не хешируется: открытый маршрут не грузит процессор', async () => {
    const siteId = await newSite()
    const { id } = await invited(siteId, freshEmail())
    await revoke(siteId, id)
    const hashPassword = vi.fn(async () => 'hash')
    for (const token of [
      `inv_${crypto.randomUUID()}_${'a'.repeat(64)}`,
      `inv_${id}_${'b'.repeat(64)}`,
    ]) {
      const result = await registerByInvitation(api.db, {
        token,
        name: 'Кто-то',
        password: 'some-password-1',
        hashPassword,
      })
      expect(result).toEqual({ ok: false, problem: 'not_found' })
    }
    expect(hashPassword).not.toHaveBeenCalled()
  })
})

describe('лимиты приглашений', () => {
  it('одному адресу на сайт — не больше трёх писем в час, на другой сайт — отдельно', async () => {
    const siteId = await newSite()
    const email = freshEmail()
    for (let i = 0; i < INVITES_PER_ADDRESS.max; i++) {
      expect((await invite(siteId, { email, role: 'client' })).status).toBe(201)
    }
    const limited = await invite(siteId, { email, role: 'client' })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({
      error: { code: 'rate_limited', message: expect.stringContaining(`На ${email}`) },
    })
    expect(await inbox(email)).toHaveLength(INVITES_PER_ADDRESS.max)
    expect((await invite(await newSite(), { email, role: 'client' })).status).toBe(201)
  })

  it('от одного владельца — не больше 50 в час', async () => {
    const busy = await api.loginAs('owner')
    const siteId = await newSite(api)
    for (let i = 0; i < INVITES_PER_INVITER.max; i++) {
      const res = await invite(siteId, { email: freshEmail(), role: 'client' }, busy.headers)
      expect(res.status).toBe(201)
    }
    const limited = await invite(siteId, { email: freshEmail(), role: 'client' }, busy.headers)
    expect(limited.status).toBe(429)
    expect(await errorCode(limited)).toBe('rate_limited')
    // У другого владельца свой счёт
    expect((await invite(siteId, { email: freshEmail(), role: 'client' })).status).toBe(201)
  })
})

describe('очистка', () => {
  it('закрытые приглашения старше срока удаляются, открытые и свежие — нет', async () => {
    const siteId = await newSite()
    const ids = {
      open: (await invited(siteId, freshEmail())).id,
      acceptedOld: (await invited(siteId, freshEmail())).id,
      acceptedFresh: (await invited(siteId, freshEmail())).id,
      revokedOld: (await invited(siteId, freshEmail())).id,
      expiredOld: (await invited(siteId, freshEmail())).id,
      expiredFresh: (await invited(siteId, freshEmail())).id,
    }
    const daysAgo = (days: number) => sql`now() - make_interval(days => ${days})`
    const set = (
      id: string,
      values: Partial<Record<'createdAt' | 'expiresAt' | 'acceptedAt' | 'revokedAt', SQL>>,
    ) => api.db.update(userInvitations).set(values).where(eq(userInvitations.id, id))
    await set(ids.acceptedOld, {
      createdAt: daysAgo(45),
      expiresAt: daysAgo(38),
      acceptedAt: daysAgo(40),
    })
    await set(ids.acceptedFresh, { acceptedAt: daysAgo(1) })
    await set(ids.revokedOld, {
      createdAt: daysAgo(45),
      expiresAt: daysAgo(38),
      revokedAt: daysAgo(40),
    })
    await set(ids.expiredOld, { createdAt: daysAgo(45), expiresAt: daysAgo(38) })
    await set(ids.expiredFresh, { createdAt: daysAgo(8), expiresAt: daysAgo(1) })

    const before = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    expect(await invitationsRepo(api.db).cleanup(before)).toBe(3)
    const left = ((await (await list(siteId)).json()) as { id: string }[]).map((row) => row.id)
    expect(left.sort()).toEqual([ids.open, ids.acceptedFresh, ids.expiredFresh].sort())
  })
})
