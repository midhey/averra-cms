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
import { can } from '../../auth/access'
import { type AuthEnv, notFound, requireOwner, requireSite } from '../../auth/middleware'
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

// 409 — запрос правильный, но спорит с тем, что уже лежит в базе. issues с путём до поля,
// как у ошибок проверки: админка покажет сообщение прямо у поля, которое надо поправить
const conflict = (message: string, issues: Issue[] = []) => ({
  error: { code: 'conflict', message, issues },
})

// Вход проверил authenticate в app.ts. Здесь каждый маршрут сайта объявляет действие
// через requireSite: он же отвечает 404 на чужой или несуществующий сайт
export function sitesRoutes({ db }: { db: Db }) {
  const repo = sitesRepo(db)
  const site = (permission: Parameters<typeof requireSite>[1]) => requireSite(db, permission)

  return (
    new Hono<AuthEnv>()
      .get('/', async (c) => c.json(await repo.list(c.var.actor)))

      .post(
        '/',
        requireOwner('Создавать сайты может только владелец'),
        validate('json', NewSite),
        async (c) => {
          const { name } = c.req.valid('json')
          return c.json(await repo.createSite(name, defaultTheme), 201)
        },
      )

      // Роль на сайте (access) нужна админке, чтобы не показывать то, что этой роли нельзя
      .get('/:siteId', validate('param', SiteParams), site('site.read'), async (c) => {
        const { siteId } = c.req.valid('param')
        const found = await repo.find(siteId)
        if (!found) return c.json(notFound('Сайт не найден'), 404)
        return c.json({
          id: found.id,
          name: found.name,
          theme: found.theme,
          access: c.var.siteRole,
        })
      })

      // Всё, что нужно рендереру для сборки: тема и опубликованные страницы. Открыт без входа
      // (список открытых маршрутов — в auth/middleware.ts): опубликованное и так публично
      .get('/:siteId/snapshot', validate('param', SiteParams), async (c) => {
        const { siteId } = c.req.valid('param')
        const found = await repo.find(siteId)
        if (!found) return c.json(notFound('Сайт не найден'), 404)
        return c.json({
          site: { id: found.id, name: found.name, theme: found.theme },
          pages: await repo.publishedPages(siteId),
        })
      })

      .get('/:siteId/pages', validate('param', SiteParams), site('site.read'), async (c) => {
        const { siteId } = c.req.valid('param')
        return c.json(await repo.listPages(siteId))
      })

      .post(
        '/:siteId/pages',
        validate('param', SiteParams),
        site('page.create'),
        validate('json', NewPage),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const { slug, title, template } = c.req.valid('json')
          const page = await repo.createPage(siteId, slug, title, pageTemplateContent(template))
          if (!page) {
            const issues = [{ path: 'slug', message: 'Такой адрес уже есть' }]
            return c.json(conflict(`Страница с адресом «${slug}» уже есть`, issues), 409)
          }
          return c.json(page, 201)
        },
      )

      .get('/:siteId/pages/:slug', validate('param', PageParams), site('site.read'), async (c) => {
        const { siteId, slug } = c.req.valid('param')
        const page = await repo.findPage(siteId, slug)
        if (!page) return c.json(notFound('Страница не найдена'), 404)
        return c.json(page)
      })

      // Сохранение создаёт страницу, если её нет (так работает save_draft в MCP), — но только
      // для тех, кому можно создавать страницы. Клиент правит лишь существующие
      .put(
        '/:siteId/pages/:slug',
        validate('param', PageParams),
        site('page.edit'),
        validate('json', SaveDraft),
        async (c) => {
          const { siteId, slug } = c.req.valid('param')
          const { title, content } = c.req.valid('json')
          if (can(c.var.siteRole, 'page.create')) {
            return c.json(await repo.saveDraft(siteId, slug, title, content), 200)
          }
          const page = await repo.updateDraft(siteId, slug, title, content)
          if (!page) return c.json(notFound('Страница не найдена'), 404)
          return c.json(page, 200)
        },
      )

      .delete(
        '/:siteId/pages/:slug',
        validate('param', PageParams),
        site('page.delete'),
        async (c) => {
          const { siteId, slug } = c.req.valid('param')
          if (slug === MAIN_PAGE_SLUG) {
            return c.json(conflict('Главную страницу удалить нельзя'), 409)
          }
          if (!(await repo.deletePage(siteId, slug))) {
            return c.json(notFound('Страница не найдена'), 404)
          }
          return c.body(null, 204)
        },
      )

      .post(
        '/:siteId/pages/:slug/publish',
        validate('param', PageParams),
        site('page.publish'),
        async (c) => {
          const { siteId, slug } = c.req.valid('param')
          const page = await repo.publish(siteId, slug)
          if (!page) return c.json(notFound('Страница не найдена'), 404)
          return c.json(page)
        },
      )
  )
}
