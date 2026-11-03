import {
  InvitationAccept,
  InvitationLookup,
  InvitationRegister,
  type MemberRole,
  NewInvitation,
  roleLabels,
  Uuid,
} from '@averra/schema'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { canAssign } from '../../auth/access'
import type { Auth } from '../../auth/auth'
import { type AuthEnv, forbidden, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict, invitationError, mailDisabled } from '../../errors'
import { createRateLimiter } from '../../rate-limit'
import { validate } from '../../validate'
import type { MailDeps } from '../mail/routes'
import { usersRepo } from '../users/repo'
import { invitationsRepo } from './repo'
import {
  acceptInvitation,
  createInvitation,
  lookupInvitation,
  registerByInvitation,
} from './service'

const SiteParams = z.object({ siteId: Uuid() })
const InvitationParams = SiteParams.extend({ invitationId: Uuid() })

type InvitationDeps = {
  db: Db
  mail: MailDeps
  /** Адрес админки: в письмо уходит ссылка на её экран принятия */
  adminUrl: string
}

const HOUR_MS = 60 * 60 * 1000

/** Писем-приглашений одному адресу на один сайт: не больше трёх в час */
export const INVITES_PER_ADDRESS = { max: 3, windowMs: HOUR_MS } as const

/** Приглашений от одного владельца: не больше 50 в час (на случай, если увели сессию) */
export const INVITES_PER_INVITER = { max: 50, windowMs: HOUR_MS } as const

/** 429 на приглашение: чей лимит и через сколько минут можно снова */
function tooManyInvites(message: string, retryAfterMs: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000))
  return {
    error: {
      code: 'rate_limited',
      message: `${message}. Подождите ${minutes} мин и попробуйте снова`,
    },
  }
}

/** Без почты приглашение бессмысленно: ссылку человек не получит. Честно отвечаем 503 */
const requireMail = (mail: MailDeps) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    // Состояние — нынешнее: SMTP могли настроить или сломать в админке без перезапуска API
    const status = mail.runtime.status()
    if (!status.enabled) return c.json(mailDisabled(status.reason), 503)
    return next()
  })

/** Администратор сайта приглашает и отзывает только редакторов: остальных — владелец */
const ONLY_EDITORS =
  'Администратор сайта приглашает только редакторов. Администратора сайта приглашает владелец'

/**
 * Приглашения на сайт — у владельца и администратора сайта: список, пригласить, отправить ещё раз,
 * отозвать. Монтируется на /sites/:siteId/invitations. Чужой сайт — 404 (requireSite), редактор и
 * токен — 403. Администратор сайта — только с ролью «редактор» (assignableRoles в access.ts)
 */
