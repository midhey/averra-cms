import { mkdirSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { loadConfig } from './config'
import { createDb } from './db/client'

const config = loadConfig()

mkdirSync(config.PGLITE_DIR, { recursive: true })
const { db, close } = createDb(config.PGLITE_DIR)

const app = createApp({ db, log: console.log })

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`API: http://localhost:${info.port}/api/health`)
})

async function shutdown() {
  server.close()
  await close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
