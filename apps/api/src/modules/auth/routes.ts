import { ForgotPassword, ResetPasswordToken } from '@averra/schema'
import { getIP } from 'better-auth/api'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Auth } from '../../auth/auth'
import { type AuthEnv, notFound } from '../../auth/middleware'
import { mailDisabled } from '../../errors'
import type { RateLimiter } from '../../rate-limit'
import { validate } from '../../validate'
import type { MailDeps } from '../mail/routes'

/** Ссылка сброса не сработала: и ответ Better Auth, и наш, если токен не того формата */
const INVALID_RESET_LINK =
  'Ссылка не действует: она уже использована, устарела (живёт час) или заменена новой. Запросите сброс ещё раз'

// Ошибка Better Auth: { code?, message }. Отдаём её в нашем формате ApiError, а частые
// сообщения — по-русски: админка разбирает все ошибки API одним кодом
const BetterAuthError = z.object({ code: z.string().optional(), message: z.string() })

const messages = new Map([
  ['INVALID_EMAIL_OR_PASSWORD', 'Неверная почта или пароль'],
  ['INVALID_EMAIL', 'Нужна почта вида name@example.ru'],
  ['EMAIL_PASSWORD_SIGN_UP_DISABLED', 'Регистрации нет: пользователей создаёт владелец'],
  ['INVALID_ORIGIN', 'Запрос пришёл не из админки'],
  ['MISSING_OR_NULL_ORIGIN', 'Запрос пришёл не из админки'],
  ['FIELD_NOT_ALLOWED', 'Это поле так поменять нельзя'],
  ['CHANGE_EMAIL_DISABLED', 'Почту сменить нельзя'],
  ['EMAIL_CAN_NOT_BE_UPDATED', 'Почту сменить нельзя'],
  ['PASSWORD_TOO_SHORT', 'Пароль слишком короткий'],
  ['PASSWORD_TOO_LONG', 'Пароль слишком длинный'],
  ['INVALID_PASSWORD', 'Неверный пароль'],
  ['SESSION_EXPIRED', 'Сессия кончилась, войдите снова'],
  ['USER_NOT_FOUND', 'Пользователь не найден'],
  ['VALIDATION_ERROR', 'Данные не прошли проверку'],
  ['INVALID_TOKEN', INVALID_RESET_LINK],
  ['RESET_PASSWORD_DISABLED', 'Сброс пароля по почте не настроен'],
  ['BODY_MUST_BE_AN_OBJECT', 'Данные не прошли проверку'],
])

// Остальные коды Better Auth — английским текстом библиотеки. Код отдаём как есть,
// а сообщение — общее по статусу ответа, но по-русски
const fallbackMessages = new Map([
  [400, 'Запрос не принят'],
  [401, 'Нужно войти'],
  [403, 'Нет доступа'],
  [404, 'Не найдено'],
])

async function asApiError(res: Response) {
  if (res.status < 400) return res
  const body = BetterAuthError.safeParse(
    await res
      .clone()
      .json()
      .catch(() => null),
  )
  let code = (body.data?.code ?? (res.status === 404 ? 'not_found' : 'auth_error')).toLowerCase()
  let message =
    messages.get(body.data?.code ?? '') ?? fallbackMessages.get(res.status) ?? 'Ошибка входа'
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

/** Что отвечаем на «Забыли пароль?» — одно и то же для любого адреса */
export const RESET_REQUESTED = {
  status: 'sent',
  message: 'Если такой адрес есть в админке, на него придёт письмо со ссылкой. Ссылка работает час',
} as const

type AuthRoutesDeps = {
  auth: Auth
  mail: MailDeps
  /**
   * Лимиты запросов сброса: с одного IP и на один адрес. IP проверяется первым: адрес
   * попадает в счётчик, только если IP-лимит запрос пропустил, — иначе один клиент, перебирая
   * адреса, наполнял бы счётчик адресов без ограничения
   */
  resetLimits: { byIp: RateLimiter; byEmail: RateLimiter }
  /**
   * Запрос сброса отвечает не раньше, чем через столько миллисекунд. Без этого существующий
   * адрес отвечал бы заметно дольше (запись токена и письма), и по времени было бы видно,
   * есть ли такой пользователь
   */
  resetResponseMs: number
}

/** 429 на запрос сброса: от кого лимит и через сколько минут можно снова */
function tooManyResets(whose: string, retryAfterMs: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000))
  return {
    error: {
      code: 'rate_limited',
      message: `Слишком много запросов сброса ${whose}. Подождите ${minutes} мин и попробуйте снова`,
    },
  }
}

/**
 * Тело «нового пароля по ссылке». Пароль проверяет Better Auth (и отвечает по-русски через
 * messages), а формат токена — мы, до Better Auth (ResetPasswordToken)
 */
const ResetPasswordBody = z.strictObject({ token: z.string(), newPassword: z.string() })

