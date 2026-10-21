import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setupZodMessages } from '@averra/schema'
import { defaultTheme } from '@averra/tokens'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createAuth } from './auth/auth'
import { serverFetch } from './client-ip'
import { loadConfig, parseApiArgs } from './config'
import { aesGcmSecretBox } from './crypto/aes-gcm'
import { createDb, dbTargetOf } from './db/client'
import { DbLockedError, lockDb } from './db/lock'
import { migrateDb } from './db/migrate'
import { seedDemo, seedDevOwner } from './db/seed'
import { errorForLog } from './log-error'
import { mailSources } from './mail/create-mailer'
import { localLinkWarning } from './mail/link-warning'
import { describeMailer } from './mail/mailer'
import { createMailRuntime } from './mail/runtime'
import { adminSmtp } from './mail/smtp-mailer'
import { startMailWorker } from './mail/worker'
import { diskStorage } from './media/disk-storage'
import { sharpProcessor } from './media/sharp-processor'
import { invitationsRepo } from './modules/invitations/repo'
import { leadsRepo } from './modules/leads/repo'
import { defaultSiteName, sitesRepo } from './modules/sites/repo'
import { linkInstallationSite } from './publish/installation-link'
import { publishedSite } from './publish/published-site'
import { createPublishQueue } from './publish/queue'
import { defaultRendererDir, rendererProcess } from './publish/renderer'
import { hasCurrentRelease, staticSiteBuilder } from './publish/site-builder'
import { diskTargets, hostStatus } from './status/host'

setupZodMessages()
// --dev включает учебный режим (см. isLocalDev в config.ts). Его ставят только скрипт dev
// и e2e: без флага API не стартует на учебном секрете, даже если переменных нет вовсе
const args = parseApiArgs()
if (!args.success) {
  // Как ошибки конфига: короткое сообщение и код 1, без стека
  console.error(args.error)
  process.exit(1)
}
const config = loadConfig({ dev: args.dev })

// База: PostgreSQL по DATABASE_URL (сервер) или встроенный PGlite в PGLITE_DIR (разработка)
const target = dbTargetOf(config)
if (target.kind === 'pglite' && target.dataDir) {
  const dataDir = target.dataDir
  mkdirSync(dataDir, { recursive: true })
  // Замок нужен только встроенной базе: PostgreSQL сам держит много соединений и процессов
  const unlock = await lockDb(dataDir, { waitMs: 5000 }).catch((error: unknown) => {
    if (!(error instanceof DbLockedError)) throw error
    console.error(
      `База ${dataDir} уже открыта процессом ${error.pid ?? '(неизвестно)'}. ` +
        'Встроенная база не выдерживает два процесса сразу: останови второй API или команду.\n' +
        error.hint,
    )
    process.exit(1)
  })
  // Замок снимается при любом выходе, в том числе по ошибке старта
  process.on('exit', unlock)
}
const { db, close } = createDb(target)
console.log(
  target.kind === 'postgres'
    ? 'База: PostgreSQL (DATABASE_URL)'
    : `База: PGlite в ${target.dataDir}`,
)
await migrateDb(db)

// Куда подключается SMTP из админки вместо 465 и 587: DEV_SMTP_CONNECT_PORT, только в учебном
// режиме (config.ts) — тестовый SMTP e2e слушает свободный порт
const devSmtpPort = config.smtpConnectPort

