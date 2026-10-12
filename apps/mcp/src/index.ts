import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AppType } from '@cms/api'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { hc } from 'hono/client'
import { z } from 'zod'
import { missingTokenMessage, registerTools } from './tools'

// stdout занят протоколом MCP: всё служебное пишем только в stderr (console.error)

// .mcp.json запускает сервер из корня репозитория, поэтому .env ищем рядом с пакетом,
// а не в текущей папке
const envFile = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)

const { CMS_API_URL, CMS_API_TOKEN } = z
  .object({
    CMS_API_URL: z.url().default('http://localhost:4000'),
    // Токен с правами на один сайт: pnpm token:create. Пустая строка — как не задан
    CMS_API_TOKEN: z
      .string()
      .trim()
      .transform((token) => token || undefined)
      .optional(),
  })
  .parse(process.env)

// Без токена сервер всё равно стартует: list_blocks работает и так, а инструменты с API
// отвечают нейронке, как получить токен, — понятнее, чем сервер, который молча не запустился
const api = CMS_API_TOKEN
  ? hc<AppType>(CMS_API_URL, { headers: { authorization: `Bearer ${CMS_API_TOKEN}` } })
  : undefined

const handle = serveStdio(() => {
  const server = new McpServer({ name: 'cms', version: '0.1.0' })
  registerTools(server, api)
  return server
})

const stop = () => void handle.close()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

console.error(`MCP-сервер CMS запущен, API: ${CMS_API_URL}`)
if (!api) console.error(missingTokenMessage)
