import { cookieNoticeShown, Footer, footerContacts, MAIN_PAGE_SLUG, Uuid } from '@averra/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { pages } from '../../db/schema'
import { conflict } from '../../errors'
import { errorForLog } from '../../log-error'
import type { SitePublisher } from '../../publish/queue'
import { validate } from '../../validate'
import { readStoredSettings } from '../settings/read'
import { sitesRepo } from '../sites/repo'
import { footerRepo, policyOf } from './repo'

const SiteParams = z.object({ siteId: Uuid() })

type FooterDeps = {
  db: Db
  /** Сборка сайта на сервере после публикации подвала. Нет — публикация только меняет базу */
  publisher?: SitePublisher
  log: (message: string) => void
}

/**
 * Подвал сайта (вкладка «Подвал» экрана «Шапка и подвал»): монтируется на
 * /sites/:siteId/footer. Черновик и публикация, как у шапки. Читать может любой участник и токен
 * (подвал и так виден на сайте), менять — владелец и редактор (то же право header.edit: шапка и
 * подвал — один раздел); токену API — нет
 */
export function footerRoutes({ db, publisher, log }: FooterDeps) {
  const repo = footerRepo(db)
  const site = (permission: Parameters<typeof requireSite>[1]) => requireSite(db, permission)
  const rebuild = async (siteId: string) => {
    try {
      await publisher?.request(siteId)
    } catch (error) {
      log(`Сайт ${siteId}: не удалось поставить сборку в очередь — ${String(errorForLog(error))}`)
    }
  }

  return (
    new Hono<AuthEnv>()
      // Черновик, подвал на сайте, страница политики, есть ли «Настройки cookie» и контакты
      // «Организации» — для предпросмотра.
      // Контакты — только людям и только когда главная опубликована: как у шапки, редактор не
      // узнает здесь больше, чем видно на сайте; телефон и почта ИП — персональные данные
      .get('/', validate('param', SiteParams), site('site.read'), async (c) => {
        const { siteId } = c.req.valid('param')
        const state = await repo.read(siteId)
        const found = state && (await sitesRepo(db).find(siteId))
        const policy = found && (await policyOf(db, siteId))
        if (!state || !found || !policy) return c.json(notFound('Сайт не найден'), 404)
        const [main] = await db
          .select({ id: pages.id })
          .from(pages)
          .where(
            and(
              eq(pages.siteId, siteId),
              eq(pages.slug, MAIN_PAGE_SLUG),
              isNotNull(pages.published),
            ),
          )
        const settings = readStoredSettings(found.settings)
        const contacts =
          c.var.actor.kind === 'user' && main ? footerContacts(settings.organization) : null
        // «Настройки cookie» в подвале — как на сайте: только в режиме согласия и при счётчиках
        const cookieSettings =
          cookieNoticeShown(settings.analytics) && settings.cookies.mode === 'consent'
        return c.json({ ...state, policy, cookieSettings, contacts }, 200)
      })

      // Черновик: только схема — подвал ни на что, кроме «Организации» и меню шапки, не ссылается
      .put(
        '/',
        validate('param', SiteParams),
        site('header.edit'),
        validate('json', Footer),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const state = await repo.saveDraft(siteId, c.req.valid('json'))
          if (!state) return c.json(notFound('Сайт не найден'), 404)
          return c.json(state, 200)
        },
      )

      // Публикация: большому подвалу нужна опубликованная политика — в нём форма с телефоном
      .post('/publish', validate('param', SiteParams), site('header.edit'), async (c) => {
        const { siteId } = c.req.valid('param')
        const result = await repo.publish(siteId)
        if (!result) return c.json(notFound('Сайт не найден'), 404)
        if (result.problem) {
          const first = result.problem[0]?.message ?? ''
          return c.json(conflict(`Подвал не опубликовать: ${first}`, result.problem), 409)
        }
        await rebuild(siteId)
        return c.json(result.state, 200)
      })

      // Убрать подвал с сайта: внизу страниц снова прежняя полоса с документами, настройки
      // остаются черновиком. Сайт пересобирается, если подвал на нём был
      .delete('/', validate('param', SiteParams), site('header.edit'), async (c) => {
        const { siteId } = c.req.valid('param')
        const result = await repo.unpublish(siteId)
        if (!result) return c.json(notFound('Сайт не найден'), 404)
        if (result.wasOnSite) await rebuild(siteId)
        return c.json(result.state, 200)
      })
  )
}
