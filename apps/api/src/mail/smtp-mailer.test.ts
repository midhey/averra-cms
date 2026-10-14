import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MailSendError } from './mailer'
import { diagnoseSmtp, type SmtpSettings, smtpMailer } from './smtp-mailer'
import { createTestCa, issueServerCert, startTestSmtpServer, type TestCa } from './testing/smtp'

// Настоящий SMTP-сервер (smtp-server) на свободном порту с сертификатом от тестового CA.
// Клиент доверяет этому CA только явно, параметром ca: системные корневые тут не помогут

const PASSWORD = 'smtp-secret-password'
const USER = 'noreply@averra.test'

let ca: TestCa
let serverCert: { key: string; cert: string }
let foreignCa: TestCa
let otherNameCert: { key: string; cert: string }

beforeAll(async () => {
  ca = await createTestCa()
  serverCert = await issueServerCert(ca)
  // Тот же доверенный CA, но сертификат выдан другому имени
  otherNameCert = await issueServerCert(ca, 'other.example')
  foreignCa = await createTestCa('Чужой CA')
})

const servers: { close: () => Promise<void> }[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

type ServerOptions = Parameters<typeof startTestSmtpServer>[0]

async function server(options: Omit<ServerOptions, 'cert'> & { cert?: ServerOptions['cert'] }) {
  const started = await startTestSmtpServer({ cert: serverCert, ...options })
  servers.push(started)
  return started
}

const settings = (port: number, security: SmtpSettings['security'], password = PASSWORD) => ({
  host: 'localhost',
  port,
  security,
  user: USER,
  password,
  from: { address: USER, name: 'Averra CMS' },
})

const fastTimeouts = { connection: 5000, greeting: 5000, socket: 5000, dns: 5000 }

const mail = {
  to: 'anna@example.ru',
  subject: 'Проверка почты',
  html: '<p>Привет</p>',
  text: 'Привет',
}

async function sendError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error, 'отправка должна была сломаться').toBeInstanceOf(MailSendError)
  return error as MailSendError
}

