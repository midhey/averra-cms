import { NewToken, TokenRightsPatch, Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound, requireInstallation } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict } from '../../errors'
import { validate } from '../../validate'
import { sitesRepo } from '../sites/repo'
import { tokensRepo } from './repo'

const TokenParams = z.object({ id: Uuid() })

type TokenRow = Awaited<ReturnType<ReturnType<typeof tokensRepo>['list']>>[number]

/** Токен для экрана: без хеша и без самого токена — его показывает только ответ на выпуск */
const viewOf = (token: TokenRow) => ({
  id: token.id,
  name: token.name,
  rights: token.rights,
  // Имя, а если его нет (пользователя удалили — автора нет) — null
  createdBy: token.createdByName ?? token.createdBy ?? null,
  createdAt: token.createdAt,
  lastUsedAt: token.lastUsedAt,
  revokedAt: token.revokedAt,
})

/**
 * Токены API (раздел «Доступ для ИИ»): список, выпуск, права, отзыв. Монтируется на /tokens. Только
 * владелец установки (tokens.manage в access.ts): администратор сайта и редактор — 403, токен — 403
 * всегда (tokenDenied), иначе программа выдала бы себе права. Сам токен уходит один раз — в ответе
 * на выпуск; в базе и в списке его нет, только хеш в базе
 */
export function tokensRoutes({ db }: { db: Db }) {
  const tokens = tokensRepo(db)
  const sites = sitesRepo(db)
  const manage = requireInstallation(db, 'tokens.manage')

  const find = async (id: string) => (await tokens.list()).find((token) => token.id === id)

  return (
    new Hono<AuthEnv>()
      // Новые сверху: чаще всего ищут только что выпущенный
      .get('/', manage, async (c) => {
        const list = (await tokens.list()).map(viewOf).reverse()
        return c.json(list, 200)
      })

      // Выпуск — на сайт установки: в установке он один. Права не названы — «только черновики»
      .post('/', manage, validate('json', NewToken), async (c) => {
        const { name, rights } = c.req.valid('json')
        const site = await sites.installationSite()
        if (!site) return c.json(notFound('В установке ещё нет сайта'), 404)
        const { actor } = c.var
        const createdBy = actor.kind === 'user' ? actor.user.id : undefined
        const { id, token } = await tokens.create({ siteId: site.id, name, createdBy, rights })
        const created = await find(id)
        if (!created) throw new Error(`Токен ${id} не нашёлся сразу после выпуска`)
        return c.json({ ...viewOf(created), token }, 201)
      })

      // Права действуют сразу: их читают при каждом запросе токена
      .patch(
        '/:id',
        validate('param', TokenParams),
        manage,
        validate('json', TokenRightsPatch),
        async (c) => {
          const { id } = c.req.valid('param')
          const current = await find(id)
          if (!current) return c.json(notFound('Токен не найден'), 404)
          if (current.revokedAt) {
            return c.json(conflict('Токен отозван: права ему уже не нужны. Выпустите новый'), 409)
          }
          await tokens.setRights(id, c.req.valid('json'))
          const updated = await find(id)
          if (!updated) return c.json(notFound('Токен не найден'), 404)
          return c.json(viewOf(updated), 200)
        },
      )

      // Отзыв навсегда: вернуть токен нельзя, только выпустить новый. Повторный — тоже 204
      .delete('/:id', validate('param', TokenParams), manage, async (c) => {
        const { id } = c.req.valid('param')
        if (!(await tokens.revoke(id))) return c.json(notFound('Токен не найден'), 404)
        return c.body(null, 204)
      })
  )
}
