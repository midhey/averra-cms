import { mkdirSync } from 'node:fs'
import { type HttpBindings, serve } from '@hono/node-server'
import { createApp } from './app'
import { createAuth } from './auth/auth'
import { loadConfig } from './config'
import { createDb } from './db/client'
import { DbLockedError, lockDb } from './db/lock'
import { migrateDb } from './db/migrate'
import { seedDemo, seedDevOwner } from './db/seed'
import { diskStorage } from './media/disk-storage'
import { sharpProcessor } from './media/sharp-processor'

const config = loadConfig()

mkdirSync(config.PGLITE_DIR, { recursive: true })
const unlock = await lockDb(config.PGLITE_DIR, { waitMs: 5000 }).catch((error: unknown) => {
  if (!(error instanceof DbLockedError)) throw error
  console.error(
    `База ${config.PGLITE_DIR} уже открыта процессом ${error.pid}. ` +
      'Встроенная база не выдерживает два процесса сразу: останови второй API или команду.',
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

if (config.NODE_ENV === 'development') {
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

/**
 * Лимит попыток входа Better Auth считает по X-Forwarded-For. Без прокси впереди этот
 * заголовок пишет сам клиент и мог бы обходить лимит, меняя «свой» IP на каждой попытке.
 * Поэтому, если прокси не доверяем, ставим в заголовок адрес соединения
 */
function withClientIp(request: Request, { incoming }: HttpBindings) {
  if (config.TRUST_PROXY) return request
  const headers = new Headers(request.headers)
  headers.set('x-forwarded-for', incoming.socket.remoteAddress ?? 'unknown')
  return new Request(request, { headers })
}

const server = serve(
  {
    fetch: (request, env) => app.fetch(withClientIp(request, env as HttpBindings), env),
    port: config.PORT,
  },
  (info) => {
    console.log(`API: http://localhost:${info.port}/api/health`)
  },
)

async function shutdown() {
  server.close()
  await close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