describe('SMTP', () => {
  it('отправляет по 465: TLS сразу, сертификат проверен по явно переданному CA', async () => {
    const smtp = await server({ mode: 'tls' })
    const mailer = smtpMailer(settings(smtp.port, 'tls'), { ca: ca.cert, timeouts: fastTimeouts })
    const { messageId } = await mailer.send(mail)
    await mailer.close()

    expect(messageId).toMatch(/^<.+@averra\.test>$/)
    expect(smtp.received).toHaveLength(1)
    const [got] = smtp.received
    expect(got).toMatchObject({ user: USER, secure: true, from: USER, to: ['anna@example.ru'] })
    expect(got?.raw).toContain('From: Averra CMS <noreply@averra.test>')
    expect(got?.raw).toContain('Content-Type: text/plain')
    expect(got?.raw).toContain('Content-Type: text/html')
  })

  it('отправляет по 587: STARTTLS обязателен, вход только после шифрования', async () => {
    const smtp = await server({ mode: 'starttls' })
    const mailer = smtpMailer(settings(smtp.port, 'starttls'), {
      ca: ca.cert,
      timeouts: fastTimeouts,
    })
    await mailer.send(mail)
    await mailer.close()

    expect(smtp.received).toHaveLength(1)
    expect(smtp.received[0]?.secure).toBe(true)
    expect(smtp.logins).toEqual([{ username: USER, secure: true }])
  })

  it('сервер без STARTTLS — отказ, письмо не ушло и пароль не передан', async () => {
    const smtp = await server({ mode: 'starttls', starttls: false })
    const mailer = smtpMailer(settings(smtp.port, 'starttls'), {
      ca: ca.cert,
      timeouts: fastTimeouts,
    })
    const error = await sendError(mailer.send(mail))
    await mailer.close()

    expect(error.step).toBe('tls')
    expect(error.message).toContain('не включил шифрование STARTTLS')
    expect(smtp.received).toHaveLength(0)
    expect(smtp.logins).toHaveLength(0)
  })

  it.each(['tls', 'starttls'] as const)(
    'сертификат не из доверенного CA (%s) — отказ, пароль не передан',
    async (mode) => {
      const smtp = await server({ mode })
      const mailer = smtpMailer(settings(smtp.port, mode), {
        ca: foreignCa.cert,
        timeouts: fastTimeouts,
      })
      const error = await sendError(mailer.send(mail))
      await mailer.close()

      expect(error.step).toBe('tls')
      expect(error.message).toContain('сертификат сервера не прошёл проверку')
      expect(smtp.received).toHaveLength(0)
      expect(smtp.logins).toHaveLength(0)
    },
  )

  it('без своего CA самоподписанный сервер не принимается: системным корневым он не известен', async () => {
    const smtp = await server({ mode: 'tls' })
    const mailer = smtpMailer(settings(smtp.port, 'tls'), { timeouts: fastTimeouts })
    const error = await sendError(mailer.send(mail))
    await mailer.close()
    expect(error.step).toBe('tls')
    expect(smtp.received).toHaveLength(0)
  })

  it.each(['tls', 'starttls'] as const)(
    'NODE_TLS_REJECT_UNAUTHORIZED=0 в окружении проверку сертификата не выключает (%s)',
    async (mode) => {
      const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
      try {
        const smtp = await server({ mode })
        const mailer = smtpMailer(settings(smtp.port, mode), {
          ca: foreignCa.cert,
          timeouts: fastTimeouts,
        })
        const error = await sendError(mailer.send(mail))
        await mailer.close()
        expect(error.step).toBe('tls')
        expect(smtp.received).toHaveLength(0)
        expect(smtp.logins).toHaveLength(0)
      } finally {
        if (before === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
        else process.env.NODE_TLS_REJECT_UNAUTHORIZED = before
      }
    },
  )

  it.each(['tls', 'starttls'] as const)(
    'сертификат от доверенного CA, но на другое имя (%s) — отказ, пароль не передан',
    async (mode) => {
      const smtp = await server({ mode, cert: otherNameCert })
      const mailer = smtpMailer(settings(smtp.port, mode), { ca: ca.cert, timeouts: fastTimeouts })
      const error = await sendError(mailer.send(mail))
      await mailer.close()

      expect(error.step).toBe('tls')
      expect(error.message).toContain('сертификат сервера не прошёл проверку')
      expect(smtp.received).toHaveLength(0)
      expect(smtp.logins).toHaveLength(0)
    },
  )

  it('неверный пароль — понятная ошибка без пароля, даже если сервер повторил его в ответе', async () => {
    const wrong = 'wrong-password-42'
    const smtp = await server({
      mode: 'tls',
      authError: (password) => `Пароль ${password} не подходит`,
    })
    const mailer = smtpMailer(settings(smtp.port, 'tls', wrong), {
      ca: ca.cert,
      timeouts: fastTimeouts,
    })
    const error = await sendError(mailer.send(mail))
    await mailer.close()

    expect(error.step).toBe('auth')
    expect(error.message).toContain('Сервер не принял логин или пароль')
    expect(error.message).toContain('Пароль *** не подходит')
    expect(error.message).not.toContain(wrong)
    expect(error.message).not.toContain(Buffer.from(wrong).toString('base64'))
    expect(error.permanent).toBe(false)
  })

  it('перевод строки в теме не доходит до сервера: постоянная ошибка до соединения', async () => {
    const smtp = await server({ mode: 'tls' })
    const mailer = smtpMailer(settings(smtp.port, 'tls'), { ca: ca.cert, timeouts: fastTimeouts })
    const error = await sendError(
      mailer.send({ ...mail, subject: 'Привет\r\nBcc: all@example.ru' }),
    )
    const toError = await sendError(mailer.send({ ...mail, to: 'anna@example.ru\nBcc: x@y.ru' }))
    await mailer.close()

    expect(error.permanent).toBe(true)
    expect(toError.permanent).toBe(true)
    expect(smtp.logins).toHaveLength(0)
    expect(smtp.received).toHaveLength(0)
  })
})

describe('проверка по шагам (pnpm mail:test)', () => {
  const titles = (steps: { step: string; ok: boolean }[]) =>
    steps.map(({ step, ok }) => `${step}:${ok ? 'ok' : 'fail'}`)

  it('все шаги проходят, письмо принято', async () => {
    const smtp = await server({ mode: 'starttls' })
    const result = await diagnoseSmtp(settings(smtp.port, 'starttls'), mail, {
      ca: ca.cert,
      timeouts: fastTimeouts,
    })
    expect(titles(result.steps)).toEqual([
      'dns:ok',
      'connection:ok',
      'tls:ok',
      'auth:ok',
      'send:ok',
    ])
    expect(smtp.received).toHaveLength(1)
  })

  it('неизвестное имя — ломается DNS', async () => {
    const result = await diagnoseSmtp(
      { ...settings(465, 'tls'), host: 'smtp.averra-cms-test.invalid' },
      mail,
      { timeouts: fastTimeouts },
    )
    expect(titles(result.steps)).toEqual(['dns:fail'])
    expect(result.steps[0]?.message).toContain('не нашлось в DNS')
  })

  it('DNS не отвечает — шаг DNS ломается по тайм-ауту, а не висит', async () => {
    const started = Date.now()
    const result = await diagnoseSmtp(settings(465, 'tls'), mail, {
      timeouts: { ...fastTimeouts, dns: 50 },
      lookup: () => new Promise(() => {}),
    })
    expect(titles(result.steps)).toEqual(['dns:fail'])
    expect(result.steps[0]?.message).toContain('DNS не ответил')
    expect(result.steps[0]?.message).toContain('нет ответа за 0.05 с')
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('закрытый порт — ломается соединение', async () => {
    const smtp = await server({ mode: 'tls' })
    const { port } = smtp
    await smtp.close()
    servers.length = 0
    const result = await diagnoseSmtp(settings(port, 'tls'), mail, { timeouts: fastTimeouts })
    expect(titles(result.steps)).toEqual(['dns:ok', 'connection:fail'])
  })

  it('чужой сертификат — ломается TLS', async () => {
    const smtp = await server({ mode: 'tls' })
    const result = await diagnoseSmtp(settings(smtp.port, 'tls'), mail, {
      ca: foreignCa.cert,
      timeouts: fastTimeouts,
    })
    expect(titles(result.steps)).toEqual(['dns:ok', 'connection:ok', 'tls:fail'])
  })

  it('неверный пароль — ломается вход, пароля в сообщениях нет', async () => {
    const wrong = 'wrong-password-42'
    const smtp = await server({ mode: 'tls', authError: (password) => `bad ${password}` })
    const result = await diagnoseSmtp(settings(smtp.port, 'tls', wrong), mail, {
      ca: ca.cert,
      timeouts: fastTimeouts,
    })
    expect(titles(result.steps)).toEqual(['dns:ok', 'connection:ok', 'tls:ok', 'auth:fail'])
    expect(JSON.stringify(result.steps)).not.toContain(wrong)
  })
})
