import { PageContent, PageTitle } from '@cms/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { validate } from '../../validate'
import { sitesRepo } from './repo'

const SiteParams = z.object({ siteId: z.uuid() })

const PageParams = SiteParams.extend({
  slug: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/, 'Адрес страницы: латиница в нижнем регистре, цифры и дефис'),
})

const SaveDraft = z.strictObject({
  title: PageTitle,
  content: PageContent,
})

const notFound = (message: string) => ({ error: { code: 'not_found', message } })

export function sitesRoutes({ db }: { db: Db }) {
  const repo = sitesRepo(db)

  return (
    new Hono()
      .get('/', async (c) => c.json(await repo.list()))

      .get('/:siteId', validate('param', SiteParams), async (c) => {
        const { siteId } = c.req.valid('param')
        const site = await repo.find(siteId)
        if (!site) return c.json(notFound('Сайт не найден'), 404)
        return c.json({ id: site.id, name: site.name, theme: site.theme })
      })

      // Всё, что нужно рендереру для сборки: тема и опубликованные страницы
      .get('/:siteId/snapshot', validate('param', SiteParams), async (c) => {
        const { siteId } = c.req.valid('param')
        const site = await repo.find(siteId)
        if (!site) return c.json(notFound('Сайт не найден'), 404)
        return c.json({
          site: { id: site.id, name: site.name, theme: site.theme },
          pages: await repo.publishedPages(siteId),
        })
      })

      .get('/:siteId/pages/:slug', validate('param', PageParams), async (c) => {
        const { siteId, slug } = c.req.valid('param')
        const page = await repo.findPage(siteId, slug)
        if (!page) return c.json(notFound('Страница не найдена'), 404)
        return c.json(page)
      })

      .put(
        '/:siteId/pages/:slug',
        validate('param', PageParams),
        validate('json', SaveDraft),
        async (c) => {
          const { siteId, slug } = c.req.valid('param')
          const { title, content } = c.req.valid('json')
          if (!(await repo.find(siteId))) return c.json(notFound('Сайт не найден'), 404)
          return c.json(await repo.saveDraft(siteId, slug, title, content))
        },
      )

      .post('/:siteId/pages/:slug/publish', validate('param', PageParams), async (c) => {
        const { siteId, slug } = c.req.valid('param')
        const page = await repo.publish(siteId, slug)
        if (!page) return c.json(notFound('Страница не найдена'), 404)
        return c.json(page)
      })
  )
}
