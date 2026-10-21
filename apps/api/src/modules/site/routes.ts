import { Hono } from 'hono'
import { siteRoleOf } from '../../auth/access'
import { type AuthEnv, forbidden, notFound } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { sitesRepo } from '../sites/repo'
import { siteSnapshot } from '../sites/snapshot'

/** 403 участнику, у которого доступ только к другому сайту базы (старые базы разработки) */
export const NO_INSTALLATION_SITE_ACCESS =
  'Нет доступа к сайту этой установки: попросите владельца пригласить вас'

// Одна установка — один сайт. Здесь — «сайт, с которым работает пришедший», без id в адресе:
// админка и рендерер узнают по нему id и дальше ходят в /api/sites/:siteId/… как раньше.
// Сайт установки выбирает правило sitesRepo.installationSite (созданный первым)
export function siteRoutes({ db, siteUrl }: { db: Db; siteUrl: string | undefined }) {
  const repo = sitesRepo(db)

  return (
    new Hono<AuthEnv>()
      // Человек — сайт установки, если у него есть к нему доступ. Токен — сайт, на который он
      // выпущен (в установке это тот же сайт). url — адрес опубликованного сайта (SITE_URL), его
      // домен админка показывает в панели. otherSites — сколько ещё сайтов в базе, только
      // владельцу: участнику и токену чужие сайты не видны
      .get('/', async (c) => {
        const { actor } = c.var
        const site =
          actor.kind === 'token' ? await repo.find(actor.siteId) : await repo.installationSite()
        if (!site) return c.json(notFound('Сайт не найден'), 404)
        if (!(await siteRoleOf(db, actor, site.id))) {
          return c.json(forbidden(NO_INSTALLATION_SITE_ACCESS), 403)
        }
        const owner = actor.kind === 'user' && actor.user.role === 'owner'
        return c.json({
          id: site.id,
          name: site.name,
          url: siteUrl ?? null,
          otherSites: owner ? (await repo.count()) - 1 : null,
        })
      })

      // Снимок сайта установки для рендерера: в pnpm dev ему не нужен CMS_SITE_ID. Открыт без
      // входа, как /api/sites/:siteId/snapshot (auth/middleware.ts)
      .get('/snapshot', async (c) => {
        const site = await repo.installationSite()
        const snapshot = site ? await siteSnapshot(db, site.id) : undefined
        if (!snapshot) return c.json(notFound('В установке ещё нет сайта'), 404)
        return c.json(snapshot)
      })
  )
}
