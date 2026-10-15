import { PASSWORD_LENGTH } from '@averra/schema'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { Db } from '../db/client'
import { accounts, sessions, users, verifications } from '../db/schema'
import {
  hashVerificationIdentifier,
  PASSWORD_RESET_TTL_MINUTES,
  queuePasswordResetMail,
} from './password-reset'

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
  /** Письмо легло в очередь: разбудить обработчик, чтобы оно ушло сразу, а не через опрос */
  onMailQueued?: () => void
}

/** Сколько запросов сброса пароля пускать с одного IP: за 15 минут. Считает обёртка (routes.ts) */
export const RESET_REQUESTS_PER_IP = { window: 15 * 60, max: 5 } as const

/**
 * Запасной лимит Better Auth на тот же путь: вдвое выше нашего. Обёртка пускает к Better Auth
 * не больше RESET_REQUESTS_PER_IP с IP, а варианты пути до него не доходят (routes.ts), так что
 * он не срабатывает. Он — на случай, если обёртку когда-нибудь обойдут
 */
export const RESET_REQUESTS_PER_IP_BACKSTOP = {
  window: RESET_REQUESTS_PER_IP.window,
  max: RESET_REQUESTS_PER_IP.max * 2,
} as const

export function createAuth({
  db,
  secret,
  baseURL,
  adminUrl,
  secureCookies,
  quiet,
  onMailQueued,
}: AuthOptions) {
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
      // Сброс пароля по ссылке из письма (см. auth/password-reset.ts и README, «Вход и права»).
      // Письмо — через очередь, ссылка ведёт в админку, а не в API. Better Auth ловит ошибку
      // этой функции и пишет её в лог, ответ на запрос от этого не меняется
      sendResetPassword: async ({ user, token }) => {
        await queuePasswordResetMail(db, { user, token, adminUrl })
        onMailQueued?.()
      },
      resetPasswordTokenExpiresIn: PASSWORD_RESET_TTL_MINUTES * 60,
      // Сменили пароль — все входы пользователя завершаются: если пароль увели, увели и сессию
      revokeSessionsOnPasswordReset: true,
    },
    // Токены из ссылок (сброс пароля) лежат в verifications только хешем: утечка базы
    // не даёт рабочих ссылок. В базе — reset-password#<хеш>: # вместо двоеточия, чтобы запасной
    // поиск Better Auth «по строке как есть» не принял хеш за токен (auth/password-reset.ts)
    verification: { storeIdentifier: { hash: hashVerificationIdentifier } },
    user: {
      additionalFields: {
        // input: false — роль не поменять через эндпоинты Better Auth (update-user и т.п.)
        role: { type: ['owner', 'member'], required: false, defaultValue: 'member', input: false },
      },
    },
    // По умолчанию Better Auth включает лимит только в проде. Нам он нужен везде:
    // и чтобы тесты проверяли то же, что работает в проде. Для входа встроенное правило —
    // 3 попытки за 10 секунд с одного IP
    rateLimit: {
      enabled: true,
      storage: 'memory',
      customRules: {
        // Лимиты по IP и по адресу — свои, в modules/auth/routes.ts. Этот — запасной
        '/request-password-reset': RESET_REQUESTS_PER_IP_BACKSTOP,
        // Токен из 24 случайных символов не подобрать, но и перебирать его незачем
        '/reset-password': { window: 60, max: 10 },
      },
    },
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