export function siteInvitationsRoutes({ db, mail, adminUrl }: InvitationDeps) {
  const repo = invitationsRepo(db)
  const invite = requireSite(db, 'members.invite')
  // Каждое приглашение — письмо на любой адрес. Свои на каждый экземпляр API, как у сброса пароля
  const byInviter = createRateLimiter(INVITES_PER_INVITER)
  const byAddress = createRateLimiter(INVITES_PER_ADDRESS)

  /**
   * Новое приглашение с письмом — и на «Пригласить», и на «Отправить ещё раз»: те же лимиты
   * и те же отказы. Прежняя ссылка этого адреса гаснет
   */
  async function send(c: Context<AuthEnv>, siteId: string, email: string, role: MemberRole) {
    const { actor } = c.var
    const inviter = actor.kind === 'user' ? actor.user : undefined
    const fromInviter = byInviter.take(inviter?.id ?? 'token')
    if (!fromInviter.allowed) {
      return c.json(
        tooManyInvites('Слишком много приглашений за час', fromInviter.retryAfterMs),
        429,
      )
    }
    const toAddress = byAddress.take(`${siteId} ${email}`)
    if (!toAddress.allowed) {
      return c.json(
        tooManyInvites(`На ${email} уже ушло несколько приглашений за час`, toAddress.retryAfterMs),
        429,
      )
    }
    const now = new Date()
    const result = await createInvitation(db, { siteId, email, role, inviter, adminUrl, now })
    if (!result.ok) {
      if (result.problem === 'site_not_found') return c.json(notFound('Сайт не найден'), 404)
      const message =
        result.problem === 'owner'
          ? 'Это владелец админки: ему и так открыты все сайты'
          : result.problem === 'disabled'
            ? `Доступ ${email} отключён. Верните его в списке участников выше`
            : `Уже участник этого сайта («${roleLabels[result.role]}»). Роль меняется в списке участников выше`
      return c.json(conflict(message, [{ path: 'email', message }]), 409)
    }
    mail.wake()
    return c.json(
      {
        id: result.invitation.id,
        email,
        role,
        invitedBy: inviter?.name ?? null,
        createdAt: now,
        expiresAt: result.invitation.expiresAt,
        acceptedAt: null,
        revokedAt: null,
        status: 'pending' as const,
      },
      201,
    )
  }

  return (
    new Hono<AuthEnv>()
      .get('/', validate('param', SiteParams), invite, async (c) => {
        const { siteId } = c.req.valid('param')
        return c.json(await repo.list(siteId, new Date()), 200)
      })

      .post(
        '/',
        validate('param', SiteParams),
        invite,
        requireMail(mail),
        validate('json', NewInvitation),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const { email, role } = c.req.valid('json')
          if (!canAssign(c.var.siteRole, role)) return c.json(forbidden(ONLY_EDITORS), 403)
          return send(c, siteId, email, role)
        },
      )

      // Отправить ещё раз: ждущее или истёкшее приглашение — новым письмом с той же ролью
      .post(
        '/:invitationId/resend',
        validate('param', InvitationParams),
        invite,
        requireMail(mail),
        async (c) => {
          const { siteId, invitationId } = c.req.valid('param')
          const found = await repo.find(siteId, invitationId, new Date())
          if (!found) return c.json(notFound('Приглашение не найдено'), 404)
          if (!canAssign(c.var.siteRole, found.role)) return c.json(forbidden(ONLY_EDITORS), 403)
          if (found.status === 'accepted') {
            return c.json(conflict('Приглашение уже принято: доступ выдан'), 409)
          }
          if (found.status === 'revoked') {
            return c.json(conflict('Приглашение отозвано: пригласите заново формой выше'), 409)
          }
          return send(c, siteId, found.email, found.role)
        },
      )

      .delete('/:invitationId', validate('param', InvitationParams), invite, async (c) => {
        const { siteId, invitationId } = c.req.valid('param')
        const now = new Date()
        const found = await repo.find(siteId, invitationId, now)
        if (!found) return c.json(notFound('Приглашение не найдено'), 404)
        if (!canAssign(c.var.siteRole, found.role)) return c.json(forbidden(ONLY_EDITORS), 403)
        const result = await repo.revoke(siteId, invitationId, now)
        if (result === 'not_found') return c.json(notFound('Приглашение не найдено'), 404)
        if (result === 'accepted') {
          return c.json(conflict('Приглашение уже принято: доступ выдан, отзывать нечего'), 409)
        }
        return c.body(null, 204)
      })
  )
}

/**
 * Принятие приглашения по ссылке из письма. Монтируется на /invitations. Токен — в теле,
 * а не в пути: путь попадает в лог запросов. lookup и register открыты без входа
 * (список в auth/middleware.ts): у нового участника ещё нет пользователя
 */
export function invitationsRoutes({ db, auth }: { db: Db; auth: Auth }) {
  const users = usersRepo(db, auth)
  const gone = (problem: Parameters<typeof invitationError>[0]) => invitationError(problem)

  return (
    new Hono<AuthEnv>()
      .post('/lookup', validate('json', InvitationLookup), async (c) => {
        const result = await lookupInvitation(db, c.req.valid('json').token)
        if (!result.ok) {
          const { status, body } = gone(result.problem)
          return c.json(body, status)
        }
        return c.json(result.invitation, 200)
      })

      .post('/register', validate('json', InvitationRegister), async (c) => {
        const { token, name, password } = c.req.valid('json')
        const result = await registerByInvitation(db, {
          token,
          name,
          password,
          hashPassword: users.hashPassword,
        })
        if (!result.ok) {
          if (result.problem === 'user_exists') {
            return c.json(
              {
                error: {
                  code: 'user_exists',
                  message:
                    'У этого адреса уже есть вход в админку: войдите своим паролем и примите приглашение',
                },
              },
              409,
            )
          }
          const { status, body } = gone(result.problem)
          return c.json(body, status)
        }
        return c.json({ siteId: result.siteId, email: result.email }, 201)
      })

      // Только после входа (не в списке открытых): принимает тот, под кем вошли
      .post('/accept', validate('json', InvitationAccept), async (c) => {
        const { actor } = c.var
        if (actor.kind !== 'user') {
          return c.json(forbidden('Приглашение принимает человек, а не токен API'), 403)
        }
        const result = await acceptInvitation(db, {
          token: c.req.valid('json').token,
          user: actor.user,
        })
        if (!result.ok) {
          if (result.problem === 'wrong_user') {
            return c.json(
              forbidden(
                `Приглашение для ${result.email}, а вы вошли как ${actor.user.email}. Выйдите и войдите под адресом из приглашения`,
              ),
              403,
            )
          }
          const { status, body } = gone(result.problem)
          return c.json(body, status)
        }
        return c.json({ siteId: result.siteId }, 200)
      })
  )
}
