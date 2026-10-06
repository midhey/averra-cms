import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import type { Db } from './db/client'
import { sitesRoutes } from './modules/sites/routes'

// Здесь не импортируем Node API (fs, process и т.п.): админка читает типы этого файла.
// Всё платформенное создаётся в index.ts и приходит через deps
export type AppDeps = {
  db: Db
  log: (message: string) => void
}

export function createApp({ db, log }: AppDeps) {
  const app = new Hono()
    .use(logger(log))
    .basePath('/api')
    .get('/health', (c) => c.json({ status: 'ok' } as const))
    .get('/health/ready', async (c) => {
      try {
        await db.execute(sql`select 1`)
        return c.json({ status: 'ok', db: 'up' } as const)
      } catch {
        return c.json({ status: 'error', db: 'down' } as const, 503)
      }
    })
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
