import { mkdirSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { setupZodMessages } from '@cms/schema'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createAuth } from './auth/auth'
import { serverFetch } from './client-ip'
import { loadConfig } from './config'
import { createDb } from './db/client'
import { DbLockedError, lockDb } from './db/lock'
import { migrateDb } from './db/migrate'
import { seedDemo, seedDevOwner } from './db/seed'
import { diskStorage } from './media/disk-storage'
import { sharpProcessor } from './media/sharp-processor'

setupZodMessages()
// --dev включает учебный режим (см. isLocalDev в config.ts). Его ставят только скрипт dev
// и e2e: без флага API не стартует на учебном секрете, даже если переменных нет вовсе
const { values: flags } = parseArgs({ options: { dev: { type: 'boolean', default: false } } })
const config = loadConfig({ dev: flags.dev })

mkdirSync(config.PGLITE_DIR, { recursive: true })
const unlock = await lockDb(config.PGLITE_DIR, { waitMs: 5000 }).catch((error: unknown) => {
  if (!(error instanceof DbLockedError)) throw error
  console.error(
    `База ${config.PGLITE_DIR} уже открыта процессом ${error.pid ?? '(неизвестно)'}. ` +
      'Встроенная база не выдерживает два процесса сразу: останови второй API или команду.\n' +
      error.hint,
  )
  process.exit(1)
})
// Замок снимается при любом выходе, в том числе по ошибке старта
process.on('exit', unlock)
const { db, close } = createDb(config.PGLITE_DIR)
await migrateDb(db)

const auth = createAuth({
  db,
  secret: config.AUTH_SECRET,
  baseURL: config.API_URL,
  adminUrl: config.ADMIN_URL,
  secureCookies: config.secureCookies,
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

const app = createApp({
  db,
  auth,
  trustedOrigins: [config.ADMIN_URL, config.API_URL],
  log: console.log,
  storage: diskStorage(config.MEDIA_DIR),
  images: sharpProcessor(),
  mediaMaxBytes: config.MEDIA_MAX_BYTES,
})

const server = serve(
  {
    fetch: serverFetch(app, { trustProxy: config.TRUST_PROXY, loopbackOnly: config.loopbackOnly }),
    port: config.PORT,
  },
  (info) => {
    console.log(`API: http://localhost:${info.port}/api/health`)
    if (config.loopbackOnly) {
      console.log(
        'Учебный режим (--dev, учебный секрет AUTH_SECRET): только для разработки. ' +
          'API отвечает лишь на запросы к localhost с этого компьютера',
      )
    }
  },
)

async function shutdown() {
  server.close()
  await close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
