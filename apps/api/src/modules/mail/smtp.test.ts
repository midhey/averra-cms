import { randomBytes } from 'node:crypto'
import { inspect } from 'node:util'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PASSWORD_CONFIRM_FAILURES } from '../../auth/confirm-password'
import { aesGcmSecretBox, KEY_BYTES } from '../../crypto/aes-gcm'
import { SEALED_FORMAT } from '../../crypto/secret-box'
import { mailOutbox, mailSettings, users } from '../../db/schema'
import type { Mailer } from '../../mail/mailer'
import { memoryMailer } from '../../mail/memory-mailer'
import { enqueueMail } from '../../mail/outbox'
import { MAIL_PASSWORD_CONTEXT } from '../../mail/settings'
import { createTestCa, issueServerCert, startTestSmtpServer } from '../../mail/testing/smtp'
import { startMailWorker } from '../../mail/worker'
import { createTestApi, sendQueue, TEST_PASSWORD, type TestApi } from '../../testing'
import { SMTP_CHECKS } from './routes'

// Настройки SMTP в админке: настоящие SMTP-серверы (smtp-server) на свободных портах с сертификатом
// от тестового CA. Настройки пускают только 465 и 587, поэтому тестовый рантайм направляет эти
// порты на свои серверы (connectPort, только код). Пароль SMTP не должен всплыть нигде

const SMTP_USER = 'mailer@averra.test'
const SMTP_PASSWORD = 'smtp-Пароль-42-secret'
const fast = { connection: 5000, greeting: 5000, socket: 5000, dns: 5000 }

type Server = Awaited<ReturnType<typeof startTestSmtpServer>>
let ca: Awaited<ReturnType<typeof createTestCa>>
let tls465: Server
let starttls587: Server
let foreign: Server
// Куда тестовый рантайм подключается вместо 465 и 587. Тест может перенаправить
const ports: Record<number, number> = {}

beforeAll(async () => {
  ca = await createTestCa()
  const cert = await issueServerCert(ca)
  const users = { [SMTP_USER]: SMTP_PASSWORD }
  // Сервер 465 повторяет пароль в ответе на неверный вход: так видно, что ответ маскируется
  tls465 = await startTestSmtpServer({
    mode: 'tls',
    cert,
    users,
    authError: (password) => `Пароль ${password} не подходит`,
  })
  starttls587 = await startTestSmtpServer({ mode: 'starttls', cert, users })
  // Сертификат от чужого CA: ему тестовый рантайм не доверяет
  foreign = await startTestSmtpServer({
    mode: 'tls',
    cert: await issueServerCert(await createTestCa('Чужой CA')),
    users,
  })
})
afterAll(async () => {
  await Promise.all([tls465, starttls587, foreign].map((server) => server?.close()))
})

/** Свой API со своей базой: SMTP из админки ходит на тестовые серверы */
async function smtpApi(options: Parameters<typeof createTestApi>[0] = {}) {
  const logs: string[] = []
  const api = await createTestApi({
    smtp: { ca: ca.cert, timeouts: fast, connectPort: (port) => ports[port] ?? port },
    log: (message) => logs.push(message),
    resetResponseMs: 0,
    ...options,
  })
  return { api, logs }
}

const fields = (port: 465 | 587 = 465) => ({
  host: 'localhost',
  port,
  security: port === 465 ? ('tls' as const) : ('starttls' as const),
  user: SMTP_USER,
  fromAddress: 'noreply@averra.test',
  fromName: 'Averra CMS',
})

type Headers = Record<string, string>

