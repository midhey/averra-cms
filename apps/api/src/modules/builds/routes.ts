import { Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import type { SitePublisher } from '../../publish/queue'
import { validate } from '../../validate'
import { buildsRepo, type SiteBuildRow } from './repo'

const SiteParams = z.object({ siteId: Uuid() })

/** 409 — на этой установке сайт не собирается сам (нет PUBLISH_DIR): собирать нечем */
export const publishDisabled = () => ({
  error: {
    code: 'publish_disabled',
    message:
      'Сборка сайта на сервере выключена: не задан PUBLISH_DIR. Опубликованное лежит в базе, ' +
      'а сайт собирают отдельно (см. https://midhey.github.io/averra-cms/install/)',
  },
})

const view = (row: SiteBuildRow | undefined) =>
  row
    ? {
        id: row.id,
        status: row.status,
        release: row.release,
        error: row.error,
        peakRssBytes: row.peakRssBytes,
        requestedAt: row.requestedAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
      }
    : null

/**
 * Сборка сайта на сервере: что сейчас с последней сборкой и какая версия на сайте, плюс «Собрать
 * заново» (например, после упавшей сборки). Сборку после публикации заводит сама публикация
 * (modules/sites/routes.ts)
 */
export function buildsRoutes({ db, publisher }: { db: Db; publisher?: SitePublisher }) {
  const repo = buildsRepo(db)

  return new Hono<AuthEnv>()
    .get('/', validate('param', SiteParams), requireSite(db, 'site.read'), async (c) => {
      const { siteId } = c.req.valid('param')
      if (!publisher) return c.json({ enabled: false as const, latest: null, live: null })
      const [latest, live] = await Promise.all([repo.latest(siteId), repo.lastSucceeded(siteId)])
      return c.json({ enabled: true as const, latest: view(latest), live: view(live) })
    })

    .post('/', validate('param', SiteParams), requireSite(db, 'page.publish'), async (c) => {
      const { siteId } = c.req.valid('param')
      if (!publisher) return c.json(publishDisabled(), 409)
      await publisher.request(siteId)
      return c.json({ latest: view(await repo.latest(siteId)) }, 202)
    })
}
