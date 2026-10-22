import { randomBytes, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { demoSiteId, type NotificationChannelKind, setupZodMessages } from '@averra/schema'
import { defaultTheme } from '@averra/tokens'
import { createApp } from './app'
import type { MemberRole } from './auth/access'
import { createAuth } from './auth/auth'
import { DEV_AUTH_SECRET } from './config'
import { aesGcmSecretBox, KEY_BYTES } from './crypto/aes-gcm'
import { createDb, type DbTarget } from './db/client'
import { migrateDb } from './db/migrate'
import { seedDemo } from './db/seed'
import { errorForLog } from './log-error'
import type { Mailer, SmtpSettings } from './mail/mailer'
import { memoryMailer } from './mail/memory-mailer'
import { createMailRuntime } from './mail/runtime'
import { adminSmtp, type SmtpOptions, smtpMailer } from './mail/smtp-mailer'
import { processOutbox } from './mail/worker'
import { diskStorage } from './media/disk-storage'
import type { ImageProcessor } from './media/processor'
import { sharpIcons } from './media/sharp-favicon'
import { sharpProcessor } from './media/sharp-processor'
import type { PublishedSite } from './modules/export/routes'
import type { LeadLimits } from './modules/leads/public-routes'
import { sitesRepo } from './modules/sites/repo'
import type { HostStatus } from './modules/status/service'
import { tokensRepo } from './modules/tokens/repo'
import { usersRepo } from './modules/users/repo'
import { createChannels } from './notifications/channels'
import type { NotificationDeps } from './notifications/deps'
import { notifyDepsOf } from './notifications/deps'
import type { TelegramApiFactory } from './notifications/telegram/api'
import { telegramBinder } from './notifications/telegram/binder'
import { botApi } from './notifications/telegram/bot-api'
import { processNotifications } from './notifications/worker'
import type { OgCardRenderers } from './og/card'
import { sharpOgCards } from './og/sharp-og'
import type { SitePublisher } from './publish/queue'

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
  // Лимиты приёма заявок: тесты лимитов ставят маленькие, остальные — большие, чтобы не мешали
  leadLimits = {
    perIp: { max: 1000, windowMs: 60_000 },
    perSite: { max: 1000, windowMs: 60_000 },
    perSiteDailyBytes: 1024 * 1024 * 1024,
    smallLeadBytes: 8 * 1024,
  },
  // База: по умолчанию PGlite в памяти. Тест на настоящем драйвере PostgreSQL даёт свою
  // (db/postgres.test.ts: node-postgres к серверу протокола Postgres поверх PGlite)
  database,
  // Сборка сайта после публикации: тесты публикации дают свою очередь
  publisher,
  // Опубликованные сайты на диске (выгрузка статикой): тесты экспорта дают свою папку
  published,
  // Версия установки и сведения с сервера для GET /api/status
  version,
  host,
  // Адрес опубликованного сайта (SITE_URL) для GET /api/site
  siteUrl,
  // Страница 404 текущей версии сайта на сервере (fallback домена сайта)
  notFoundPage,
  // Карточки для соцсетей: тест очереди даёт свою отрисовку, остальные — настоящую на sharp
  ogCards = sharpOgCards(),
  // Bot API Telegram: адрес фейкового сервера (notifications/testing/fake-telegram.ts) или свой
  // клиент целиком. По умолчанию — недостижимый адрес: настоящий Telegram тесты не трогают
  telegramApiUrl = 'http://127.0.0.1:9',
  telegram,
}: {
  telegramApiUrl?: string
  telegram?: TelegramApiFactory
  ogCards?: OgCardRenderers
  siteUrl?: string
  notFoundPage?: () => Promise<string | undefined>
  published?: PublishedSite
  version?: string
  host?: HostStatus
  database?: DbTarget
  publisher?: SitePublisher
  leadLimits?: LeadLimits
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
  const { db, close: closeDb } = createDb(database)
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
  // Уведомления: каналы как в index.ts, обработчики тесты запускают сами (sendNotifications,
  // binder.pollOnce). Вызовы wake и bind считаются — тест проверит, что действие будит очередь
  const notificationWakes = {
    count: 0,
    binds: 0,
    resets: [] as (boolean | NotificationChannelKind | undefined)[],
  }
  const telegramApi = telegram ?? botApi({ baseUrl: telegramApiUrl, timeoutMs: 5000 })
  const notifications: NotificationDeps = {
    channels: createChannels({ telegram: telegramApi }),
    telegram: telegramApi,
    wake: (reset) => {
      notificationWakes.count += 1
      notificationWakes.resets.push(reset)
    },
    bind: () => (notificationWakes.binds += 1),
    bindProblem: () => binder.problem(),
  }
  const mailDeps = { runtime, settings: mailSettings, wake: () => (wakes.count += 1) }
  const notifyDeps = () => notifyDepsOf(mailDeps, notifications)
  const binder = telegramBinder({ db, deps: notifyDeps, telegram: telegramApi, pollTimeoutSec: 1 })
  const app = createApp({
    db,
    auth,
    trustedOrigins: [testOrigins.admin, testOrigins.api],
    log,
    storage,
    images,
    icons: sharpIcons(),
    ogCards,
    mediaMaxBytes,
    mail: mailDeps,
    notifications,
    adminUrl: testOrigins.admin,
    siteUrl,
    notFoundPage,
    resetResponseMs,
    leadLimits,
    publisher,
    published,
    version,
    host,
  })
  const users = usersRepo(db, auth)
  const tokens = tokensRepo(db)
  const sites = sitesRepo(db)
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
    /** Каналы уведомлений и счётчики wake/bind */
    notifications,
    notificationWakes,
    /** Что нужно ядру уведомлений сейчас: каналы, ключ, состояние почты */
    notifyDeps,
    /** Привязка чатов Telegram: тест зовёт pollOnce или handle сам */
    binder,
    createUser,
    sessionHeaders,
    loginAs,
    /** Токен API с правами редактора на сайте. Возвращает и сам токен, и его id для отзыва */
    createToken: (siteId: string = demoSiteId, name = 'тест') => tokens.create({ siteId, name }),
    revokeToken: (id: string) => tokens.revoke(id),
    addMember: users.addMember,
    /**
     * Ещё один сайт в базе (с главной), как в старых базах разработки. В установке сайт один, и
     * API их не создаёт, но данные по-прежнему разделены по site_id — это проверяют тесты изоляции
     */
    createSite: async (name = 'Другой сайт') => (await sites.createSite(name, defaultTheme)).id,
  }
}