/** Запрос в почту; каждый ответ запоминается — потом проверим, что пароля нет ни в одном */
function client(api: TestApi, responses: string[] = []) {
  return async (method: string, path: string, headers: Headers, body?: unknown) => {
    const res = await api.app.request(`/api/mail${path}`, {
      method,
      headers: { ...headers, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    responses.push(text)
    return { status: res.status, text, json: text ? JSON.parse(text) : undefined }
  }
}

/** Сохранить без проверки: короткий путь там, где проверка не важна */
const saveDirect = (port: 465 | 587 = 465, password = SMTP_PASSWORD) => ({
  ...fields(port),
  password,
  currentPassword: TEST_PASSWORD,
  skipCheck: true,
})

async function settingsRow(api: TestApi) {
  const [row] = await api.db.select().from(mailSettings)
  return row
}

const resetServers = () => {
  for (const server of [tls465, starttls587, foreign]) {
    server.received.length = 0
    server.logins.length = 0
  }
  ports[465] = tls465.port
  ports[587] = starttls587.port
}

describe('настройки SMTP в админке', () => {
  let api: TestApi
  // Почта по умолчанию (без настроек SMTP) — в памяти: видно, что ушло мимо SMTP
  const fallback = memoryMailer()
  let logs: string[]
  let owner: { user: { id: string; email: string }; headers: Headers }
  let call: ReturnType<typeof client>

  beforeAll(async () => {
    ;({ api, logs } = await smtpApi({ mail: fallback }))
  })
  afterAll(async () => {
    await api.close()
  })
  // Настройки одни на установку: каждый тест начинает без них и с пустой очередью, а владелец
  // у каждого свой — со своими лимитами
  beforeEach(async () => {
    resetServers()
    await api.db.delete(mailSettings)
    await api.db.delete(mailOutbox)
    await api.mailRuntime.reload()
    logs.length = 0
    fallback.sent.length = 0
    owner = await api.loginAs('owner')
    call = client(api)
  })

  const ownerCount = async () =>
    (await api.db.select({ id: users.id }).from(users).where(eq(users.role, 'owner'))).length

  describe('права', () => {
    it('без входа — 401; редактор, клиент и токен — 403 на всех маршрутах SMTP', async () => {
      const { token } = await api.createToken()
      const editor = await api.loginAs('editor')
      const clientUser = await api.loginAs('client')
      const routes: [string, string, unknown?][] = [
        ['GET', '/smtp'],
        ['POST', '/smtp/check', { ...fields(), password: SMTP_PASSWORD, to: 'a@b.ru' }],
        ['PUT', '/smtp', saveDirect()],
        ['DELETE', '/smtp', { currentPassword: TEST_PASSWORD }],
      ]
      for (const [method, path, body] of routes) {
        expect((await call(method, path, {}, body)).status, `${method} ${path}`).toBe(401)
        for (const headers of [
          editor.headers,
          clientUser.headers,
          { authorization: `Bearer ${token}` },
        ]) {
          const res = await call(method, path, headers, body)
          expect(res.status, `${method} ${path}`).toBe(403)
          expect(res.json.error.code).toBe('forbidden')
        }
      }
      expect(await settingsRow(api)).toBeUndefined()
      expect(tls465.logins).toHaveLength(0)
    })
  })

  it('без настроек: SMTP не задан, менять можно, ключ свой', async () => {
    const res = await call('GET', '/smtp', owner.headers)
    expect(res.status).toBe(200)
    expect(res.json).toEqual({
      source: 'none',
      editable: true,
      lock: null,
      key: 'env',
      settings: null,
    })
  })

  it('проверка → сохранение с паролем владельца: пароль «задан», в базе — только шифротекст', async () => {
    const check = await call('POST', '/smtp/check', owner.headers, {
      ...fields(),
      password: SMTP_PASSWORD,
      to: 'anna@example.ru',
    })
    expect(check.status).toBe(200)
    expect(check.json.ok).toBe(true)
    expect(check.json.steps.map((step: { step: string; ok: boolean }) => step.step)).toEqual([
      'dns',
      'connection',
      'tls',
      'auth',
      'send',
    ])
    expect(check.json.steps.every((step: { ok: boolean }) => step.ok)).toBe(true)
    expect(check.json.checkToken).toEqual(expect.any(String))
    // Проверочное письмо ушло на указанный адрес через проверяемые настройки
    expect(tls465.received).toHaveLength(1)
    expect(tls465.received[0]).toMatchObject({ to: ['anna@example.ru'], user: SMTP_USER })
    expect(tls465.received[0]?.raw).toContain('Subject: =?UTF-8?')

    const save = await call('PUT', '/smtp', owner.headers, {
      ...fields(),
      password: SMTP_PASSWORD,
      currentPassword: TEST_PASSWORD,
      checkToken: check.json.checkToken,
    })
    expect(save.status).toBe(200)
    expect(save.json.smtp).toMatchObject({
      source: 'database',
      editable: true,
      settings: {
        ...fields(),
        password: 'set',
        verifiedAt: expect.any(String),
        updatedBy: 'Тестовый owner',
      },
    })
    expect(save.json.changed).toEqual([
      'сервер',
      'порт и шифрование',
      'логин',
      'пароль',
      'адрес отправителя',
      'имя отправителя',
    ])
    expect(save.json.notified).toBe(await ownerCount())

    // В базе — запись AES-GCM, а не пароль; расшифровывается ключом этого API
    const row = await settingsRow(api)
    expect(row?.passwordEncrypted).toMatch(SEALED_FORMAT)
    expect(row?.passwordEncrypted).not.toContain(SMTP_PASSWORD)
    expect(api.secretBox?.decrypt(row?.passwordEncrypted ?? '', MAIL_PASSWORD_CONTEXT)).toBe(
      SMTP_PASSWORD,
    )
    expect(row?.verifiedAt).toBeInstanceOf(Date)

    // Почта сразу работает через новые настройки, без перезапуска
    const mail = await call('GET', '', owner.headers)
    expect(mail.json.status).toEqual({
      enabled: true,
      provider: {
        kind: 'smtp',
        host: 'localhost',
        port: 465,
        security: 'tls',
        user: SMTP_USER,
        from: { address: 'noreply@averra.test', name: 'Averra CMS' },
      },
    })

    // Обновили страницу: пароль по-прежнему «задан», самого пароля нет
    const again = await call('GET', '/smtp', owner.headers)
    expect(again.json.settings.password).toBe('set')
    expect(again.text).not.toContain(SMTP_PASSWORD)
  })

  it('после сохранения: письмо каждому владельцу уходит уже по новым настройкам, в лог — без пароля', async () => {
    await call('PUT', '/smtp', owner.headers, saveDirect())
    const queued = await api.db
      .select({ to: mailOutbox.recipient, template: mailOutbox.template })
      .from(mailOutbox)
    expect(queued.map((mail) => mail.template)).toEqual(
      Array(await ownerCount()).fill('mail-settings-changed'),
    )
    expect(queued.map((mail) => mail.to)).toContain(owner.user.email)

    await sendQueue(api)
    const notice = tls465.received.find((mail) => mail.to[0] === owner.user.email)
    expect(notice?.raw).toContain('Subject: =?UTF-8?')
    expect(fallback.sent).toHaveLength(0)
    // Тема письма — в base64 из-за кириллицы: проверяем текст письма
    expect(Buffer.from(notice?.raw ?? '').toString()).toMatch(/Content-Type: text\/plain/)

    // В логе API, кроме строк запросов, — одна запись о смене: кто, когда, какие поля
    const audit = logs.filter((line) => line.startsWith('['))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatch(/^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] Настройки почты \(SMTP\) сохранены/)
    expect(audit[0]).toContain(`Тестовый owner <${owner.user.email}> (${owner.user.id})`)
    expect(audit[0]).toContain('Изменено: сервер, порт и шифрование, логин, пароль')
    expect(audit[0]).toContain('Проверка подключения: не делалась (сохранено без проверки)')
    expect(logs.join('\n')).not.toContain(SMTP_PASSWORD)
  })

  it('пароль не встречается ни в одном ответе маршрутов почты, даже зашифрованным', async () => {
    const responses: string[] = []
    const all = client(api, responses)
    const wrong = 'wrong-Пароль-77'

    await all('GET', '', owner.headers)
    await all('GET', '/smtp', owner.headers)
    const check = await all('POST', '/smtp/check', owner.headers, {
      ...fields(),
      password: SMTP_PASSWORD,
      to: 'anna@example.ru',
    })
    await all('PUT', '/smtp', owner.headers, {
      ...fields(),
      password: SMTP_PASSWORD,
      currentPassword: TEST_PASSWORD,
      checkToken: check.json.checkToken,
    })
    // Проверка и сохранение с сохранённым паролем (поле пустое): он ушёл на сервер в AUTH
    const kept = await all('POST', '/smtp/check', owner.headers, {
      ...fields(),
      to: owner.user.email,
    })
    expect(kept.json.ok).toBe(true)
    await all('POST', '/smtp/check', owner.headers, { ...fields(), to: 'anna@example.ru' })
    await all('PUT', '/smtp', owner.headers, { ...saveDirect(), password: '' })
    // Неверный пароль SMTP: сервер повторил его в ответе, но в ответ API он не попадёт
    const failed = await all('POST', '/smtp/check', owner.headers, {
      ...fields(),
      password: wrong,
      to: 'anna@example.ru',
    })
    expect(failed.json.ok).toBe(false)
    // Неверный пароль владельца, кривой запрос
    await all('PUT', '/smtp', owner.headers, { ...saveDirect(), currentPassword: 'не тот пароль' })
    await all('PUT', '/smtp', owner.headers, { ...saveDirect(), port: 25 })
    await all('GET', '', owner.headers)
    await all('GET', '/smtp', owner.headers)
    await all('GET', '/outbox', owner.headers)
    const { id } = await enqueueMail(api.db, {
      template: 'mail-test',
      data: { sentAt: new Date().toISOString(), provider: 'тест' },
      to: 'retry@example.ru',
    })
    await sendQueue(api)
    await all('POST', `/outbox/${id}/retry`, owner.headers)
    for (const template of ['mail-test', 'password-reset', 'invitation', 'mail-settings-changed']) {
      await all('GET', `/templates/${template}/preview`, owner.headers)
    }
    const row = await settingsRow(api)
    await all('DELETE', '/smtp', owner.headers, { currentPassword: TEST_PASSWORD })
    await all('GET', '/smtp', owner.headers)

    const sealed = row?.passwordEncrypted ?? 'нет записи'
    const forms = [SMTP_PASSWORD, wrong]
      .flatMap((secret) => [
        secret,
        Buffer.from(secret).toString('base64'),
        Buffer.from(secret).toString('base64url'),
        Buffer.from(`\u0000${SMTP_USER}\u0000${secret}`).toString('base64'),
      ])
      .concat(sealed, sealed.split('.').at(-1) ?? sealed)
    expect(responses.length).toBeGreaterThan(15)
    for (const text of [...responses, ...logs]) {
      for (const form of forms) expect(text, text.slice(0, 200)).not.toContain(form)
    }
    expect(failed.text).toContain('***')
  })

  describe('повторный пароль владельца', () => {
    it('без пароля — 400, с неверным — 403 у поля currentPassword; база не меняется', async () => {
      const { currentPassword: _, ...withoutPassword } = saveDirect()
      const missing = await call('PUT', '/smtp', owner.headers, withoutPassword)
      expect(missing.status).toBe(400)
      expect(missing.json.error.issues).toEqual([
        expect.objectContaining({ path: 'currentPassword' }),
      ])

      const wrong = await call('PUT', '/smtp', owner.headers, {
        ...saveDirect(),
        currentPassword: 'не тот пароль',
      })
      expect(wrong.status).toBe(403)
      expect(wrong.json).toEqual({
        error: {
          code: 'invalid_password',
          message: 'Неверный пароль',
          issues: [{ path: 'currentPassword', message: 'Неверный пароль' }],
        },
      })
      expect(await settingsRow(api)).toBeUndefined()

      // Удалить тоже нельзя без пароля
      await call('PUT', '/smtp', owner.headers, saveDirect())
      expect((await call('DELETE', '/smtp', owner.headers, {})).status).toBe(400)
      expect(
        (await call('DELETE', '/smtp', owner.headers, { currentPassword: 'не тот пароль' })).status,
      ).toBe(403)
      expect(await settingsRow(api)).toBeDefined()
    })

    it(`после ${PASSWORD_CONFIRM_FAILURES.max} неудач — 429 даже с верным паролем; удачи не считаются`, async () => {
      // Удачные попытки лимит не тратят
      for (let i = 0; i < PASSWORD_CONFIRM_FAILURES.max + 2; i++) {
        expect((await call('PUT', '/smtp', owner.headers, saveDirect())).status).toBe(200)
      }
      for (let i = 0; i < PASSWORD_CONFIRM_FAILURES.max; i++) {
        const res = await call('PUT', '/smtp', owner.headers, {
          ...saveDirect(),
          currentPassword: `не тот пароль ${i}`,
        })
        expect(res.status).toBe(403)
      }
      const blocked = await call('PUT', '/smtp', owner.headers, saveDirect())
      expect(blocked.status).toBe(429)
      expect(blocked.json.error.code).toBe('rate_limited')
      expect(blocked.json.error.message).toContain('неверных попыток ввести пароль')
      expect(
        (await call('DELETE', '/smtp', owner.headers, { currentPassword: TEST_PASSWORD })).status,
      ).toBe(429)
      // Счётчик у каждого пользователя свой
      const other = await api.loginAs('owner')
      expect((await call('PUT', '/smtp', other.headers, saveDirect())).status).toBe(200)
    })
  })

  describe('сохранение только после проверки или явно «без проверки»', () => {
    it('ни итога проверки, ни «без проверки» — 400', async () => {
      const res = await call('PUT', '/smtp', owner.headers, {
        ...fields(),
        password: SMTP_PASSWORD,
        currentPassword: TEST_PASSWORD,
      })
      expect(res.status).toBe(400)
      expect(res.json.error.issues).toEqual([
        {
          path: 'checkToken',
          message: 'Сначала проверьте подключение — или сохраните без проверки',
        },
      ])
      expect(await settingsRow(api)).toBeUndefined()
    })

    it('итог проверки других настроек, чужой или поддельный — 409, ничего не сохранено', async () => {
      const check = await call('POST', '/smtp/check', owner.headers, {
        ...fields(),
        password: SMTP_PASSWORD,
        to: 'anna@example.ru',
      })
      const save = (change: Record<string, unknown>, headers = owner.headers) =>
        call('PUT', '/smtp', headers, {
          ...fields(),
          password: SMTP_PASSWORD,
          currentPassword: TEST_PASSWORD,
          checkToken: check.json.checkToken,
          ...change,
        })
      for (const change of [
        { fromName: 'Другое имя' },
        { password: 'другой пароль' },
        { port: 587, security: 'starttls' },
        { checkToken: `${Date.now()}.${'A'.repeat(43)}` },
      ]) {
        const res = await save(change)
        expect(res.status, JSON.stringify(change)).toBe(409)
        expect(res.json.error.code).toBe('check_stale')
      }
      const other = await api.loginAs('owner')
      expect((await save({}, other.headers)).status).toBe(409)
      expect(await settingsRow(api)).toBeUndefined()

      expect((await save({})).status).toBe(200)
    })

    it('«без проверки» сохраняет, но не отмечает настройки проверенными', async () => {
      const res = await call('PUT', '/smtp', owner.headers, saveDirect())
      expect(res.status).toBe(200)
      expect(res.json.smtp.settings.verifiedAt).toBeNull()
      expect((await settingsRow(api))?.verifiedAt).toBeNull()
    })
  })

  describe('пароль SMTP только на запись', () => {
    it('пустое поле оставляет прежний пароль', async () => {
      await call('PUT', '/smtp', owner.headers, saveDirect())
      const res = await call('PUT', '/smtp', owner.headers, {
        ...saveDirect(),
        password: '',
        fromName: 'Студия Averra',
      })
      expect(res.status).toBe(200)
      expect(res.json.changed).toEqual(['имя отправителя'])
      const row = await settingsRow(api)
      expect(api.secretBox?.decrypt(row?.passwordEncrypted ?? '', MAIL_PASSWORD_CONTEXT)).toBe(
        SMTP_PASSWORD,
      )
      // Тот же пароль ещё раз — не изменение
      const same = await call('PUT', '/smtp', owner.headers, saveDirect())
      expect(same.json.changed).toEqual(['имя отправителя'])
      expect(same.json.notified).toBe(await ownerCount())
      const nothing = await call('PUT', '/smtp', owner.headers, saveDirect())
      expect(nothing.json).toMatchObject({ changed: [], notified: 0 })
    })

    it('сменили сервер — пароль SMTP нужно ввести заново: и для проверки, и для сохранения', async () => {
      await call('PUT', '/smtp', owner.headers, saveDirect())
      const other = { ...fields(), host: '127.0.0.1' }
      const check = await call('POST', '/smtp/check', owner.headers, { ...other, to: 'a@b.ru' })
      expect(check.status).toBe(400)
      expect(check.json.error.issues).toEqual([
        {
          path: 'password',
          message:
            'Сервер другой — введите пароль SMTP: сохранённый пароль уходит только на сохранённый сервер (localhost)',
        },
      ])
      const save = await call('PUT', '/smtp', owner.headers, {
        ...saveDirect(),
        ...other,
        password: '',
      })
      expect(save.status).toBe(400)
      expect(save.json.error.issues[0].path).toBe('password')
      // Сервер на 127.0.0.1 сохранённого пароля не получил
      expect(tls465.logins).toHaveLength(0)

      // С сохранённым паролем к тому же серверу — пожалуйста
      const same = await call('POST', '/smtp/check', owner.headers, {
        ...fields(),
        to: owner.user.email,
      })
      expect(same.json.ok).toBe(true)
    })

    it('проверка с сохранённым паролем — только по сохранённым настройкам и только на почту владельца', async () => {
      await call('PUT', '/smtp', owner.headers, saveDirect())
      // Логин, адрес или имя отправителя из запроса ушли бы в письмо через ящик студии
      for (const [change, label] of [
        [{ user: 'other@averra.test' }, 'логин'],
        [{ fromAddress: 'ceo@averra.test' }, 'адрес отправителя'],
        [{ fromName: 'Служба безопасности банка' }, 'имя отправителя'],
        [{ port: 587, security: 'starttls' }, 'порт и шифрование'],
      ] as const) {
        const res = await call('POST', '/smtp/check', owner.headers, {
          ...fields(),
          ...change,
          to: owner.user.email,
        })
        expect(res.status, label).toBe(400)
        expect(res.json.error.issues).toEqual([
          {
            path: 'password',
            message: `Вы поменяли: ${label}. С сохранённым паролем SMTP проверка идёт только по сохранённым настройкам — введите пароль SMTP или сохраните без проверки`,
          },
        ])
      }
      // На чужой адрес — тоже нет, даже по сохранённым настройкам
      const foreignTo = await call('POST', '/smtp/check', owner.headers, {
        ...fields(),
        to: 'victim@example.ru',
      })
      expect(foreignTo.status).toBe(400)
      expect(foreignTo.json.error.issues).toEqual([
        {
          path: 'to',
          message: `С сохранённым паролем SMTP проверочное письмо уходит только на вашу почту (${owner.user.email}). Чтобы проверить другой адрес, введите пароль SMTP`,
        },
      ])
      // Ни одна из этих попыток не дошла до сервера и не потратила лимит проверок
      expect(tls465.logins).toHaveLength(0)
      expect(starttls587.logins).toHaveLength(0)
      expect(tls465.received).toHaveLength(0)

      // По сохранённым настройкам на свою почту (в любом регистре) — проверка идёт
      const own = await call('POST', '/smtp/check', owner.headers, {
        ...fields(),
        to: owner.user.email.toUpperCase(),
      })
      expect(own.json.ok).toBe(true)
      // С паролем, введённым заново, — любые настройки и любой адрес
      const typed = await call('POST', '/smtp/check', owner.headers, {
        ...fields(),
        fromName: 'Студия Averra',
        password: SMTP_PASSWORD,
        to: 'anna@example.ru',
      })
      expect(typed.json.ok).toBe(true)
      expect(tls465.received.map((mail) => mail.to[0])).toEqual([
        owner.user.email.toUpperCase(),
        'anna@example.ru',
      ])
      // Сохранить изменённые настройки с сохранённым паролем можно: там нужен пароль владельца
      const saved = await call('PUT', '/smtp', owner.headers, {
        ...saveDirect(),
        fromName: 'Студия Averra',
        password: '',
      })
      expect(saved.status).toBe(200)
      expect(saved.json.changed).toEqual(['имя отправителя'])
    })

    it('без сохранённых настроек пустой пароль — 400 «Введите пароль SMTP»', async () => {
      const check = await call('POST', '/smtp/check', owner.headers, { ...fields(), to: 'a@b.ru' })
      expect(check.status).toBe(400)
      expect(check.json.error.issues).toEqual([
        { path: 'password', message: 'Введите пароль SMTP' },
      ])
      expect(
        (await call('PUT', '/smtp', owner.headers, { ...saveDirect(), password: '' })).status,
      ).toBe(400)
    })
  })

  describe('проверка подключения', () => {
    it('неверный пароль — сломан вход, пароля нет ни в ответе, ни в его base64', async () => {
      const wrong = 'wrong-Пароль-42'
      const res = await call('POST', '/smtp/check', owner.headers, {
        ...fields(),
        password: wrong,
        to: 'anna@example.ru',
      })
      expect(res.status).toBe(200)
      expect(res.json.ok).toBe(false)
      expect(res.json.checkToken).toBeNull()
      expect(
        res.json.steps.map((step: { step: string; ok: boolean }) => `${step.step}:${step.ok}`),
      ).toEqual(['dns:true', 'connection:true', 'tls:true', 'auth:false'])
      const auth = res.json.steps.at(-1).message as string
      expect(auth).toContain('Сервер не принял логин или пароль SMTP')
      expect(auth).toContain('Пароль *** не подходит')
      expect(res.text).not.toContain(wrong)
      expect(res.text).not.toContain(Buffer.from(wrong).toString('base64'))
      expect(tls465.received).toHaveLength(0)
    })

    it('STARTTLS на 587: все шаги проходят', async () => {
      const res = await call('POST', '/smtp/check', owner.headers, {
        ...fields(587),
        password: SMTP_PASSWORD,
        to: 'anna@example.ru',
      })
      expect(res.json.ok).toBe(true)
      expect(starttls587.logins).toEqual([{ username: SMTP_USER, secure: true }])
    })

    it('сертификат не от доверенного CA — сломан TLS, пароль не передан', async () => {
      ports[465] = foreign.port
      const res = await call('POST', '/smtp/check', owner.headers, {
        ...fields(),
        password: SMTP_PASSWORD,
        to: 'anna@example.ru',
      })
      expect(res.json.ok).toBe(false)
      expect(
        res.json.steps.map((step: { step: string; ok: boolean }) => `${step.step}:${step.ok}`),
      ).toEqual(['dns:true', 'connection:true', 'tls:false'])
      expect(res.json.steps.at(-1).message).toContain('сертификат сервера не прошёл проверку')
      expect(foreign.logins).toHaveLength(0)
    })

    it('другие порты, чужая пара порт-режим, лишние поля и переводы строк — 400 без подключения', async () => {
      const bodies = [
        { ...fields(), port: 25 },
        { ...fields(), port: 2525, security: 'starttls' },
        { ...fields(), port: 465, security: 'starttls' },
        { ...fields(), port: 587, security: 'tls' },
        { ...fields(), security: 'none' },
        { ...fields(), rejectUnauthorized: false },
        { ...fields(), tls: { rejectUnauthorized: false } },
        { ...fields(), ignoreTLS: true },
        { ...fields(), host: 'localhost\r\nRCPT TO:<x@y.ru>' },
        { ...fields(), user: `${SMTP_USER}\nx` },
        { ...fields(), fromAddress: 'noreply@averra.test\r\nBcc: x@y.ru' },
        { ...fields(), fromName: 'Averra\nBcc: x@y.ru' },
        { ...fields(), host: 'smtp://localhost' },
      ]
      for (const body of bodies) {
        const check = await call('POST', '/smtp/check', owner.headers, {
          ...body,
          password: SMTP_PASSWORD,
          to: 'anna@example.ru',
        })
        expect(check.status, JSON.stringify(body)).toBe(400)
        expect(check.json.error.code).toBe('validation')
        const save = await call('PUT', '/smtp', owner.headers, {
          ...body,
          password: SMTP_PASSWORD,
          currentPassword: TEST_PASSWORD,
          skipCheck: true,
        })
        expect(save.status, JSON.stringify(body)).toBe(400)
      }
      for (const server of [tls465, starttls587, foreign]) expect(server.logins).toHaveLength(0)
      expect(await settingsRow(api)).toBeUndefined()
      // Отказы схемы лимит проверок не тратят
      const ok = await call('POST', '/smtp/check', owner.headers, {
        ...fields(),
        password: SMTP_PASSWORD,
        to: 'anna@example.ru',
      })
      expect(ok.json.ok).toBe(true)
    })

    it(`больше ${SMTP_CHECKS.max} проверок за 15 минут — 429`, async () => {
      for (let i = 0; i < SMTP_CHECKS.max; i++) {
        const res = await call('POST', '/smtp/check', owner.headers, {
          ...fields(),
          password: 'wrong-password',
          to: 'anna@example.ru',
        })
        expect(res.status).toBe(200)
      }
      const blocked = await call('POST', '/smtp/check', owner.headers, {
        ...fields(),
        password: SMTP_PASSWORD,
        to: 'anna@example.ru',
      })
      expect(blocked.status).toBe(429)
      expect(blocked.json.error.message).toContain('Слишком много проверок подключения')
      expect(tls465.logins).toHaveLength(SMTP_CHECKS.max)
    })
  })

  it('смену настроек подхватывает обработчик очереди без перезапуска', async () => {
    await call('PUT', '/smtp', owner.headers, saveDirect(465))
    const worker = startMailWorker({
      db: api.db,
      mailer: api.mailRuntime.mailer,
      ...api.mailSettings,
      intervalMs: 20,
    })
    const until = async (check: () => boolean) => {
      const start = Date.now()
      while (!check()) {
        if (Date.now() - start > 10_000) throw new Error('не дождались письма')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    try {
      const mail = (to: string) => ({
        template: 'mail-test' as const,
        data: { sentAt: new Date().toISOString(), provider: 'тест' },
        to,
      })
      await enqueueMail(api.db, mail('first@example.ru'))
      await until(() => tls465.received.some((item) => item.to[0] === 'first@example.ru'))

      // Новые настройки: другой сервер и режим. Письмо владельцам о смене — уже через него
      expect((await call('PUT', '/smtp', owner.headers, saveDirect(587))).status).toBe(200)
      await enqueueMail(api.db, mail('second@example.ru'))
      await until(() => starttls587.received.some((item) => item.to[0] === 'second@example.ru'))
      await until(() => starttls587.received.some((item) => item.to[0] === owner.user.email))
      expect(tls465.received.map((item) => item.to[0])).not.toContain('second@example.ru')
    } finally {
      await worker.stop()
    }
  })

  it('между коммитом смены и пересборкой провайдера обработчик ждёт: письмо о смене уходит новым провайдером', async () => {
    // Обработчик очереди спрашивает провайдера ровно тогда, когда транзакция с новыми настройками
    // и письмами владельцам уже закоммичена, а провайдер ещё не пересобран. Без runtime.exclusive
    // он получил бы прежнего, и письмо «Настройки почты изменены» ушло бы не через новые настройки
    const transaction = api.db.transaction.bind(api.db)
    const asked: Promise<Mailer | undefined>[] = []
    const spy = vi.spyOn(api.db, 'transaction').mockImplementation(async (run, config) => {
      const result = await transaction(run, config)
      asked.push(api.mailRuntime.mailer())
      return result
    })
    try {
      // Было: почта по умолчанию (в памяти). Стало: SMTP 587
      expect((await call('PUT', '/smtp', owner.headers, saveDirect(587))).status).toBe(200)
      expect((await asked.at(-1))?.info).toMatchObject({ kind: 'smtp', port: 587 })
      await sendQueue(api)
      expect(starttls587.received.map((mail) => mail.to[0])).toContain(owner.user.email)
      expect(fallback.sent).toHaveLength(0)

      // Было: SMTP 587. Стало: снова почта по умолчанию — письмо об удалении уходит через неё
      expect(
        (await call('DELETE', '/smtp', owner.headers, { currentPassword: TEST_PASSWORD })).status,
      ).toBe(200)
      expect((await asked.at(-1))?.info.kind).toBe('memory')
      starttls587.received.length = 0
      await sendQueue(api)
      expect(fallback.sent.map((mail) => mail.to)).toContain(owner.user.email)
      expect(starttls587.received).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('перечитать настройки после коммита не вышло — ответ 200, запись в журнале, удалённый SMTP не отправляет', async () => {
    await call('PUT', '/smtp', owner.headers, saveDirect(465))
    expect((await api.mailRuntime.mailer())?.info).toMatchObject({ kind: 'smtp', port: 465 })
    await api.db.delete(mailOutbox)
    logs.length = 0
    const wakes = api.mailWakes.count
    // Удаление закоммичено, а первое же чтение после коммита — пересборка провайдера — падает
    const transaction = api.db.transaction.bind(api.db)
    const select = vi.spyOn(api.db, 'select')
    const spy = vi.spyOn(api.db, 'transaction').mockImplementation(async (run, config) => {
      const result = await transaction(run, config)
      select.mockImplementationOnce(() => {
        throw new Error('база недоступна')
      })
      return result
    })
    try {
      const res = await call('DELETE', '/smtp', owner.headers, { currentPassword: TEST_PASSWORD })
      expect(res.status).toBe(200)
    } finally {
      spy.mockRestore()
      select.mockRestore()
    }
    // Изменение в журнале есть, обработчик разбужен
    expect(logs.filter((line) => line.startsWith('['))).toEqual([
      expect.stringContaining('Настройки почты (SMTP) удалены из админки'),
    ])
    expect(logs.join('\n')).toContain('не смог перечитать настройки почты')
    expect(api.mailWakes.count).toBeGreaterThan(wakes)
    // Пока настройки не перечитаны, почта на паузе — а не на удалённом SMTP
    const paused = (await call('GET', '', owner.headers)).json.status
    expect(paused).toMatchObject({ enabled: false })

    // Обработчик берёт провайдера — рантайм перечитывает настройки, письмо об удалении уходит
    // почтой по умолчанию, на удалённый сервер — ничего
    await sendQueue(api)
    expect(fallback.sent.map((mail) => mail.to)).toContain(owner.user.email)
    expect(tls465.received).toHaveLength(0)
    expect((await call('GET', '', owner.headers)).json.status.provider.kind).toBe('memory')
  })

  it('удаление: почта возвращается к варианту по умолчанию, владельцам — письмо, в лог — запись', async () => {
    expect(
      (await call('DELETE', '/smtp', owner.headers, { currentPassword: TEST_PASSWORD })).status,
    ).toBe(404)
    await call('PUT', '/smtp', owner.headers, saveDirect())
    await api.db.delete(mailOutbox)
    logs.length = 0

    const res = await call('DELETE', '/smtp', owner.headers, { currentPassword: TEST_PASSWORD })
    expect(res.status).toBe(200)
    expect(res.json.smtp).toMatchObject({ source: 'none', settings: null })
    expect(res.json.notified).toBe(await ownerCount())
    expect(await settingsRow(api)).toBeUndefined()
    expect((await call('GET', '', owner.headers)).json.status.provider.kind).toBe('memory')

    await sendQueue(api)
    const notice = fallback.sent.find((mail) => mail.to === owner.user.email)
    expect(notice?.text).toContain('Настройки SMTP удалены из админки')
    expect(logs.filter((line) => line.startsWith('['))).toEqual([
      expect.stringContaining('Настройки почты (SMTP) удалены из админки'),
    ])
  })
})

describe('сбой базы при сохранении', () => {
  it('в лог — запрос без параметров: ни зашифрованного пароля, ни строки из подробностей Postgres', async () => {
    const { api } = await smtpApi()
    const errors: string[] = []
    // Как это напечатала бы консоль: объекты — через inspect, со стеком и причинами
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(
        args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 10 }))).join(' '),
      )
    })
    try {
      const { headers } = await api.loginAs('owner')
      // Запись в mail_settings падает в самой базе: CHECK, который не пропускает ни одной строки
      await api.db.execute(
        sql`alter table mail_settings add constraint test_always_fails check (false)`,
      )
      const res = await client(api)('PUT', '/smtp', headers, saveDirect())
      expect(res.status).toBe(500)
      expect(res.json).toEqual({
        error: { code: 'internal', message: 'Внутренняя ошибка сервера' },
      })
      expect(await settingsRow(api)).toBeUndefined()

      const logged = errors.join('\n')
      // Что случилось, видно: запрос с плейсхолдерами, причина из базы и место в коде
      expect(logged).toContain('Запрос к базе не выполнен: insert into "mail_settings"')
      expect(logged).toContain('test_always_fails')
      expect(logged).toMatch(/\n\s+at /)
      // А значений — нет: ни параметров запроса, ни строки целиком из detail
      const keyId = api.secretBox?.encrypt('x', MAIL_PASSWORD_CONTEXT).split('.')[1]
      expect(keyId).toEqual(expect.any(String))
      for (const secret of [`v1.${keyId}.`, 'params:', 'Failing row', SMTP_USER, SMTP_PASSWORD]) {
        expect(logged).not.toContain(secret)
      }
    } finally {
      spy.mockRestore()
      await api.close()
    }
  })
})

describe('SMTP в окружении главнее админки', () => {
  const ENV_PASSWORD = 'env-smtp-secret-password'

  it('админка показывает его только для чтения и без пароля, а настройки в базе не действуют', async () => {
    resetServers()
    const { api } = await smtpApi({
      envSmtp: {
        host: 'smtp.env.example',
        port: 587,
        security: 'starttls',
        user: 'env@example.ru',
        password: ENV_PASSWORD,
        from: { address: 'env@example.ru', name: 'Из окружения' },
      },
    })
    try {
      const { headers } = await api.loginAs('owner')
      const call = client(api)
      const view = await call('GET', '/smtp', headers)
      expect(view.json).toMatchObject({
        source: 'env',
        editable: false,
        lock: { reason: 'env', message: expect.stringContaining('SMTP_*') },
        settings: {
          host: 'smtp.env.example',
          port: 587,
          security: 'starttls',
          user: 'env@example.ru',
          fromAddress: 'env@example.ru',
          fromName: 'Из окружения',
          password: 'set',
        },
      })
      expect(view.text).not.toContain(ENV_PASSWORD)

      for (const [method, path, body] of [
        ['POST', '/smtp/check', { ...fields(), password: SMTP_PASSWORD, to: 'a@b.ru' }],
        ['PUT', '/smtp', saveDirect()],
        ['DELETE', '/smtp', { currentPassword: TEST_PASSWORD }],
      ] as const) {
        const res = await call(method, path, headers, body)
        expect(res.status, path).toBe(409)
        expect(res.json.error.code).toBe('mail_settings_locked')
      }
      expect(tls465.logins).toHaveLength(0)

      // Строка в базе (осталась с прошлых времён) не перебивает окружение
      await api.db.insert(mailSettings).values({
        host: 'localhost',
        port: 465,
        security: 'tls',
        username: SMTP_USER,
        passwordEncrypted: api.secretBox?.encrypt(SMTP_PASSWORD, MAIL_PASSWORD_CONTEXT) ?? '',
        fromAddress: 'noreply@averra.test',
        fromName: 'Averra CMS',
      })
      await api.mailRuntime.reload()
      const status = (await call('GET', '', headers)).json.status
      expect(status.provider).toMatchObject({ kind: 'smtp', host: 'smtp.env.example' })
      expect((await call('GET', '/smtp', headers)).json.source).toBe('env')
    } finally {
      await api.close()
    }
  })
})

describe('ключ шифрования', () => {
  it('нет ключа — править нельзя, а страница объясняет, как его сгенерировать', async () => {
    const { api } = await smtpApi({ mailKey: null })
    try {
      const { headers } = await api.loginAs('owner')
      const call = client(api)
      const view = await call('GET', '/smtp', headers)
      expect(view.json).toMatchObject({ source: 'none', editable: false, key: null })
      expect(view.json.lock.reason).toBe('no_key')
      expect(view.json.lock.message).toContain('MAIL_ENCRYPTION_KEY')
      expect(view.json.lock.message).toContain('openssl rand -base64 32')
      for (const [method, path, body] of [
        ['POST', '/smtp/check', { ...fields(), password: SMTP_PASSWORD, to: 'a@b.ru' }],
        ['PUT', '/smtp', saveDirect()],
      ] as const) {
        expect((await call(method, path, headers, body)).status, path).toBe(409)
      }

      // Настройки в базе есть, а ключа нет: почта выключена с причиной, API отвечает
      const other = aesGcmSecretBox(randomBytes(KEY_BYTES))
      await api.db.insert(mailSettings).values({
        host: 'localhost',
        port: 465,
        security: 'tls',
        username: SMTP_USER,
        passwordEncrypted: other.encrypt(SMTP_PASSWORD, MAIL_PASSWORD_CONTEXT),
        fromAddress: 'noreply@averra.test',
        fromName: 'Averra CMS',
      })
      await api.mailRuntime.reload()
      const status = (await call('GET', '', headers)).json.status
      expect(status.enabled).toBe(false)
      expect(status.reason).toContain('без MAIL_ENCRYPTION_KEY')
      const stored = await call('GET', '/smtp', headers)
      expect(stored.json).toMatchObject({
        source: 'database',
        editable: false,
        settings: { password: 'unreadable', passwordProblem: 'no_key' },
      })
    } finally {
      await api.close()
    }
  })

  it('ключ не тот — почта выключена с причиной «введите пароль заново», новый пароль её чинит', async () => {
    resetServers()
    const { api } = await smtpApi({ mail: 'off' })
    try {
      const { headers } = await api.loginAs('owner')
      const call = client(api)
      // Пароль зашифровали другим ключом (MAIL_ENCRYPTION_KEY сменили)
      const previousKey = aesGcmSecretBox(randomBytes(KEY_BYTES))
      await api.db.insert(mailSettings).values({
        host: 'localhost',
        port: 465,
        security: 'tls',
        username: SMTP_USER,
        passwordEncrypted: previousKey.encrypt(SMTP_PASSWORD, MAIL_PASSWORD_CONTEXT),
        fromAddress: 'noreply@averra.test',
        fromName: 'Averra CMS',
      })
      await api.mailRuntime.reload()

      const status = (await call('GET', '', headers)).json.status
      expect(status.enabled).toBe(false)
      expect(status.reason).toContain('Введите пароль SMTP заново')
      expect((await api.app.request('/api/health')).status).toBe(200)
      // Сброс пароля честно говорит, что почта не работает
      expect(await (await api.app.request('/api/password-reset')).json()).toEqual({
        available: false,
      })
      expect((await call('GET', '/smtp', headers)).json).toMatchObject({
        source: 'database',
        editable: true,
        settings: { password: 'unreadable', passwordProblem: 'wrong_key' },
      })

      const keep = await call('POST', '/smtp/check', headers, { ...fields(), to: 'a@b.ru' })
      expect(keep.status).toBe(400)
      expect(keep.json.error.issues[0].message).toContain(
        'не расшифровывается — введите его заново',
      )
      expect((await call('PUT', '/smtp', headers, { ...saveDirect(), password: '' })).status).toBe(
        400,
      )

      expect((await call('PUT', '/smtp', headers, saveDirect())).status).toBe(200)
      expect((await call('GET', '', headers)).json.status.enabled).toBe(true)
      expect((await call('GET', '/smtp', headers)).json.settings).toMatchObject({
        password: 'set',
        passwordProblem: null,
      })
      // Состояние почты в других маршрутах — тоже нынешнее, без перезапуска
      expect(await (await api.app.request('/api/password-reset')).json()).toEqual({
        available: true,
      })
    } finally {
      await api.close()
    }
  })
})
