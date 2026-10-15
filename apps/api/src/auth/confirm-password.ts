import { isAPIError } from 'better-auth/api'
import { createRateLimiter } from '../rate-limit'
import type { SessionUser } from './access'
import type { Auth } from './auth'

// Повторный ввод своего пароля для действий, через которые можно перехватить доступ: сейчас —
// настройки почты (через SMTP уходят ссылки сброса пароля). Украденной сессии без пароля мало.
// Пароль проверяет Better Auth. Все пути, которыми вошедший проверяет свой пароль по HTTP, идут
// через один счётчик неудач: подтверждение (verifyPassword по cookie запроса) и смена пароля
// (/api/auth/change-password, modules/auth/routes.ts). Собственная проверка пароля Better Auth
// по HTTP закрыта (CLOSED_AUTH_PATHS в auth.ts): иначе пароль подбирали бы мимо этого счётчика

/** Неудачных попыток ввести свой пароль: не больше 5 за 15 минут на пользователя */
export const PASSWORD_CONFIRM_FAILURES = { max: 5, windowMs: 15 * 60 * 1000 } as const

const WRONG_PASSWORD = 'Неверный пароль'

/** Отказ: неверный пароль (403) или слишком много неудач (429). Тело — в формате ApiError */
export type PasswordRefusal = {
  ok: false
  status: 403 | 429
  body: {
    error: { code: string; message: string; issues?: { path: string; message: string }[] }
  }
}

export type PasswordConfirmation = { ok: true } | PasswordRefusal

/** Чем кончилась проверка пароля: был ли он неверным и что вернуть вызывающему */
export type PasswordCheck<T> = { wrongPassword: boolean; result: T }

/**
 * Неверный пароль — 403 с путём currentPassword, а не 401: 401 админка понимает как
 * «сессия кончилась» и уводит на вход
 */
const wrongPassword: PasswordRefusal = {
  ok: false,
  status: 403,
  body: {
    error: {
      code: 'invalid_password',
      message: WRONG_PASSWORD,
      issues: [{ path: 'currentPassword', message: WRONG_PASSWORD }],
    },
  },
}

function tooManyFailures(retryAfterMs: number): PasswordRefusal {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000))
  return {
    ok: false,
    status: 429,
    body: {
      error: {
        code: 'rate_limited',
        message: `Слишком много неверных попыток ввести пароль. Подождите ${minutes} мин и попробуйте снова`,
      },
    },
  }
}

/**
 * Проверки своего пароля под одним счётчиком неудач на пользователя. Счётчик свой на каждый
 * экземпляр API (его создаёт createApp и отдаёт всем маршрутам, которые проверяют пароль)
 */
export function createPasswordConfirmation(auth: Auth) {
  const failures = createRateLimiter(PASSWORD_CONFIRM_FAILURES)

  /**
   * Одна попытка проверить пароль пользователя. Учитывается до проверки — перебор не идёт мимо
   * лимита, пока scrypt думает, — и возвращается, если пароль не оказался неверным: удачные
   * попытки и те, что до пароля не дошли (сбой базы, кривой новый пароль, лимит Better Auth),
   * счёт не тратят. Проверку делает check
   */
  async function attempt<T>(
    userId: string,
    check: () => Promise<PasswordCheck<T>>,
  ): Promise<{ ok: true; result: T } | PasswordRefusal> {
    const taken = failures.take(userId)
    if (!taken.allowed) return tooManyFailures(taken.retryAfterMs)
    let outcome: PasswordCheck<T>
    try {
      outcome = await check()
    } catch (error) {
      failures.refund(userId)
      throw error
    }
    if (outcome.wrongPassword) return wrongPassword
    failures.refund(userId)
    return { ok: true, result: outcome.result }
  }

  /** Подтвердить свой пароль (настройки почты): verifyPassword Better Auth по cookie запроса */
  async function confirm(
    user: SessionUser,
    password: string,
    headers: Headers,
  ): Promise<PasswordConfirmation> {
    const outcome = await attempt(user.id, async () => {
      try {
        await auth.api.verifyPassword({ body: { password }, headers })
        return { wrongPassword: false, result: undefined }
      } catch (error) {
        // INVALID_PASSWORD, PASSWORD_TOO_LONG и прочие отказы Better Auth — неверный пароль.
        // Остальное (база недоступна) — не ответ на пароль: пусть станет 500
        if (!isAPIError(error)) throw error
        return { wrongPassword: true, result: undefined }
      }
    })
    return outcome.ok ? { ok: true } : outcome
  }

  return { confirm, attempt }
}

export type PasswordConfirmations = ReturnType<typeof createPasswordConfirmation>
