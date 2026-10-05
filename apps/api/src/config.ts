import { existsSync } from 'node:fs'
import { z } from 'zod'

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Папка встроенного Postgres (PGlite) для разработки. Для прода появится DATABASE_URL
  PGLITE_DIR: z.string().min(1).default('.data/pglite'),
})

export type Config = z.infer<typeof Env>

export function loadConfig(): Config {
  // .env необязателен: в проде переменные приходят из окружения
  if (existsSync('.env')) process.loadEnvFile('.env')

  const parsed = Env.safeParse(process.env)
  if (!parsed.success) {
    console.error(`Ошибка в переменных окружения:\n${z.prettifyError(parsed.error)}`)
    process.exit(1)
  }
  return parsed.data
}
