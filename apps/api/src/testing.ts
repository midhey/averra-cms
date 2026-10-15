import { randomBytes, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { demoSiteId, setupZodMessages } from '@averra/schema'
import { createApp } from './app'
import type { MemberRole } from './auth/access'
import { createAuth } from './auth/auth'
import { DEV_AUTH_SECRET } from './config'
import { aesGcmSecretBox, KEY_BYTES } from './crypto/aes-gcm'
import { createDb } from './db/client'
import { migrateDb } from './db/migrate'
import { seedDemo } from './db/seed'
import { errorForLog } from './log-error'
import type { Mailer, SmtpSettings } from './mail/mailer'
import { memoryMailer } from './mail/memory-mailer'
import { createMailRuntime } from './mail/runtime'
import { adminSmtp, type SmtpOptions, smtpMailer } from './mail/smtp-mailer'
import { diskStorage } from './media/disk-storage'
import type { ImageProcessor } from './media/processor'
import { sharpProcessor } from './media/sharp-processor'
import { tokensRepo } from './modules/tokens/repo'
import { usersRepo } from './modules/users/repo'

/** Адреса, под которыми API видит себя и админку в тестах */
export const testOrigins = { api: 'http://localhost:4000', admin: 'http://localhost:5173' } as const

/** Пароль всех тестовых пользователей. Только для тестов */
export const TEST_PASSWORD = 'test-password-123'

export type TestRole = 'owner' | MemberRole

/**
 * API на базе в памяти с демо-сайтом — для тестов, в том числе других пакетов.
 * Помощники дают сессию нужной роли и токен: так тесты проверяют права, а не обходят их
 */
export async function createTestApi({
  production = false,
  mediaMaxBytes = 10 * 1024 * 1024,
  // Свой процессор — чтобы тест мог проверить, дошёл ли запрос до обработки картинки
  images = sharpProcessor(),
  // Почта по умолчанию — когда SMTP не задан ни в окружении, ни в админке: в памяти (тест видит
  // письма в mailer.sent). 'off' — почта выключена, как без SMTP_* на сервере
  mail = memoryMailer(),
  // SMTP из окружения (SMTP_*): он главнее настроек в админке
  envSmtp,
  // Ключ шифрования пароля SMTP из админки: по умолчанию свой случайный у каждого API.
  // null — ключа нет (как без MAIL_ENCRYPTION_KEY): SMTP в админке только для чтения
  mailKey,
  // Как ходить к SMTP из настроек админки: CA тестового сервера и его порт вместо 465/587
  smtp,
  // Порог ответа «Забыли пароль?»: тесты, которым он не важен, ставят 0
  resetResponseMs,
  // Лог API: тест может проверить, что пишется (и чего нет) при смене настроек почты
  log = () => {},
}: {
  resetResponseMs?: number
  production?: boolean
  mediaMaxBytes?: number
  images?: ImageProcessor
  mail?: Mailer | 'off'
  envSmtp?: SmtpSettings
  mailKey?: Uint8Array | null
  smtp?: SmtpOptions
  log?: (message: string) => void
} = {}) {
  // Как в index.ts: ошибки проверки — по-русски, тесты видят те же ответы, что админка
  setupZodMessages()
  const { db, close: closeDb } = createDb()
  // Своя временная папка медиатеки на каждый API. Создаётся при первой записи, удаляется в close
  const mediaDir = join(tmpdir(), `cms-test-media-${randomUUID()}`)
  const storage = diskStorage(mediaDir)
  const close = async () => {
    await closeDb()
    await rm(mediaDir, { recursive: true, force: true })
  }
  await migrateDb(db)
  await seedDemo(db)

  // Обработчик очереди тесты запускают сами (processOutbox, startMailWorker): так им видно,
  // когда письма уходят. wake считает вызовы — тест проверит, что повтор будит обработчик
  const mailSettings = { maxAttempts: 3, retentionDays: 30 }
  const wakes = { count: 0 }
  const auth = createAuth({
    db,
    secret: DEV_AUTH_SECRET,
    baseURL: testOrigins.api,
    adminUrl: testOrigins.admin,
    secureCookies: production,
    quiet: true,
    onMailQueued: () => (wakes.count += 1),
  })
  // Почта процесса, как в index.ts: окружение главнее админки, без обоих — вариант по умолчанию
  const secretBox =
    mailKey === null ? undefined : aesGcmSecretBox(mailKey ?? randomBytes(KEY_BYTES))
  const runtime = createMailRuntime({
    db,
    env: envSmtp
      ? {
          kind: 'smtp',
          mailer: smtpMailer(envSmtp, smtp),
          settings: {
            host: envSmtp.host,
            port: envSmtp.port,
            security: envSmtp.security,
            user: envSmtp.user,
            from: envSmtp.from,
          },
        }
      : undefined,
    fallback: mail === 'off' ? { reason: 'Почта не настроена (тест)' } : { mailer: mail },
    secretBox,
    keyKind: secretBox ? 'env' : undefined,
    smtp: adminSmtp(smtp),
    logError: (message, error) => log(`${message}\n${String(errorForLog(error))}`),
  })
  await runtime.reload()
  const app = createApp({
    db,
    auth,
    trustedOrigins: [testOrigins.admin, testOrigins.api],
    log,
    storage,
    images,
    mediaMaxBytes,
    mail: { runtime, settings: mailSettings, wake: () => (wakes.count += 1) },
    adminUrl: testOrigins.admin,
    resetResponseMs,
  })
  const users = usersRepo(db, auth)
  const tokens = tokensRepo(db)
  let userCount = 0

  /** Пользователь с паролем TEST_PASSWORD. Почта уникальна в пределах этого API */
  async function createUser(role: 'owner' | 'member', name = `Тестовый ${role}`) {
    userCount += 1
    const email = `${role}-${userCount}@example.test`
    const user = await users.create({ email, name, password: TEST_PASSWORD, role })
    if (!user) throw new Error(`Не создался пользователь ${email}`)
    return user
  }

  /**
   * Заголовки запроса от имени пользователя: cookie сессии и Origin админки (без него
   * изменяющие запросы с cookie не проходят). Вход — серверным вызовом Better Auth:
   * он не тратит лимит попыток входа, который проверяют отдельные тесты
   */
  async function sessionHeaders(email: string, password = TEST_PASSWORD) {
    const { headers } = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    })
    const cookie = headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    return { cookie, origin: testOrigins.admin }
  }

  /**
   * Сессия владельца, редактора или клиента. Участник получает роль на siteId
   * (по умолчанию — на демо-сайте). Каждый вызов — новый пользователь
   */
  async function loginAs(role: TestRole, siteId: string = demoSiteId) {
    const user = await createUser(role === 'owner' ? 'owner' : 'member', `Тестовый ${role}`)
    if (role !== 'owner') await users.addMember(siteId, user.id, role)
    return { user, headers: await sessionHeaders(user.email) }
  }

  return {
    app,
    db,
    auth,
    close,
    demoSiteId,
    /** Хранилище медиатеки: тест может проверить, что файлы легли или удалились */
    storage,
    /** Папка медиатеки на диске: тест может проверить, что после отказа в ней ничего не легло */
    mediaDir,
    /** Почта по умолчанию — в памяти (или undefined, если выключена) — и настройки очереди */
    mailer: mail === 'off' ? undefined : mail,
    /** Почта процесса: нынешний провайдер, настройки SMTP из админки, смена без перезапуска */
    mailRuntime: runtime,
    /** Шифрование пароля SMTP этого API (нет — нет ключа) */
    secretBox,
    mailSettings,
    /** Сколько раз API будил обработчик писем */
    mailWakes: wakes,
    createUser,
    sessionHeaders,
    loginAs,
    /** Токен API с правами редактора на сайте. Возвращает и сам токен, и его id для отзыва */
    createToken: (siteId: string = demoSiteId, name = 'тест') => tokens.create({ siteId, name }),
    revokeToken: (id: string) => tokens.revoke(id),
    addMember: users.addMember,
  }
}

export type TestApi = Awaited<ReturnType<typeof createTestApi>>
