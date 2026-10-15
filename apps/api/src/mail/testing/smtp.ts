/// <reference path="./smtp-server.d.ts" />
import type { AddressInfo } from 'node:net'
import { SMTPServer } from 'smtp-server'

export { createTestCa, issueServerCert, type TestCa } from './certs'

// Настоящий SMTP-сервер для тестов: на свободном порту 127.0.0.1, с сертификатом от своего
// тестового CA. Клиент доверяет этому CA только явно — параметром ca у smtpMailer (тесты API)
// или через NODE_EXTRA_CA_CERTS у отдельного процесса API (e2e, см. e2e/scripts/smtp-certs.ts)

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
  /** Порт. По умолчанию свободный; e2e слушает настоящий 587: настройки в админке пускают только 465 и 587 */
  port?: number
}

export async function startTestSmtpServer({
  mode,
  cert,
  starttls = true,
  users = { 'noreply@averra.test': 'smtp-secret-password' },
  authError = () => 'Неверный логин или пароль',
  port: listenPort = 0,
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
  await new Promise<void>((resolve, reject) => {
    // Занятый порт (e2e слушает 587) — понятная ошибка, а не тихо зависший тест
    server.server.once('error', reject)
    server.listen(listenPort, '127.0.0.1', () => {
      server.server.off('error', reject)
      resolve()
    })
  })
  const { port } = server.server.address() as AddressInfo
  return {
    port,
    received,
    logins,
    close: () => new Promise<void>((resolve) => server.close(resolve)),
  }
}
