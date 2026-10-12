import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { Db } from '../db/client'
import { accounts, sessions, users, verifications } from '../db/schema'

export type AuthOptions = {
  db: Db
  secret: string
  /** Адрес API снаружи. Путь эндпоинтов Better Auth — /api/auth */
  baseURL: string
  /** Адрес админки: только с него принимаются запросы с cookie */
  adminUrl: string
  /** Cookie только по HTTPS и с префиксом __Secure- — в проде */
  secureCookies: boolean
  /** В тестах логи Better Auth (например, «не вижу IP клиента») только шумят */
  quiet?: boolean
}

/** Длина пароля — одна для входа, команды user:create и владельца для разработки */
export const PASSWORD_LENGTH = { min: 10, max: 128 } as const

export function createAuth({ db, secret, baseURL, adminUrl, secureCookies, quiet }: AuthOptions) {
  return betterAuth({
    secret,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins: [adminUrl],
    database: drizzleAdapter(db, {
      provider: 'pg',
      usePlural: true,
      transaction: true,
      schema: { users, sessions, accounts, verifications },
    }),
    emailAndPassword: {
      enabled: true,
      // Регистрации с сайта нет: пользователей заводит владелец командой pnpm user:create
      disableSignUp: true,
      minPasswordLength: PASSWORD_LENGTH.min,
      maxPasswordLength: PASSWORD_LENGTH.max,
    },
    user: {
      additionalFields: {
        // input: false — роль не поменять через эндпоинты Better Auth (update-user и т.п.)
        role: { type: ['owner', 'member'], required: false, defaultValue: 'member', input: false },
      },
    },
    // По умолчанию Better Auth включает лимит только в проде. Нам он нужен везде:
    // и чтобы тесты проверяли то же, что работает в проде. Для входа встроенное правило —
    // 3 попытки за 10 секунд с одного IP
    rateLimit: { enabled: true, storage: 'memory' },
    advanced: {
      useSecureCookies: secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      database: { generateId: 'uuid' },
    },
    telemetry: { enabled: false },
    logger: quiet ? { disabled: true } : { level: 'warn' },
  })
}

export type Auth = ReturnType<typeof createAuth>
