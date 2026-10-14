import type { AddressInfo } from 'node:net'
import { generate } from 'selfsigned'
import { SMTPServer } from 'smtp-server'

// Настоящий SMTP-сервер для тестов: на свободном порту 127.0.0.1, с сертификатом от своего
// тестового CA. Клиент доверяет этому CA только явно — параметром ca у smtpMailer

export type TestCa = { key: string; cert: string }

const yearFromNow = () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

/** Тестовый корневой сертификат. Каждый вызов — новый CA: «чужой» для сертификатов другого */
export async function createTestCa(name = 'Averra CMS Test CA'): Promise<TestCa> {
  const pems = await generate([{ name: 'commonName', value: name }], {
    keyType: 'ec',
    algorithm: 'sha256',
    notAfterDate: yearFromNow(),
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
  })
  return { key: pems.private, cert: pems.cert }
}

/**
 * Сертификат сервера, подписанный CA. По умолчанию — на localhost и 127.0.0.1; с другим
 * именем — чтобы проверить, что сертификат от доверенного CA, но на чужое имя, не принимается
 */
export async function issueServerCert(ca: TestCa, name = 'localhost') {
  const altNames =
    name === 'localhost'
      ? [
          { type: 2 as const, value: 'localhost' },
          { type: 7 as const, ip: '127.0.0.1' },
        ]
      : [{ type: 2 as const, value: name }]
  const pems = await generate([{ name: 'commonName', value: name }], {
    keyType: 'ec',
    algorithm: 'sha256',
    notAfterDate: yearFromNow(),
    ca,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  })
  return { key: pems.private, cert: pems.cert }
}

/** Что получил сервер */
export type ReceivedMail = {
  user?: string
  secure: boolean
  from: string | undefined
  to: string[]
  raw: string
}

export type TestSmtpServerOptions = {
  /** tls — TLS сразу (как 465), starttls — обычное соединение и STARTTLS (как 587) */
  mode: 'tls' | 'starttls'
  cert: { key: string; cert: string }
  /** false — сервер не умеет STARTTLS (и разрешает вход без шифрования, как плохой сервер) */
  starttls?: boolean
  users?: Record<string, string>
  /** Свой ответ на неверный пароль: тест проверяет, что пароль из него маскируется */
  authError?: (password: string) => string
}

export async function startTestSmtpServer({
  mode,
  cert,
  starttls = true,
  users = { 'noreply@averra.test': 'smtp-secret-password' },
  authError = () => 'Неверный логин или пароль',
}: TestSmtpServerOptions) {
  const received: ReceivedMail[] = []
  const logins: { username: string; secure: boolean }[] = []
  const server = new SMTPServer({
    secure: mode === 'tls',
    key: cert.key,
    cert: cert.cert,
    logger: false,
    authMethods: ['PLAIN', 'LOGIN'],
    ...(starttls ? {} : { disabledCommands: ['STARTTLS'], allowInsecureAuth: true }),
    onAuth(auth, session, callback) {
      logins.push({ username: auth.username, secure: session.secure })
      if (users[auth.username] !== auth.password) {
        callback(Object.assign(new Error(authError(auth.password)), { responseCode: 535 }))
        return
      }
      callback(null, { user: auth.username })
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        received.push({
          user: session.user,
          secure: session.secure,
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : undefined,
          to: session.envelope.rcptTo.map((address) => address.address),
          raw: Buffer.concat(chunks).toString('utf8'),
        })
        callback()
      })
    },
  })
  // Обрыв соединения клиентом (тест отказа TLS) — не ошибка теста
  server.on('error', () => {})
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.server.address() as AddressInfo
  return {
    port,
    received,
    logins,
    close: () => new Promise<void>((resolve) => server.close(resolve)),
  }
}
