import { and, eq, like, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { RESET_REQUESTS_PER_IP, RESET_REQUESTS_PER_IP_BACKSTOP } from '../../auth/auth'
import { RESET_STORED_PREFIX } from '../../auth/password-reset'
import { verifications } from '../../db/schema'
import type { MemoryMail } from '../../mail/memory-mailer'
import { processOutbox } from '../../mail/worker'
import { createTestApi, TEST_PASSWORD, type TestApi, testOrigins } from '../../testing'
import { usersRepo } from '../users/repo'
import { RESET_REQUESTED } from './routes'

// Сброс пароля по ссылке из письма — через настоящие запросы, как их шлёт админка:
// запрос ссылки, письмо в ящике памяти (через очередь), новый пароль, вход

const api = await createTestApi({ resetResponseMs: 0 })
afterAll(api.close)

let ipCounter = 0
/** Свой IP на запрос: лимит Better Auth считается по IP и общий на процесс */
const freshIp = () => `198.51.100.${++ipCounter}`

const jsonHeaders = (ip: string) => ({
  'content-type': 'application/json',
  origin: testOrigins.admin,
  'x-forwarded-for': ip,
})

const requestReset = (email: string, ip = freshIp(), testApi: TestApi = api) =>
  testApi.app.request('/api/auth/request-password-reset', {
    method: 'POST',
    headers: jsonHeaders(ip),
    body: JSON.stringify({ email }),
  })

const resetPassword = (token: string, newPassword: string) =>
  api.app.request('/api/auth/reset-password', {
    method: 'POST',
    headers: jsonHeaders(freshIp()),
    body: JSON.stringify({ token, newPassword }),
  })

const signIn = (email: string, password: string) =>
  api.app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: jsonHeaders(freshIp()),
    body: JSON.stringify({ email, password }),
  })

/** Отправить всё из очереди и вернуть письма этому адресу */
async function inbox(email: string): Promise<MemoryMail[]> {
  const mailer = api.mailer
  if (!mailer) throw new Error('Почта выключена')
  await processOutbox({ db: api.db, mailer, ...api.mailSettings })
  return (mailer as unknown as { sent: MemoryMail[] }).sent.filter((mail) => mail.to === email)
}

/** Токен из ссылки письма: …/reset-password#token=<токен> */
function tokenOf(mail: MemoryMail | undefined) {
  const match = /\/reset-password#token=([^\s"<]+)/.exec(mail?.text ?? '')
  if (!match?.[1]) throw new Error('В письме нет ссылки сброса')
  return decodeURIComponent(match[1])
}

const NEW_PASSWORD = 'brand-new-password-1'

