import type { ForgotPassword, ResetPassword, SignIn } from '@averra/schema'
import { apiFetch, apiRequestError } from './errors'

// Вход, выход и сброс пароля — эндпоинты Better Auth (/api/auth/*). Их нет в типах Hono RPC,
// поэтому обычный fetch. Ошибки API отдаёт в том же формате ApiError, что и остальные маршруты

async function post(path: string, body: unknown) {
  const res = await apiFetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await apiRequestError(res)
}

/** Вход по почте и паролю. Сессия приходит httpOnly-cookie: скрипту админки она не видна */
export const signIn = ({ email, password }: SignIn) => post('sign-in/email', { email, password })

export const signOut = () => post('sign-out', {})

/**
 * «Забыли пароль?»: API отвечает одинаково, есть такой адрес или нет, и шлёт письмо
 * со ссылкой, только если есть. Почта выключена — ApiRequestError с кодом mail_disabled
 */
export const requestPasswordReset = ({ email }: ForgotPassword) =>
  post('request-password-reset', { email })

/** Новый пароль по ссылке из письма. Все входы пользователя после этого завершаются */
export const resetPassword = ({ token, newPassword }: ResetPassword) =>
  post('reset-password', { token, newPassword })