/**
 * Пути сброса пароля, которые до Better Auth не пускаем мимо наших обёрток: со слешем в конце,
 * двойным слешем, в другом регистре, закодированные (%2F, %2D) и старое имя forget-password.
 * Иначе запрос обошёл бы проверки обёрток, а его счёт в лимите Better Auth разошёлся бы с нашим
 */
function isResetPathVariant(url: string) {
  let path = new URL(url).pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    return true
  }
  return /(request-password-reset|reset-password|forget-password)/i.test(path)
}

/** Запрос в Better Auth с нашим телом вместо присланного; адрес — без строки запроса */
function withJsonBody(req: Request, body: unknown) {
  const url = new URL(req.url)
  url.search = ''
  const headers = new Headers(req.headers)
  headers.set('content-type', 'application/json')
  headers.delete('content-length')
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function authRoutes({ auth, mail, resetLimits, resetResponseMs }: AuthRoutesDeps) {
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

      // Можно ли сбросить пароль по почте: экран «Забыли пароль?» говорит это заранее.
      // Открыт без входа (auth/middleware.ts), подробностей настройки почты не отдаёт
      .get('/password-reset', (c) => c.json({ available: mail.status.enabled }, 200))

      // «Забыли пароль?» Перед Better Auth: своя схема (только почта, без redirectTo), почта
      // выключена — 503 для любого адреса, лимиты по IP и на адрес, одинаковый ответ в одно время.
      // Письмо ставит в очередь sendResetPassword (auth/auth.ts)
      .post('/auth/request-password-reset', validate('json', ForgotPassword), async (c) => {
        const started = Date.now()
        if (!mail.status.enabled) return c.json(mailDisabled(mail.status.reason), 503)
        const { email } = c.req.valid('json')
        // IP — так же, как его видит лимит Better Auth (X-Forwarded-For ставит index.ts).
        // Не нашли — общий счётчик, как у Better Auth: лучше общий лимит, чем никакого
        const ip = getIP(c.req.raw, auth.options) ?? 'no-trusted-ip'
        const byIp = resetLimits.byIp.take(ip)
        if (!byIp.allowed) return c.json(tooManyResets('с вашего адреса', byIp.retryAfterMs), 429)
        // Адрес — только после IP: отбитые по IP запросы счётчик адресов не растят.
        // Считаем любой адрес, есть он в базе или нет: иначе 429 выдавал бы существующие
        const byEmail = resetLimits.byEmail.take(email)
        if (!byEmail.allowed) {
          return c.json(tooManyResets('для этого адреса', byEmail.retryAfterMs), 429)
        }
        // Тело собираем заново: в Better Auth уходит только проверенная почта
        const res = await asApiError(await auth.handler(withJsonBody(c.req.raw, { email })))
        const wait = resetResponseMs - (Date.now() - started)
        if (wait > 0) await sleep(wait)
        // Запасной лимит Better Auth (auth/auth.ts) выше нашего и сработать не должен. Если всё же
        // сработал — ответ тот же, что у нашего лимита по IP, а не второй формат
        if (res.status === 429) {
          const retryAfterMs = (Number(res.headers.get('x-retry-after')) || 60) * 1000
          return c.json(tooManyResets('с вашего адреса', retryAfterMs), 429)
        }
        if (!res.ok) return res
        return c.json(RESET_REQUESTED, 200)
      })

      // Ссылка Better Auth вида /api/auth/reset-password/<токен> несёт токен в пути, а путь
      // пишется в лог запросов. Наша ссылка ведёт сразу в админку (токен во фрагменте),
      // так что эта не нужна
      .get('/auth/reset-password/:token', (c) => c.json(notFound('Не найдено'), 404))

      // Новый пароль по ссылке. Перед Better Auth проверяем формат токена: 24 буквы и цифры.
      // Better Auth ищет запись не только по хешу токена, но и по строке как есть (см.
      // auth/password-reset.ts): всё, что не похоже на его токен, до поиска не доходит.
      // Кривой токен для человека — та же мёртвая ссылка, ответ тот же, что у Better Auth
      .post('/auth/reset-password', validate('json', ResetPasswordBody), async (c) => {
        const { token, newPassword } = c.req.valid('json')
        if (!ResetPasswordToken.safeParse(token).success) {
          return c.json({ error: { code: 'invalid_token', message: INVALID_RESET_LINK } }, 400)
        }
        return asApiError(await auth.handler(withJsonBody(c.req.raw, { token, newPassword })))
      })

      // Вход, выход и сессии — Better Auth (/api/auth/sign-in/email, /api/auth/sign-out и т.д.).
      // Сброс пароля — только через обёртки выше: варианты их путей сюда не пропускаем
      .on(['GET', 'POST'], '/auth/*', async (c) => {
        if (isResetPathVariant(c.req.url)) return c.json(notFound('Не найдено'), 404)
        return asApiError(await auth.handler(c.req.raw))
      })
  )
}
