import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MailSendError } from './mailer'
import { diagnoseSmtp, type SmtpSettings, smtpFailure, smtpMailer } from './smtp-mailer'
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

  it('чужой отправитель (553 на MAIL FROM, как у Яндекс 360) — сбой настроек, а не письма', async () => {
    const smtp = await server({ mode: 'tls', ownSendersOnly: true })
    const mailer = smtpMailer(
      { ...settings(smtp.port, 'tls'), from: { address: 'info@averra.test', name: 'Averra CMS' } },
      { ca: ca.cert, timeouts: fastTimeouts },
    )
    const error = await sendError(mailer.send(mail))
    await mailer.close()

    // Не окончательный отказ письма: так очередь не сожжёт все письма за один проход
    expect(error.permanent).toBe(false)
    expect(error.rejectedSender).toBe(true)
    expect(error.step).toBe('send')
    expect(error.message).toContain('Сервер не принял адрес отправителя info@averra.test')
    expect(error.message).toContain(`под которым идёт вход (${USER})`)
    expect(error.message).toContain('Sender address rejected')
    expect(smtp.received).toHaveLength(0)
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

describe('какой отказ окончательный', () => {
  /** Ошибка конверта так, как её отдаёт nodemailer: код, команда и ответ сервера */
  const envelopeError = (command: string, response: string) =>
    Object.assign(new Error(`Command failed: ${response}`), {
      code: command === 'DATA' ? 'EMESSAGE' : 'EENVELOPE',
      command,
      response,
      responseCode: Number(response.slice(0, 3)),
    })

  it.each([
    ['RCPT TO', '550 5.1.1 Mailbox does not exist'],
    ['DATA', '554 5.7.1 Message rejected as spam'],
  ])('5xx на %s — окончательный отказ этого письма', (command, response) => {
    const error = smtpFailure(envelopeError(command, response), settings(465, 'tls'))
    expect(error).toMatchObject({ step: 'send', permanent: true, rejectedSender: false })
  })

  it.each([
    '553 5.7.1 Sender address rejected: not owned by auth user.',
    '451 4.7.1 Too many messages, try later',
  ])(
    'отказ на MAIL FROM (%s) — настройки или сервер, а не письмо: не окончательный',
    (response) => {
      const error = smtpFailure(envelopeError('MAIL FROM', response), settings(465, 'tls'))
      expect(error).toMatchObject({ step: 'send', permanent: false, rejectedSender: true })
    },
  )
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

  it('чужой отправитель — ломается отправка, а подсказка — про адрес отправителя и логин', async () => {
    const smtp = await server({ mode: 'starttls', ownSendersOnly: true })
    const result = await diagnoseSmtp(
      { ...settings(smtp.port, 'starttls'), from: { address: 'info@averra.test', name: 'A' } },
      mail,
      { ca: ca.cert, timeouts: fastTimeouts },
    )
    expect(titles(result.steps)).toEqual([
      'dns:ok',
      'connection:ok',
      'tls:ok',
      'auth:ok',
      'send:fail',
    ])
    const message = result.steps.at(-1)?.message ?? ''
    expect(message).toContain('Сервер не принял адрес отправителя info@averra.test')
    expect(message).toContain(
      `он должен принадлежать ящику, под которым идёт вход (${USER}), а у Яндекс 360 — совпадать с логином или быть его алиасом`,
    )
    expect(message).toContain('Проверь MAIL_FROM и SMTP_USER')
    expect(message).toContain('Sender address rejected')
    expect(smtp.received).toHaveLength(0)
  })

  it('STARTTLS на порту, который ждёт TLS сразу, — сломан TLS с подсказкой, а не «соединение»', async () => {
    const smtp = await server({ mode: 'tls' })
    const result = await diagnoseSmtp(settings(smtp.port, 'starttls'), mail, {
      ca: ca.cert,
      timeouts: { ...fastTimeouts, greeting: 300 },
    })
    // Соединение прошло один раз и не «ломается» вторым результатом того же шага
    expect(titles(result.steps)).toEqual(['dns:ok', 'connection:ok', 'tls:fail'])
    const message = result.steps.at(-1)?.message ?? ''
    expect(message).toContain('похоже, порт ждёт TLS сразу: для 465 нужен SMTP_SECURITY=tls')
    expect(message).not.toContain('файрвол')
  })
})

describe('SMTP из настроек админки', () => {
  it('connectPort (только тесты) ведёт на другой порт, а в описании и ошибках — порт из настроек', async () => {
    const smtp = await server({ mode: 'tls' })
    const mailer = smtpMailer(settings(465, 'tls'), {
      ca: ca.cert,
      timeouts: fastTimeouts,
      connectPort: () => smtp.port,
    })
    await mailer.send(mail)
    await mailer.close()
    expect(smtp.received).toHaveLength(1)
    expect(mailer.info).toMatchObject({ port: 465 })

    const result = await diagnoseSmtp(settings(465, 'tls', 'wrong-password'), mail, {
      ca: ca.cert,
      timeouts: fastTimeouts,
      connectPort: () => smtp.port,
    })
    expect(result.steps.map((step) => step.ok)).toEqual([true, true, true, false])
  })

  it('подсказки называют поля формы, а не переменные окружения', async () => {
    const smtp = await server({ mode: 'tls' })
    const wrong = await diagnoseSmtp(settings(smtp.port, 'tls', 'wrong-password'), mail, {
      ca: ca.cert,
      timeouts: fastTimeouts,
      origin: 'admin',
    })
    const auth = wrong.steps.at(-1)?.message ?? ''
    expect(auth).toContain('Сервер не принял логин или пароль SMTP: проверьте логин и пароль')
    expect(auth).not.toContain('SMTP_USER')

    const dns = await diagnoseSmtp(
      { ...settings(465, 'tls'), host: 'smtp.averra-cms-test.invalid' },
      mail,
      { timeouts: fastTimeouts, origin: 'admin' },
    )
    expect(dns.steps[0]?.message).toContain('проверьте поле «Сервер SMTP»')
    expect(dns.steps[0]?.message).not.toContain('SMTP_HOST')

    // Без origin — как раньше, для pnpm mail:test и SMTP из окружения
    const env = await diagnoseSmtp(
      { ...settings(465, 'tls'), host: 'smtp.averra-cms-test.invalid' },
      mail,
      { timeouts: fastTimeouts },
    )
    expect(env.steps[0]?.message).toContain('проверь SMTP_HOST')

    const sender = await server({ mode: 'tls', ownSendersOnly: true })
    const foreignSender = await diagnoseSmtp(
      { ...settings(sender.port, 'tls'), from: { address: 'info@averra.test', name: 'A' } },
      mail,
      { ca: ca.cert, timeouts: fastTimeouts, origin: 'admin' },
    )
    const send = foreignSender.steps.at(-1)?.message ?? ''
    expect(send).toContain('Проверьте поля «Адрес отправителя» и «Логин»')
    expect(send).not.toContain('MAIL_FROM')
  })
})