describe('полный цикл', () => {
  it('письмо со ссылкой в админку → новый пароль → вход им; старые сессии завершены', async () => {
    const user = await api.createUser('member', 'Анна')
    const session = await api.sessionHeaders(user.email)
    expect((await api.app.request('/api/me', { headers: session })).status).toBe(200)

    const res = await requestReset(user.email)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(RESET_REQUESTED)

    const [mail] = await inbox(user.email)
    expect(mail?.subject).toBe('Сброс пароля в Averra CMS')
    expect(mail?.text).toContain('Здравствуйте, Анна!')
    expect(mail?.text).toContain(`${testOrigins.admin}/reset-password#token=`)
    expect(mail?.text).toContain('Ссылка работает 1 час')
    const token = tokenOf(mail)

    const reset = await resetPassword(token, NEW_PASSWORD)
    expect(reset.status).toBe(200)

    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(200)
    expect((await signIn(user.email, TEST_PASSWORD)).status).toBe(401)
    // Сессия, открытая до сброса, больше не пускает
    expect((await api.app.request('/api/me', { headers: session })).status).toBe(401)
  })

  it('ссылка одноразовая: второй раз — 400 с объяснением по-русски', async () => {
    const user = await api.createUser('member')
    await requestReset(user.email)
    const token = tokenOf((await inbox(user.email))[0])
    expect((await resetPassword(token, NEW_PASSWORD)).status).toBe(200)

    const again = await resetPassword(token, 'another-password-2')
    expect(again.status).toBe(400)
    expect(await again.json()).toEqual({
      error: {
        code: 'invalid_token',
        message: expect.stringContaining('Ссылка не действует'),
      },
    })
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(200)
  })

  it('ссылка старше часа не работает', async () => {
    const user = await api.createUser('member')
    await requestReset(user.email)
    const token = tokenOf((await inbox(user.email))[0])
    await api.db
      .update(verifications)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(verifications.value, user.id))

    expect((await resetPassword(token, NEW_PASSWORD)).status).toBe(400)
    expect((await signIn(user.email, TEST_PASSWORD)).status).toBe(200)
  })

  it('срок ссылки — час: и в базе, и в очереди писем', async () => {
    const user = await api.createUser('member')
    const before = Date.now()
    await requestReset(user.email)
    const [row] = await api.db
      .select({ expiresAt: verifications.expiresAt })
      .from(verifications)
      .where(eq(verifications.value, user.id))
    const ttl = (row?.expiresAt.getTime() ?? 0) - before
    expect(ttl).toBeGreaterThan(59 * 60 * 1000)
    expect(ttl).toBeLessThanOrEqual(61 * 60 * 1000)
  })

  it('новый запрос сжигает прежнюю ссылку: работает только последняя', async () => {
    const user = await api.createUser('member')
    await requestReset(user.email)
    await requestReset(user.email)
    const mails = await inbox(user.email)
    expect(mails).toHaveLength(2)
    const [first, second] = mails.map(tokenOf)

    expect((await resetPassword(first ?? '', NEW_PASSWORD)).status).toBe(400)
    expect((await resetPassword(second ?? '', NEW_PASSWORD)).status).toBe(200)
  })

  it('в базе только хеш токена, а не сама ссылка', async () => {
    const user = await api.createUser('member')
    await requestReset(user.email)
    const token = tokenOf((await inbox(user.email))[0])
    const rows = await api.db
      .select({ identifier: verifications.identifier })
      .from(verifications)
      .where(eq(verifications.value, user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.identifier).toMatch(/^reset-password#[A-Za-z0-9_-]{43}$/)
    expect(rows[0]?.identifier).not.toContain(token)
  })

  it('то, что лежит в базе, токеном не работает — ни через API, ни в Better Auth напрямую', async () => {
    const user = await api.createUser('member')
    await requestReset(user.email)
    const token = tokenOf((await inbox(user.email))[0])
    const [row] = await api.db
      .select({ identifier: verifications.identifier })
      .from(verifications)
      .where(eq(verifications.value, user.id))
    const stored = row?.identifier ?? ''
    const hash = stored.slice(RESET_STORED_PREFIX.length)
    expect(hash).toHaveLength(43)

    // Через API: формат не тот — 400 «ссылка не действует», до Better Auth запрос не доходит
    for (const candidate of [hash, stored, `reset-password:${hash}`]) {
      const res = await resetPassword(candidate, NEW_PASSWORD)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: { code: 'invalid_token' } })
    }
    // В обход обёртки, серверным вызовом Better Auth: его запасной поиск «по строке как есть»
    // ищет reset-password:<хеш>, а в базе reset-password#<хеш> — не находит
    for (const candidate of [hash, stored]) {
      await expect(
        api.auth.api.resetPassword({ body: { token: candidate, newPassword: NEW_PASSWORD } }),
      ).rejects.toMatchObject({ body: { code: 'INVALID_TOKEN' } })
    }

    expect((await signIn(user.email, TEST_PASSWORD)).status).toBe(200)
    // Ссылка из письма при этом цела
    expect((await resetPassword(token, NEW_PASSWORD)).status).toBe(200)
  })

  it('токен не того формата — 400 «ссылка не действует»', async () => {
    const bad = await resetPassword('abc', NEW_PASSWORD)
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({
      error: { code: 'invalid_token', message: expect.stringContaining('Ссылка не действует') },
    })
  })

  it('токен не того формата до Better Auth не доходит: его лимит (10 в минуту с IP) не тратится', async () => {
    // Ответ тот же, что дал бы Better Auth, поэтому отличие видно по лимиту: дошли бы запросы
    // до него — одиннадцатый с этого IP получил бы 429
    const ip = freshIp()
    for (let i = 0; i < 12; i++) {
      const res = await api.app.request('/api/auth/reset-password', {
        method: 'POST',
        headers: jsonHeaders(ip),
        body: JSON.stringify({ token: `not-a-token-${i}`, newPassword: NEW_PASSWORD }),
      })
      expect(res.status, `запрос ${i + 1}`).toBe(400)
      expect(await res.json()).toMatchObject({ error: { code: 'invalid_token' } })
    }
  })

  it('тело без токена — 400 проверки, токен из строки запроса не подставляется', async () => {
    const user = await api.createUser('member')
    await requestReset(user.email)
    const token = tokenOf((await inbox(user.email))[0])
    const res = await api.app.request(
      `/api/auth/reset-password?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: jsonHeaders(freshIp()),
        body: JSON.stringify({ newPassword: NEW_PASSWORD }),
      },
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'validation' } })
    expect((await signIn(user.email, TEST_PASSWORD)).status).toBe(200)
  })

  it('в Better Auth уходит адрес без строки запроса: оттуда он не возьмёт ни токен, ни callbackURL', async () => {
    const user = await api.createUser('member')
    await requestReset(user.email)
    const token = tokenOf((await inbox(user.email))[0])
    const handler = vi.spyOn(api.auth, 'handler')
    try {
      const res = await api.app.request(
        '/api/auth/reset-password?token=AAAAAAAAAAAAAAAAAAAAAAAA&callbackURL=https://evil.test',
        {
          method: 'POST',
          headers: jsonHeaders(freshIp()),
          body: JSON.stringify({ token, newPassword: NEW_PASSWORD }),
        },
      )
      expect(res.status).toBe(200)
      const [request] = handler.mock.calls.at(-1) ?? []
      expect(request && new URL(request.url).search).toBe('')
    } finally {
      handler.mockRestore()
    }
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(200)
  })

  it('варианты путей сброса до Better Auth не доходят: 404', async () => {
    const user = await api.createUser('member')
    await requestReset(user.email)
    const token = tokenOf((await inbox(user.email))[0])
    for (const path of [
      '/api/auth/reset-password/',
      '/api/auth//reset-password',
      '/api/auth/Reset-Password',
      '/api/auth/reset%2Dpassword',
    ]) {
      const res = await api.app.request(path, {
        method: 'POST',
        headers: jsonHeaders(freshIp()),
        body: JSON.stringify({ token, newPassword: NEW_PASSWORD }),
      })
      expect(res.status, path).toBe(404)
    }
    expect((await signIn(user.email, TEST_PASSWORD)).status).toBe(200)
  })

  it('короткий пароль не тратит ссылку', async () => {
    const user = await api.createUser('member')
    await requestReset(user.email)
    const token = tokenOf((await inbox(user.email))[0])
    const short = await resetPassword(token, 'short')
    expect(short.status).toBe(400)
    expect(await short.json()).toMatchObject({ error: { message: 'Пароль слишком короткий' } })
    expect((await resetPassword(token, NEW_PASSWORD)).status).toBe(200)
  })

  it('ссылки Better Auth с токеном в пути нет: 404', async () => {
    const res = await api.app.request('/api/auth/reset-password/abc?callbackURL=/')
    expect(res.status).toBe(404)
  })
})

describe('ответ не выдаёт, есть ли адрес', () => {
  it('существующий и несуществующий адрес — одинаковый статус и тело; письмо только первому', async () => {
    const user = await api.createUser('member')
    const ghost = `ghost-${crypto.randomUUID()}@example.test`
    const existing = await requestReset(user.email)
    const missing = await requestReset(ghost)
    expect(missing.status).toBe(existing.status)
    expect(await missing.json()).toEqual(await existing.json())
    expect(await inbox(user.email)).toHaveLength(1)
    expect(await inbox(ghost)).toHaveLength(0)
  })

  it('отвечает не раньше порога — для обоих адресов', async () => {
    const timed = await createTestApi({ resetResponseMs: 300 })
    try {
      const user = await timed.createUser('member')
      for (const email of [user.email, 'nobody@example.test']) {
        const started = Date.now()
        const res = await requestReset(email, freshIp(), timed)
        expect(res.status).toBe(200)
        // Таймеры бывают на миллисекунду раньше: порог проверяем с запасом
        expect(Date.now() - started).toBeGreaterThanOrEqual(290)
      }
    } finally {
      await timed.close()
    }
  })

  it('почту принимает в любом регистре, лишние поля — 400', async () => {
    const user = await api.createUser('member')
    expect((await requestReset(user.email.toUpperCase())).status).toBe(200)
    expect(await inbox(user.email)).toHaveLength(1)

    const res = await api.app.request('/api/auth/request-password-reset', {
      method: 'POST',
      headers: jsonHeaders(freshIp()),
      body: JSON.stringify({ email: user.email, redirectTo: 'https://evil.test' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('лимиты', () => {
  it('на адрес: четвёртый запрос за 15 минут — 429, и для несуществующего адреса тоже', async () => {
    const user = await api.createUser('member')
    for (const email of [user.email, `ghost-${crypto.randomUUID()}@example.test`]) {
      for (let i = 0; i < 3; i++) expect((await requestReset(email)).status).toBe(200)
      const limited = await requestReset(email)
      expect(limited.status).toBe(429)
      expect(await limited.json()).toMatchObject({
        error: {
          code: 'rate_limited',
          message: expect.stringContaining('Слишком много запросов сброса'),
        },
      })
    }
    expect(await inbox(user.email)).toHaveLength(3)
  })

  it('на IP: после пяти запросов за 15 минут — 429', async () => {
    const ip = freshIp()
    for (let i = 0; i < RESET_REQUESTS_PER_IP.max; i++) {
      expect((await requestReset(`ip-${i}-${crypto.randomUUID()}@example.test`, ip)).status).toBe(
        200,
      )
    }
    const limited = await requestReset('ip-last@example.test', ip)
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({
      error: {
        code: 'rate_limited',
        message: expect.stringContaining('Слишком много запросов сброса с вашего адреса'),
      },
    })
  })

  it('кривые пути запроса сброса — 404 и лимит не тратят: у IP целы все пять запросов', async () => {
    const ip = freshIp()
    for (const path of [
      '/api/auth/request-password-reset/',
      '/api/auth//request-password-reset',
      '/api/auth/Request-Password-Reset',
      '/api/auth/request-password-reset%2F',
      '/api/auth/forget-password',
    ]) {
      for (let i = 0; i < 3; i++) {
        const res = await api.app.request(path, {
          method: 'POST',
          headers: jsonHeaders(ip),
          body: JSON.stringify({ email: `junk-${crypto.randomUUID()}@example.test` }),
        })
        expect(res.status, path).toBe(404)
      }
    }
    for (let i = 0; i < RESET_REQUESTS_PER_IP.max; i++) {
      expect((await requestReset(`ok-${i}-${crypto.randomUUID()}@example.test`, ip)).status).toBe(
        200,
      )
    }
    // Шестой — 429 нашего лимита по IP, с нашим текстом
    const limited = await requestReset('ok-last@example.test', ip)
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({
      error: { message: expect.stringContaining('Слишком много запросов сброса с вашего адреса') },
    })
  })

  it('сработал запасной лимит Better Auth — тот же 429, что у нашего лимита по IP, а адрес попытку не теряет', async () => {
    // Счётчик Better Auth для этого IP набит запросами мимо обёртки (так было бы, если её обойти),
    // а наш лимит по IP ещё свободен: запрос пройдёт его и упрётся в запасной лимит Better Auth
    const ip = freshIp()
    for (let i = 0; i < RESET_REQUESTS_PER_IP_BACKSTOP.max; i++) {
      const direct = await api.auth.handler(
        new Request(`${testOrigins.api}/api/auth/request-password-reset`, {
          method: 'POST',
          headers: jsonHeaders(ip),
          body: JSON.stringify({ email: `direct-${i}-${crypto.randomUUID()}@example.test` }),
        }),
      )
      expect(direct.status).toBe(200)
    }
    const target = `backstop-${crypto.randomUUID()}@example.test`
    const limited = await requestReset(target, ip)
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({
      error: {
        code: 'rate_limited',
        message: expect.stringMatching(
          /^Слишком много запросов сброса с вашего адреса\. Подождите \d+ мин/,
        ),
      },
    })
    // Отбитый по IP запрос в счётчик адресов не попал: у адреса все три попытки целы
    for (let i = 0; i < 3; i++) expect((await requestReset(target)).status).toBe(200)
    expect((await requestReset(target)).status).toBe(429)
  })

  it('IP проверяется первым: отбитые по IP запросы не попадают в счётчик адресов', async () => {
    const ip = freshIp()
    for (let i = 0; i < RESET_REQUESTS_PER_IP.max; i++) {
      expect((await requestReset(`fill-${i}-${crypto.randomUUID()}@example.test`, ip)).status).toBe(
        200,
      )
    }
    // Перебор адресов с исчерпанного IP: каждый — 429 по IP, до счётчика адресов дело не доходит
    const target = `target-${crypto.randomUUID()}@example.test`
    for (let i = 0; i < 5; i++) {
      const res = await requestReset(i === 0 ? target : `spray-${i}@example.test`, ip)
      expect(res.status).toBe(429)
    }
    // Значит, у адреса все три попытки целы
    for (let i = 0; i < 3; i++) expect((await requestReset(target)).status).toBe(200)
    expect((await requestReset(target)).status).toBe(429)
  })
})

describe('почта выключена', () => {
  it('экран знает заранее, а запрос сброса — 503 для любого адреса', async () => {
    const off = await createTestApi({ mail: 'off', resetResponseMs: 0 })
    try {
      const status = await off.app.request('/api/password-reset')
      expect(status.status).toBe(200)
      expect(await status.json()).toEqual({ available: false })

      const user = await off.createUser('member')
      for (const email of [user.email, 'nobody@example.test']) {
        const res = await requestReset(email, freshIp(), off)
        expect(res.status).toBe(503)
        expect(await res.json()).toMatchObject({ error: { code: 'mail_disabled' } })
      }
      const rows = await off.db
        .select()
        .from(verifications)
        .where(like(verifications.identifier, `${RESET_STORED_PREFIX}%`))
      expect(rows).toHaveLength(0)
    } finally {
      await off.close()
    }
  })

  it('включена — available: true', async () => {
    expect(await (await api.app.request('/api/password-reset')).json()).toEqual({
      available: true,
    })
  })
})

describe('смена пароля командой (pnpm user:password)', () => {
  it('меняет пароль, завершает сессии и сжигает ссылки сброса', async () => {
    const user = await api.createUser('member')
    const session = await api.sessionHeaders(user.email)
    await requestReset(user.email)
    const token = tokenOf((await inbox(user.email))[0])

    await usersRepo(api.db, api.auth).setPassword(user.id, NEW_PASSWORD)

    expect((await api.app.request('/api/me', { headers: session })).status).toBe(401)
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(200)
    expect((await resetPassword(token, 'another-password-2')).status).toBe(400)
    const left = await api.db
      .select()
      .from(verifications)
      .where(and(eq(verifications.value, user.id), like(verifications.identifier, 'reset-%')))
    expect(left).toHaveLength(0)
  })
})