// Почта: окружение (SMTP_* или MAIL_TRANSPORT) главнее настроек SMTP из админки, без обоих —
// файловый ящик в учебном режиме или выключена (src/mail/runtime.ts). Пароль SMTP из админки
// лежит в базе зашифрованным ключом MAIL_ENCRYPTION_KEY; нет ключа — SMTP в админке только
// для чтения. Обработчик очереди в этом же процессе берёт провайдера перед каждым письмом:
// настройки меняются без перезапуска. Выключена почта — обработчик писем не шлёт, а только чистит
// очередь. Обработчик запускается до Better Auth: письмо сброса пароля будит его сразу
const mail = createMailRuntime({
  db,
  ...mailSources(config.mail),
  secretBox: config.mailEncryptionKey ? aesGcmSecretBox(config.mailEncryptionKey) : undefined,
  keyKind: config.mailKeyKind,
  smtp: adminSmtp(devSmtpPort === undefined ? {} : { connectPort: () => devSmtpPort }),
  // Ошибка базы — через errorForLog: в ней бывают параметры запроса (log-error.ts)
  logError: (message, error) => console.error(message, errorForLog(error)),
})
await mail.reload()
const mailSettings = {
  maxAttempts: config.mail.maxAttempts,
  retentionDays: config.mail.retentionDays,
}
// Закрытые приглашения (в них адрес человека) живут столько же, сколько письма, а заявки —
// столько, сколько задано у их сайта (lead_retention_days)
const mailWorker = startMailWorker({
  db,
  mailer: mail.mailer,
  ...mailSettings,
  log: console.log,
  cleanupAlso: [
    { what: 'приглашения', run: (before) => invitationsRepo(db).cleanup(before) },
    { what: 'заявки', run: (_before, now) => leadsRepo(db).cleanup(now) },
  ],
})
const mailStatus = mail.status()
const mailSourceNote = { env: 'окружение', database: 'настройки из админки', none: 'по умолчанию' }
console.log(
  mailStatus.enabled
    ? `Почта (${mailSourceNote[mail.source()]}): ${describeMailer(mailStatus.provider)}`
    : mailStatus.reason,
)
// Ссылки из писем по SMTP ведут на localhost — забытый ADMIN_URL. Не отказ, а предупреждение:
// в pnpm dev так бывает нарочно (mail/link-warning.ts). Его же показывает страница «Почта»
const linkWarning = localLinkWarning(config.ADMIN_URL, mailStatus)
if (linkWarning) console.warn(linkWarning)
// Окружение решило почту само — SMTP из админки не действует, и ключ ему не нужен
if (config.mailKeyKind === 'dev' && !config.mail.fromEnv) {
  console.log(
    'Пароль SMTP из админки шифруется учебным ключом из репозитория (pnpm dev): настоящий пароль от почты здесь не вводи',
  )
}
if (devSmtpPort !== undefined && !config.mail.fromEnv) {
  console.log(
    `SMTP из админки подключается к порту ${devSmtpPort} вместо 465 и 587 (DEV_SMTP_CONNECT_PORT, только для разработки и e2e)`,
  )
}

const auth = createAuth({
  db,
  secret: config.AUTH_SECRET,
  baseURL: config.API_URL,
  adminUrl: config.ADMIN_URL,
  secureCookies: config.secureCookies,
  onMailQueued: () => mailWorker.wake(),
})

if (config.devSeed) {
  await seedDemo(db)
  const owner = await seedDevOwner(db, auth, config.devOwner)
  if (owner === 'created') console.log(`Создан владелец для разработки: ${config.devOwner?.email}`)
  if (owner === 'missing') {
    console.log(
      'В базе нет пользователей. Задай DEV_OWNER_EMAIL и DEV_OWNER_PASSWORD в apps/api/.env ' +
        'или создай владельца: pnpm user:create --email … --name …',
    )
  }
}

// Одна установка — один сайт. Его нет (первый запуск на пустой базе) — API создаёт его сам:
// название из SITE_NAME (его пишет install.sh), иначе домен сайта. В учебном режиме выше уже лёг
// демо-сайт — он и есть сайт установки. Лишние сайты старых баз не трогаем: они целы и доступны
// по id через API, но админка работает с сайтом установки (modules/sites/repo.ts)
const sites = sitesRepo(db)
const { site: installationSite, created: siteCreated } = await sites.ensureInstallationSite(
  config.SITE_NAME ?? defaultSiteName(config.SITE_URL),
  defaultTheme,
)
if (siteCreated) console.log(`Создан сайт установки «${installationSite.name}»`)
const siteCount = await sites.count()
if (siteCount > 1) {
  console.log(
    `В базе ${siteCount} сайтов. Averra работает с одним — «${installationSite.name}» ` +
      `(${installationSite.id}), созданным первым. Остальные сохранены и доступны по id через API, ` +
      'но в админке не видны (https://midhey.github.io/averra-cms/decisions/single-site/)',
  )
}

