import { Hono } from 'hono'
import { z } from 'zod'
import type { Auth } from '../../auth/auth'
import type { AuthEnv } from '../../auth/middleware'

// Ошибка Better Auth: { code?, message }. Отдаём её в нашем формате ApiError, а частые
// сообщения — по-русски: админка разбирает все ошибки API одним кодом
const BetterAuthError = z.object({ code: z.string().optional(), message: z.string() })

const messages = new Map([
  ['INVALID_EMAIL_OR_PASSWORD', 'Неверная почта или пароль'],
  ['INVALID_EMAIL', 'Нужна почта вида name@example.ru'],
  ['EMAIL_PASSWORD_SIGN_UP_DISABLED', 'Регистрации нет: пользователей создаёт владелец'],
  ['INVALID_ORIGIN', 'Запрос пришёл не из админки'],
  ['MISSING_OR_NULL_ORIGIN', 'Запрос пришёл не из админки'],
])

async function asApiError(res: Response) {
  if (res.status < 400) return res
  const body = BetterAuthError.safeParse(
    await res
      .clone()
      .json()
      .catch(() => null),
  )
  let code = (body.data?.code ?? 'auth_error').toLowerCase()
  let message = messages.get(body.data?.code ?? '') ?? body.data?.message ?? 'Ошибка входа'
  if (res.status === 429) {
    code = 'rate_limited'
    const retryAfter = Number(res.headers.get('x-retry-after')) || 10
    message = `Слишком много попыток. Подождите ${retryAfter} с и попробуйте снова`
  }
  const headers = new Headers(res.headers)
  headers.set('content-type', 'application/json')
  headers.delete('content-length')
  return new Response(JSON.stringify({ error: { code, message } }), {
    status: res.status,
    headers,
  })
}

export function authRoutes({ auth }: { auth: Auth }) {
  return (
    new Hono<AuthEnv>()
      // Кто вошёл: имя для шапки админки и роль. Токен в админку не ходит, но ответ
      // для него тоже есть: так MCP или скрипт может проверить свой токен
      .get('/me', (c) => {
        const { actor } = c.var
        if (actor.kind === 'token') {
          return c.json({
            kind: 'token' as const,
            token: { id: actor.tokenId, siteId: actor.siteId },
          })
        }
        return c.json({ kind: 'user' as const, user: actor.user })
      })

      // Вход, выход и сессии — Better Auth (/api/auth/sign-in/email, /api/auth/sign-out и т.д.)
      .on(['GET', 'POST'], '/auth/*', async (c) => asApiError(await auth.handler(c.req.raw)))
  )
}
