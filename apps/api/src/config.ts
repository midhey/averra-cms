import { existsSync } from 'node:fs'
import { z } from 'zod'

/**
 * Секрет подписи cookie для разработки и тестов. В проде он не подходит: config требует
 * свой AUTH_SECRET. Значение нарочно говорящее, чтобы его не спутать с настоящим
 */
export const DEV_AUTH_SECRET = 'dev-only-secret-not-for-production-0123456789'

/** Адрес без пути: с ним сравнивается заголовок Origin, а в нём пути не бывает */
const Origin = z.url({ protocol: /^https?$/ }).refine((url) => new URL(url).origin === url, {
  error: 'Нужен адрес без пути и косой черты в конце, например https://admin.example.ru',
})

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    // Папка встроенного Postgres (PGlite) для разработки. Для прода появится DATABASE_URL
    PGLITE_DIR: z.string().min(1).default('.data/pglite'),
    // Подпись cookie сессии. Сгенерировать: openssl rand -base64 32
    AUTH_SECRET: z.string().min(32).optional(),
    // Адрес админки: только с него Better Auth и API принимают запросы с cookie
    ADMIN_URL: Origin.optional(),
    // Адрес самого API снаружи (baseURL для Better Auth)
    API_URL: Origin.optional(),
    // true — API стоит за прокси (Caddy), который сам ставит X-Forwarded-For. Иначе заголовок
    // перезаписывается адресом соединения: подставив его, нельзя обойти лимит попыток входа
    TRUST_PROXY: z.stringbool().default(false),
    // Владелец, которого API создаёт в пустой базе при разработке. В проде не используется
    DEV_OWNER_EMAIL: z.email().optional(),
    DEV_OWNER_PASSWORD: z.string().min(10).max(128).optional(),
  })
  .superRefine((env, ctx) => {
    if ((env.DEV_OWNER_EMAIL === undefined) !== (env.DEV_OWNER_PASSWORD === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_OWNER_PASSWORD'],
        message: 'DEV_OWNER_EMAIL и DEV_OWNER_PASSWORD задаются только вместе',
      })
    }
    if (env.NODE_ENV !== 'production') return
    for (const key of ['AUTH_SECRET', 'ADMIN_URL', 'API_URL'] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: `В проде ${key} обязателен` })
      }
    }
  })
  .transform((env) => {
    const production = env.NODE_ENV === 'production'
    return {
      ...env,
      AUTH_SECRET: env.AUTH_SECRET ?? DEV_AUTH_SECRET,
      ADMIN_URL: env.ADMIN_URL ?? 'http://localhost:5173',
      API_URL: env.API_URL ?? `http://localhost:${env.PORT}`,
      // Cookie только по HTTPS — в проде. Локально админка открыта по http
      secureCookies: production,
      devOwner:
        env.NODE_ENV === 'development' && env.DEV_OWNER_EMAIL && env.DEV_OWNER_PASSWORD
          ? { email: env.DEV_OWNER_EMAIL, password: env.DEV_OWNER_PASSWORD }
          : undefined,
    }
  })

export type Config = z.output<typeof Env>

/** Проверяет переменные окружения. Отдельно от loadConfig, чтобы проверять в тестах */
export function parseConfig(env: Record<string, string | undefined>) {
  return Env.safeParse(env)
}

export function loadConfig(): Config {
  // .env необязателен: в проде переменные приходят из окружения
  if (existsSync('.env')) process.loadEnvFile('.env')

  const parsed = parseConfig(process.env)
  if (!parsed.success) {
    console.error(`Ошибка в переменных окружения:\n${z.prettifyError(parsed.error)}`)
    process.exit(1)
  }
  return parsed.data
}
