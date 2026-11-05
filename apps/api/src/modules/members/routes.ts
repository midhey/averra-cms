import { MemberRoleChange, roleLabels, type SiteRoleKey, Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { canAssign, type SiteRole } from '../../auth/access'
import { type AuthEnv, forbidden, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict } from '../../errors'
import { validate } from '../../validate'
import { LastOwnerError, type MemberRow, membersRepo } from './repo'

const SiteParams = z.object({ siteId: Uuid() })
const MemberParams = SiteParams.extend({ userId: Uuid() })

/** Участник для экрана: даты строкой, «это вы» — чтобы экран не предлагал менять себя */
const viewOf = (member: MemberRow, selfId: string) => ({
  id: member.id,
  name: member.name,
  email: member.email,
  role: member.role,
  status: member.disabledAt ? ('disabled' as const) : ('active' as const),
  disabledAt: member.disabledAt,
  disabledRole: member.disabledRole,
  since: member.since,
  activeTokens: member.activeTokens,
  self: member.id === selfId,
})

const LAST_OWNER =
  'Это последний владелец установки: сначала сделайте владельцем кого-то ещё, иначе управлять установкой будет некому'

/** Администратор сайта меняет только редакторов — и только в редакторов */
const onlyEditors = (actor: SiteRole) =>
  actor === 'client'
    ? 'Администратор сайта управляет только редакторами. Остальных меняет владелец'
    : 'Менять участников может владелец или администратор сайта'

/**
 * Можно ли вошедшему трогать этого участника: по нынешней роли, у отключённого — по роли до
 * отключения. Иначе администратор сайта вернул бы доступ администратору или бывшему владельцу,
 * которых отключил владелец. Роль до отключения неизвестна — решает только владелец
 */
const canManage = (actor: SiteRole, target: MemberRow) => {
  const role = target.role ?? target.disabledRole
  return role === null ? actor === 'owner' : canAssign(actor, role)
}

/**
 * Участники сайта (раздел «Настройки сайта → Участники»): список, смена роли, отключение,
 * возврат доступа и передача владения. Монтируется на /sites/:siteId/members. Доступ — то же
 * действие, что у приглашений (members.invite): владелец и администратор сайта; редактор и токен
 * — 403. Кого из участников трогать, решает assignableRoles в access.ts: владелец — всех, кроме
 * себя, администратор сайта — только редакторов. Свою роль не меняет никто: владелец отдаёт её
 * передачей владения, иначе можно было бы по ошибке остаться без доступа
 */
export function membersRoutes({ db }: { db: Db }) {
  const repo = membersRepo(db)
  const manage = requireSite(db, 'members.invite')

  /** Вошедший — человек (токен сюда не пускает members.invite: у токена роль «редактор») */
  const selfId = (actor: AuthEnv['Variables']['actor']) =>
    actor.kind === 'user' ? actor.user.id : ''

  return (
    new Hono<AuthEnv>()
      .get('/', validate('param', SiteParams), manage, async (c) => {
        const { siteId } = c.req.valid('param')
        const self = selfId(c.var.actor)
        return c.json(
          (await repo.list(siteId)).map((member) => viewOf(member, self)),
          200,
        )
      })

      // Сменить роль действующему участнику, в том числе сделать вторым владельцем
      .patch(
        '/:userId',
        validate('param', MemberParams),
        manage,
        validate('json', MemberRoleChange),
        async (c) => {
          const { siteId, userId } = c.req.valid('param')
          const { role } = c.req.valid('json')
          const actor = c.var.siteRole
          const self = selfId(c.var.actor)
          const target = await repo.find(siteId, userId)
          if (!target) return c.json(notFound('Участник не найден'), 404)
          if (target.id === self) {
            return c.json(
              conflict(
                'Свою роль не поменять: владелец отдаёт её передачей владения другому участнику',
              ),
              409,
            )
          }
          if (target.role === null) {
            return c.json(conflict('Доступ отключён: сначала верните его'), 409)
          }
          if (!canManage(actor, target) || !canAssign(actor, role)) {
            return c.json(forbidden(onlyEditors(actor)), 403)
          }
          try {
            if (target.role !== role) await repo.setRole(siteId, userId, role)
          } catch (error) {
            if (error instanceof LastOwnerError) return c.json(conflict(LAST_OWNER), 409)
            throw error
          }
          const updated = await repo.find(siteId, userId)
          if (!updated) throw new Error(`Участник ${userId} пропал после смены роли`)
          return c.json(viewOf(updated, self), 200)
        },
      )

      // Отключить доступ: сессии гаснут сразу, войти снова нельзя
      .post('/:userId/disable', validate('param', MemberParams), manage, async (c) => {
        const { siteId, userId } = c.req.valid('param')
        const actor = c.var.siteRole
        const self = selfId(c.var.actor)
        const target = await repo.find(siteId, userId)
        if (!target) return c.json(notFound('Участник не найден'), 404)
        if (target.id === self) {
          return c.json(conflict('Себя не отключить: выйдите из админки кнопкой «Выйти»'), 409)
        }
        if (!canManage(actor, target)) return c.json(forbidden(onlyEditors(actor)), 403)
        if (target.role !== null) {
          try {
            await repo.disable(userId, target.role)
          } catch (error) {
            if (error instanceof LastOwnerError) return c.json(conflict(LAST_OWNER), 409)
            throw error
          }
        }
        const updated = await repo.find(siteId, userId)
        if (!updated) throw new Error(`Участник ${userId} пропал после отключения`)
        return c.json(viewOf(updated, self), 200)
      })

      // Вернуть доступ отключённому — с ролью, которую вошедший может выдать
      .post(
        '/:userId/restore',
        validate('param', MemberParams),
        manage,
        validate('json', MemberRoleChange),
        async (c) => {
          const { siteId, userId } = c.req.valid('param')
          const { role } = c.req.valid('json')
          const actor = c.var.siteRole
          const self = selfId(c.var.actor)
          const target = await repo.find(siteId, userId)
          if (!target) return c.json(notFound('Участник не найден'), 404)
          if (target.role !== null) return c.json(conflict('Доступ и так есть'), 409)
          if (!canManage(actor, target) || !canAssign(actor, role)) {
            return c.json(forbidden(onlyEditors(actor)), 403)
          }
          await repo.restore(siteId, userId, role)
          const updated = await repo.find(siteId, userId)
          if (!updated) throw new Error(`Участник ${userId} пропал после возврата доступа`)
          return c.json(viewOf(updated, self), 200)
        },
      )

      // Передать владение: он — владелец, вошедший — администратор сайта. Только владельцу
      .post('/:userId/transfer', validate('param', MemberParams), manage, async (c) => {
        const { siteId, userId } = c.req.valid('param')
        const self = selfId(c.var.actor)
        if (c.var.siteRole !== 'owner') {
          return c.json(forbidden('Передать владение может только владелец'), 403)
        }
        const target = await repo.find(siteId, userId)
        if (!target) return c.json(notFound('Участник не найден'), 404)
        if (target.id === self) return c.json(conflict('Владение передают другому участнику'), 409)
        if (target.role === null) {
          return c.json(conflict('Доступ отключён: сначала верните его'), 409)
        }
        if (target.role === 'owner') {
          return c.json(
            conflict(
              `${target.name} уже владелец. Чтобы перестать быть владельцем, попросите его сменить вам роль`,
            ),
            409,
          )
        }
        await repo.transfer(siteId, self, userId)
        const newRole: SiteRoleKey = 'client'
        return c.json(
          {
            owner: viewOf({ ...target, role: 'owner' }, self),
            yourRole: newRole,
            message: `Владелец теперь ${target.name}. Ваша роль — «${roleLabels[newRole]}»`,
          },
          200,
        )
      })
  )
}