export type TestApi = Awaited<ReturnType<typeof createTestApi>>

/**
 * Отправить всю очередь писем тестового API через его почту. Проход, который ничего не отправил
 * (почта выключена или на паузе, сервер не принял, обработчик остановлен), — конец: иначе письма
 * отпускаются и берутся снова, и цикл не кончится. Предел проходов — на случай поломки: тест
 * должен упасть, а не зависнуть
 */
export async function sendQueue(api: TestApi, maxPasses = 50) {
  const options = { db: api.db, mailer: api.mailRuntime.mailer, ...api.mailSettings }
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const result = await processOutbox(options)
    if (result.claimed === 0 || result.mailOff || result.serverDown || result.aborted) return
  }
  throw new Error(`Очередь писем не опустела за ${maxPasses} проходов`)
}

/**
 * Отправить очередь уведомлений (Telegram) тестового API. Как sendQueue: проход, который ничего
 * не взял или упёрся в сломанный канал, — конец
 */
export async function sendNotifications(api: TestApi, maxPasses = 20) {
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const result = await processNotifications({
      db: api.db,
      channels: api.notifications.channels,
      secretBox: api.secretBox,
      readiness: () => api.notifyDeps().readiness,
      maxAttempts: api.mailSettings.maxAttempts,
    })
    if (result.claimed === 0 || result.down.size > 0) return result
  }
  throw new Error(`Очередь уведомлений не опустела за ${maxPasses} проходов`)
}
