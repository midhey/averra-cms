import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import type { Auth } from './auth/auth'
import { type AuthEnv, authenticate } from './auth/middleware'
import type { Db } from './db/client'
import { authRoutes } from './modules/auth/routes'
import { sitesRoutes } from './modules/sites/routes'

// Здесь не импортируем Node API (fs, process и т.п.): админка читает типы этого файла.
// Всё платформенное создаётся в index.ts и приходит через deps
export type AppDeps = {
  db: Db
  auth: Auth
  /** Откуда принимаем изменяющие запросы с cookie: адреса админки и самого API */
  trustedOrigins: readonly string[]
  log: (message: string) => void
}

export function createApp({ db, auth, trustedOrigins, log }: AppDeps) {
  const app = new Hono<AuthEnv>()
    .use(logger(log))
    .basePath('/api')
    // Закрыто всё, кроме короткого списка в auth/middleware.ts
    .use(authenticate({ db, auth, trustedOrigins }))
    .get('/health', (c) => c.json({ status: 'ok' } as const))
    .get('/health/ready', async (c) => {
      try {
        await db.execute(sql`select 1`)
        return c.json({ status: 'ok', db: 'up' } as const)
      } catch {
        return c.json({ status: 'error', db: 'down' } as const, 503)
      }
    })
    .route('/', authRoutes({ auth }))
    .route('/sites', sitesRoutes({ db }))

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404))

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: { code: 'http_error', message: err.message } }, err.status)
    }
    console.error(err)
    return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500)
  })

  return app
}

export type AppType = ReturnType<typeof createApp>
