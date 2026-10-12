import type { SignIn } from '@cms/schema'
import { apiFetch, apiRequestError } from './errors'

// Вход и выход — эндпоинты Better Auth (/api/auth/*). Их нет в типах Hono RPC, поэтому
// обычный fetch. Ошибки API отдаёт в том же формате ApiError, что и остальные маршруты

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
