import {
  ExistingPageSlug,
  MAIN_PAGE_SLUG,
  NewPreviewLink,
  PreviewLinkParams,
  PreviewSiteParams,
} from '@averra/schema'
import { Hono } from 'hono'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { validate } from '../../validate'
import { previewLinksRepo } from './repo'
import { draftSnapshot } from './snapshot'

export function previewLinksRoutes({ db, adminUrl }: { db: Db; adminUrl: string }) {
  const links = previewLinksRepo(db)
  const manage = requireSite(db, 'preview.share')
  return new Hono<AuthEnv>()
    .use('*', async (c, next) => {
      c.header('Cache-Control', 'no-store')
      c.header('Referrer-Policy', 'no-referrer')
      await next()
    })
    .get('/', validate('param', PreviewSiteParams), manage, async (c) =>
      c.json(await links.list(c.req.valid('param').siteId)),
    )
    .post(
      '/',
      validate('param', PreviewSiteParams),
      manage,
      validate('json', NewPreviewLink),
      async (c) => {
        const { name, days } = c.req.valid('json')
        const created = await links.create(c.req.valid('param').siteId, name, days)
        return c.json(
          { ...created, url: `${adminUrl.replace(/\/$/, '')}/preview/${created.token}/` },
          201,
        )
      },
    )
    .delete('/:id', validate('param', PreviewLinkParams), manage, async (c) => {
      const { siteId, id } = c.req.valid('param')
      if (!(await links.revoke(siteId, id))) return c.json(notFound('Ссылка не найдена'), 404)
      return c.body(null, 204)
    })
}

/** Открыт только GET: cookie и Bearer не читаются, доступ даёт исключительно секрет ссылки. */
export function publicPreviewRoutes({ db, siteUrl }: { db: Db; siteUrl?: string }) {
  const links = previewLinksRepo(db)
  return new Hono().get('/:token/*', async (c) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Robots-Tag', 'noindex, nofollow')
    const link = await links.verify(c.req.param('token'))
    if (!link) return c.json(notFound('Ссылка недействительна: срок истёк или доступ отозван'), 404)
    const path = c.req.path.split('/').slice(4).join('/').replace(/\/$/, '')
    if (path && !ExistingPageSlug.safeParse(path).success)
      return c.json(notFound('Страница не найдена в черновиках'), 404)
    const snapshot = await draftSnapshot(db, link.siteId, path || MAIN_PAGE_SLUG, siteUrl)
    if (!snapshot) return c.json(notFound('Страница не найдена в черновиках'), 404)
    return c.json({ ...snapshot, expiresAt: link.expiresAt })
  })
}