// Публикация на сервере: после «Опубликовать» API собирает сайт отдельным процессом
// Astro в новую папку релиза в PUBLISH_DIR и подменяет ею текущую. Без PUBLISH_DIR — выключена
const storage = diskStorage(config.MEDIA_DIR)
const publishQueue = config.PUBLISH_DIR
  ? createPublishQueue({
      db,
      log: console.log,
      build: staticSiteBuilder({
        publishDir: config.PUBLISH_DIR,
        keepReleases: config.PUBLISH_KEEP_RELEASES,
        storage,
        publishedMedia: (siteId) => sitesRepo(db).publishedMediaIds(siteId),
        log: console.log,
        render: rendererProcess({
          rendererDir: config.RENDERER_DIR ?? defaultRendererDir(),
          // Сборщик берёт снимок сайта у этого же API напрямую, мимо прокси
          apiUrl: `http://127.0.0.1:${config.PORT}`,
          cacheDir: join(config.PUBLISH_DIR, '.cache'),
          timeoutMs: config.PUBLISH_TIMEOUT_SECONDS * 1000,
          maxMemoryMb: config.PUBLISH_MAX_MEMORY_MB,
        }),
      }),
    })
  : undefined

// Сборки, прерванные прошлым перезапуском, помечаются до serve(): иначе публикация, пришедшая
// раньше этой пометки, начала бы сборку, которую сочли бы прерванной (publish/queue.ts)
const interruptedSites = publishQueue ? await publishQueue.markInterrupted() : []
// Caddy отдаёт на домене сайта PUBLISH_DIR/main/current: ссылка main ведёт на папку сайта
// установки. Ставится при каждом старте — после восстановления из бэкапа сайт может быть другим
if (config.PUBLISH_DIR) await linkInstallationSite(config.PUBLISH_DIR, installationSite.id)

const app = createApp({
  db,
  auth,
  trustedOrigins: [config.ADMIN_URL, config.API_URL],
  log: console.log,
  storage,
  images: sharpProcessor(),
  mediaMaxBytes: config.MEDIA_MAX_BYTES,
  mail: { runtime: mail, settings: mailSettings, wake: () => mailWorker.wake() },
  adminUrl: config.ADMIN_URL,
  siteUrl: config.SITE_URL,
  publisher: publishQueue,
  published: config.PUBLISH_DIR ? publishedSite(config.PUBLISH_DIR) : undefined,
  version: config.AVERRA_VERSION,
  // Состояние установки: итоги бэкапов и обновлений от deploy/averra.sh и место на дисках
  host: hostStatus({ stateDir: config.STATE_DIR, disks: diskTargets(config) }),
})

const server = serve(
  {
    fetch: serverFetch(app, { trustProxy: config.TRUST_PROXY, loopbackOnly: config.loopbackOnly }),
    port: config.PORT,
  },
  (info) => {
    console.log(`API: http://localhost:${info.port}/api/health`)
    if (publishQueue && config.PUBLISH_DIR) {
      const publishDir = config.PUBLISH_DIR
      console.log(`Публикация на сервере: сайты собираются в ${publishDir}`)
      // Сборщик ходит в этот API, поэтому очередь оживает, когда сервер уже слушает порт.
      // Прерванные перезапуском сборки и опубликованные сайты без текущей версии на диске
      // (свежая установка, потерянный том) собираются заново
      void (async () => {
        const published = await sites.sitesWithPublishedPages()
        const missing: string[] = []
        for (const siteId of published) {
          if (!(await hasCurrentRelease(publishDir, siteId))) missing.push(siteId)
        }
        await publishQueue.resume(interruptedSites, missing)
      })().catch((error: unknown) =>
        console.error('Не удалось возобновить сборки сайтов:', errorForLog(error)),
      )
    }
    if (config.loopbackOnly) {
      console.log(
        'Учебный режим (--dev, учебный секрет AUTH_SECRET): только для разработки. ' +
          'API отвечает лишь на запросы к localhost с этого компьютера',
      )
    }
  },
)

let shuttingDown = false

async function shutdown() {
  // Второй Ctrl+C, пока API ждёт обработчик писем, — выйти сразу. Письмо, которое отправлялось,
  // останется «отправляется» и после аренды уйдёт снова (см. outbox.ts)
  if (shuttingDown) {
    console.log('Выход без ожидания отправки письма')
    process.exit(1)
  }
  shuttingDown = true
  // Сначала обработчик писем: он допишет письмо, которое уже отправляет, и не возьмёт новых.
  // База закрывается последней — обработчику и запросам она нужна до конца
  if (mailWorker.busy()) {
    console.log(
      'API дожидается обработчика писем: письмо, которое уже отправляется, допишется ' +
        '(при зависшем SMTP — до пары минут). Ctrl+C ещё раз — выйти сразу',
    )
  }
  // Идущая сборка сайта прерывается и соберётся заново при следующем старте (publish/queue.ts)
  await publishQueue?.stop()
  await mailWorker.stop()
  server.close()
  await mail.close()
  await close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
