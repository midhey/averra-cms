import { ProfileUpdate } from '@averra/schema'
import { and, count, eq, gt, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Auth } from '../../auth/auth'
import { type AuthEnv, forbidden, unauthorized } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { sessions, users } from '../../db/schema'
import { validate } from '../../validate'

/** Профиль — у человека: у токена API нет ни имени, ни входов */
const userOnly = createMiddleware<AuthEnv>(async (c, next) => {
  if (c.var.actor.kind !== 'user') return c.json(forbidden('Профиль есть только у человека'), 403)
  return next()
})

/**
 * Свой профиль (экран «Профиль»): имя и входы на других устройствах. Монтируется на /me, рядом
 * с GET /me из modules/auth. Пароль меняет POST /api/auth/change-password (modules/auth): там
 * общий счётчик неудач пароля. Почту здесь не меняют — по ней входят и приходят письма
 */
export function profileRoutes({ db, auth }: { db: Db; auth: Auth }) {
  /** Текущая сессия запроса: её id отличает «этот вход» от остальных. Без продления */
  const currentSession = async (headers: Headers) =>
    auth.api.getSession({ headers, query: { disableRefresh: true } })

  return (
    new Hono<AuthEnv>()
      .patch('/', userOnly, validate('json', ProfileUpdate), async (c) => {
        const { actor } = c.var
        if (actor.kind !== 'user') return c.json(forbidden('Профиль есть только у человека'), 403)
        const { name } = c.req.valid('json')
        await db
          .update(users)
          .set({ name, updatedAt: new Date() })
          .where(eq(users.id, actor.user.id))
        return c.json({ kind: 'user' as const, user: { ...actor.user, name } }, 200)
      })

      // Сколько ещё действующих входов, кроме этого: экран говорит, есть ли кого завершать
      .get('/sessions', userOnly, async (c) => {
        const session = await currentSession(c.req.raw.headers)
        if (!session) return c.json(unauthorized(), 401)
        const [row] = await db
          .select({ value: count() })
          .from(sessions)
          .where(
            and(
              eq(sessions.userId, session.user.id),
              ne(sessions.id, session.session.id),
              gt(sessions.expiresAt, new Date()),
            ),
          )
        return c.json({ others: row?.value ?? 0 }, 200)
      })

      // «Выйти на других устройствах»: все входы, кроме этого, завершаются сразу
      .post('/sessions/revoke-others', userOnly, async (c) => {
        const session = await currentSession(c.req.raw.headers)
        if (!session) return c.json(unauthorized(), 401)
        const revoked = await db
          .delete(sessions)
          .where(and(eq(sessions.userId, session.user.id), ne(sessions.id, session.session.id)))
          .returning({ id: sessions.id })
        return c.json({ revoked: revoked.length }, 200)
      })
  )
}
