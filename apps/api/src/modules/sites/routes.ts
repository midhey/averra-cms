import {
  MAIN_PAGE_SLUG,
  NewPage,
  NewSite,
  PageContent,
  PageSlug,
  PageTitle,
  pageTemplateContent,
} from '@cms/schema'
import { defaultTheme } from '@cms/tokens'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { validate } from '../../validate'
import { sitesRepo } from './repo'

const SiteParams = z.object({ siteId: z.uuid() })

const PageParams = SiteParams.extend({ slug: PageSlug })

const SaveDraft = z.strictObject({
  title: PageTitle,
  content: PageContent,
})

type Issue = { path: string; message: string }

const notFound = (message: string) => ({ error: { code: 'not_found', message } })

// 409 — запрос правильный, но спорит с тем, что уже лежит в базе. issues с путём до поля,
// как у ошибок проверки: админка покажет сообщение прямо у поля, которое надо поправить
const conflict = (message: string, issues: Issue[] = []) => ({
  error: { code: 'conflict', message, issues },
})

export function sitesRoutes({ db }: { db: Db }) {
  const repo = sitesRepo(db)

  return (
    new Hono()
      .get('/', async (c) => c.json(await repo.list()))

      .post('/', validate('json', NewSite), async (c) => {
        const { name } = c.req.valid('json')
        return c.json(await repo.createSite(name, defaultTheme), 201)
      })

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

      .get('/:siteId/pages', validate('param', SiteParams), async (c) => {
        const { siteId } = c.req.valid('param')
        if (!(await repo.find(siteId))) return c.json(notFound('Сайт не найден'), 404)
        return c.json(await repo.listPages(siteId))
      })

      .post(
        '/:siteId/pages',
        validate('param', SiteParams),
        validate('json', NewPage),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const { slug, title, template } = c.req.valid('json')
          if (!(await repo.find(siteId))) return c.json(notFound('Сайт не найден'), 404)
          const page = await repo.createPage(siteId, slug, title, pageTemplateContent(template))
          if (!page) {
            const issues = [{ path: 'slug', message: 'Такой адрес уже есть' }]
            return c.json(conflict(`Страница с адресом «${slug}» уже есть`, issues), 409)
          }
          return c.json(page, 201)
        },
      )

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

      .delete('/:siteId/pages/:slug', validate('param', PageParams), async (c) => {
        const { siteId, slug } = c.req.valid('param')
        if (!(await repo.find(siteId))) return c.json(notFound('Сайт не найден'), 404)
        if (slug === MAIN_PAGE_SLUG) return c.json(conflict('Главную страницу удалить нельзя'), 409)
        if (!(await repo.deletePage(siteId, slug))) {
          return c.json(notFound('Страница не найдена'), 404)
        }
        return c.body(null, 204)
      })

      .post('/:siteId/pages/:slug/publish', validate('param', PageParams), async (c) => {
        const { siteId, slug } = c.req.valid('param')
        const page = await repo.publish(siteId, slug)
        if (!page) return c.json(notFound('Страница не найдена'), 404)
        return c.json(page)
      })
  )
}
