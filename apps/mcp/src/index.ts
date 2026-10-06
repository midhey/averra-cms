import type { AppType } from '@cms/api'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { hc } from 'hono/client'
import { z } from 'zod'
import { registerTools } from './tools'

// stdout занят протоколом MCP: всё служебное пишем только в stderr (console.error)
const { CMS_API_URL } = z
  .object({ CMS_API_URL: z.url().default('http://localhost:4000') })
  .parse(process.env)

const api = hc<AppType>(CMS_API_URL)

const handle = serveStdio(() => {
  const server = new McpServer({ name: 'cms', version: '0.1.0' })
  registerTools(server, api)
  return server
})

const stop = () => void handle.close()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

console.error(`MCP-сервер CMS запущен, API: ${CMS_API_URL}`)
