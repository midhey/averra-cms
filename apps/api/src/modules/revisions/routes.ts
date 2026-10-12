import { PageContent, PageSlug, PageTitle, Uuid } from '@cms/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict } from '../../errors'
import { validate } from '../../validate'
import { missingMediaIssues } from '../media/refs'
import { mediaRepo } from '../media/repo'
import { sitesRepo } from '../sites/repo'
import { revisionsRepo } from './repo'

const PageParams = z.object({ siteId: Uuid(), slug: PageSlug })
const RevisionParams = PageParams.extend({ revisionId: Uuid() })

/**
 * История публикаций страницы. Монтируется на /sites/:siteId/pages/:slug/revisions.
 * Права — те же, что у страницы: смотреть — чтение сайта, возвращать — правка черновика
 * (её может и клиент: возврат меняет только черновик, а публикует всё равно редактор)
 */
export function revisionsRoutes({ db }: { db: Db }) {
  const revisions = revisionsRepo(db)
  const sites = sitesRepo(db)
  const media = mediaRepo(db)

  /** Версии нет: если нет и страницы, говорим об этом — так понятнее, что искать */
  const missing = async (siteId: string, slug: string) =>
    notFound((await sites.findPage(siteId, slug)) ? 'Версия не найдена' : 'Страница не найдена')

  return new Hono<AuthEnv>()
    .get('/', validate('param', PageParams), requireSite(db, 'site.read'), async (c) => {
      const { siteId, slug } = c.req.valid('param')
      if (!(await sites.findPage(siteId, slug))) {
        return c.json(notFound('Страница не найдена'), 404)
      }
      return c.json(await revisions.list(siteId, slug), 200)
    })

    .get(
      '/:revisionId',
      validate('param', RevisionParams),
      requireSite(db, 'site.read'),
      async (c) => {
        const { siteId, slug, revisionId } = c.req.valid('param')
        const revision = await revisions.find(siteId, slug, revisionId)
        if (!revision) return c.json(await missing(siteId, slug), 404)
        return c.json(revision, 200)
      },
    )

    .post(
      '/:revisionId/restore',
      validate('param', RevisionParams),
      requireSite(db, 'page.edit'),
      async (c) => {
        const { siteId, slug, revisionId } = c.req.valid('param')
        const revision = await revisions.find(siteId, slug, revisionId)
        if (!revision) return c.json(await missing(siteId, slug), 404)

        // Снимок в базе не меняется, а схемы блоков в коде — да. Черновик, который API сам
        // не дал бы сохранить, через возврат тоже не пускаем. Схема заодно подставит
        // значения по умолчанию у полей, появившихся после публикации
        const title = PageTitle.safeParse(revision.title)
        const content = PageContent.safeParse(revision.content)
        if (!title.success || !content.success) {
          const issues = [
            ...(title.error?.issues ?? []).map((issue) => ({ ...issue, path: ['title'] })),
            ...(content.error?.issues ?? []).map((issue) => ({
              ...issue,
              path: ['content', ...issue.path],
            })),
          ].map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
          const message = `Версия ${revision.version} не подходит под нынешние схемы блоков, вернуть её в черновик нельзя`
          return c.json(conflict(message, issues), 409)
        }

        // Картинку из версии могли удалить из медиатеки: такой черновик API не дал бы сохранить
        const lostMedia = await missingMediaIssues(media, siteId, content.data)
        if (lostMedia.length > 0) {
          const message = `В версии ${revision.version} есть картинки, которых уже нет в медиатеке, вернуть её в черновик нельзя`
          return c.json(conflict(message, lostMedia), 409)
        }

        const page = await sites.updateDraft(siteId, slug, title.data, content.data)
        if (!page) return c.json(notFound('Страница не найдена'), 404)
        return c.json(page, 200)
      },
    )
}
