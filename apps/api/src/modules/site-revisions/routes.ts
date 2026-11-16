import { Uuid } from '@averra/schema'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import type { Permission } from '../../auth/access'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict } from '../../errors'
import { validate } from '../../validate'
import { type SiteRevisionEntity, siteRevisionsRepo } from './repo'

const SiteParams = z.object({ siteId: Uuid() })
const RevisionParams = SiteParams.extend({ revisionId: Uuid() })

/** Возврат проходит те же проверки, что сохранение черновика; публикацию решает человек */
export function siteRevisionsRoutes<T>({
  db,
  entity,
  schema,
  restore,
}: {
  db: Db
  entity: SiteRevisionEntity
  schema: z.ZodType<T>
  restore: (c: Context<AuthEnv>, siteId: string, content: T) => Promise<Response>
}) {
  const repo = siteRevisionsRepo(db, entity)
  const read: Permission = entity === 'script' ? 'blocks.draft' : 'site.read'
  const edit: Permission =
    entity === 'script' ? 'blocks.define' : entity === 'theme' ? 'theme.edit' : 'header.edit'
  return new Hono<AuthEnv>()
    .get('/', validate('param', SiteParams), requireSite(db, read), async (c) =>
      c.json(await repo.list(c.req.valid('param').siteId), 200),
    )
    .post(
      '/:revisionId/restore',
      validate('param', RevisionParams),
      requireSite(db, edit),
      async (c) => {
        const { siteId, revisionId } = c.req.valid('param')
        const revision = await repo.find(siteId, revisionId)
        if (!revision) return c.json(notFound('Версия не найдена'), 404)
        const parsed = schema.safeParse(revision.content)
        if (!parsed.success) {
          return c.json(
            conflict(
              'Версия не подходит под нынешнюю схему, вернуть её в черновик нельзя',
              parsed.error.issues.map((issue) => ({
                path: issue.path.map(String).join('.'),
                message: issue.message,
              })),
            ),
            409,
          )
        }
        return restore(c, siteId, parsed.data)
      },
    )
}
