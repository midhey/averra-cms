import {
  ExistingPageSlug,
  headerPageUses,
  MAIN_PAGE_SLUG,
  NewPage,
  PageContent,
  PageSlug,
  PageTitle,
  pageTemplateContent,
  type SiteSeo,
  Uuid,
} from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { can } from '../../auth/access'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict } from '../../errors'
import { errorForLog } from '../../log-error'
import type { SitePublisher } from '../../publish/queue'
import { validate, validationError } from '../../validate'
import { headerRepo } from '../header/repo'
import { leadsRepo } from '../leads/repo'
import { missingMediaIssues } from '../media/refs'
import { mediaRepo } from '../media/repo'
import { readStoredSettings } from '../settings/read'
import { effectiveSiteUrl } from '../settings/repo'
import { publishedTheme } from '../theme/read'
import { sitesRepo } from './repo'
import { siteSnapshot } from './snapshot'

const SiteParams = z.object({ siteId: Uuid() })

// Адрес по мягкой схеме: страницы со старыми адресами тоже можно открыть, сохранить и удалить.
// Новую страницу создают только по PageSlug (POST и PUT на свободный адрес)
const PageParams = SiteParams.extend({ slug: ExistingPageSlug })

const SaveDraft = z.strictObject({
  title: PageTitle,
  content: PageContent,
})

// Вход проверил authenticate в app.ts. Здесь каждый маршрут сайта объявляет действие
// через requireSite: он же отвечает 404 на чужой или несуществующий сайт
export function sitesRoutes({
  db,
  publisher,
  log,
  siteUrl,
}: {
  db: Db
  /** Адрес установки (SITE_URL): адрес сайта в снимке, если своего в настройках SEO нет */
  siteUrl: string | undefined
  /** Сборка сайта на сервере после публикации. Нет — публикация только меняет базу */
  publisher?: SitePublisher
  log: (message: string) => void
}) {
  const repo = sitesRepo(db)
  // Сайт на сервере пересобирается после того, как опубликованное в базе уже поменялось. Сбой
  // постановки в очередь не отменяет публикацию: она случилась, а «Собрать заново» на экране
  // сайта поставит сборку ещё раз
  const rebuild = async (siteId: string) => {
    try {
      await publisher?.request(siteId)
    } catch (error) {
      log(`Сайт ${siteId}: не удалось поставить сборку в очередь — ${String(errorForLog(error))}`)
    }
  }
  const media = mediaRepo(db)
  const leads = leadsRepo(db)
  const site = (permission: Parameters<typeof requireSite>[1]) => requireSite(db, permission)

  return (
    new Hono<AuthEnv>()
      // Список сайтов пришедшего — для совместимости (MCP list_sites). В установке сайт один:
      // админка берёт его из GET /api/site. Создания сайтов в API нет: сайт установки создаёт
      // API при первом запуске (modules/site)
      .get('/', async (c) => c.json(await repo.list(c.var.actor)))

      // Роль на сайте (access) нужна админке, чтобы не показывать то, что этой роли нельзя.
      // newLeads — сколько новых заявок (счётчик в навигации сайта); null — заявки этой роли
      // не видны (редактор, токен API). hiddenFromSearch — сайт скрыт от поисковиков (раздел
      // «SEO»): обзор напоминает об этом до запуска. seo — шаблон заголовка, описание, картинка и
      // адрес сайта для панели «SEO» страницы в редакторе
      .get('/:siteId', validate('param', SiteParams), site('site.read'), async (c) => {
        const { siteId } = c.req.valid('param')
        const found = await repo.find(siteId)
        if (!found) return c.json(notFound('Сайт не найден'), 404)
        const seesLeads = c.var.actor.kind === 'user' && can(c.var.siteRole, 'leads.read')
        const settings = readStoredSettings(found.settings)
        // Что редактору страницы нужно от SEO сайта: сниппет, карточка и проверки в панели «SEO»
        // страницы. Всё это и так видно на опубликованных страницах; настройки целиком — владельцу
        const org = settings.organization
        const seo: SiteSeo = {
          titleTemplate: settings.titleTemplate,
          description: settings.description,
          ogImage: settings.ogImage,
          url: effectiveSiteUrl(settings, siteUrl),
          hideFromSearch: settings.hideFromSearch,
          // Сверка «Контактов» с организацией — людям, всем ролям: редактор правит «Контакты» и
          // должен видеть, с чем их сверяют. Это шире прав на «SEO» (`site.settings` — владельцу),
          // но данные предназначены для публикации. Телефон и почта ИП — персональные данные:
          // токену API их не отдаём, даже если они и так в разметке на главной
          ...(c.var.actor.kind === 'user'
            ? {
                organization: {
                  name: org.name,
                  phone: org.phone,
                  email: org.email,
                  street: org.address.street,
                },
              }
            : {}),
        }
        return c.json({
          id: found.id,
          name: found.name,
          theme: publishedTheme(found),
          access: c.var.siteRole,
          hiddenFromSearch: settings.hideFromSearch,
          seo,
          newLeads: seesLeads ? await leads.countNew(siteId) : null,
        })
      })

      // Снимок для рендерера (sites/snapshot.ts). Открыт без входа (auth/middleware.ts)
      .get('/:siteId/snapshot', validate('param', SiteParams), async (c) => {
        const snapshot = await siteSnapshot(db, c.req.valid('param').siteId, siteUrl)
        if (!snapshot) return c.json(notFound('Сайт не найден'), 404)
        return c.json(snapshot)
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
          // Картинка — ссылка в медиатеку этого сайта: на чужую или удалённую сослаться нельзя, SVG
          // в блоки не ставится
          const missing = await missingMediaIssues(media, siteId, content)
          if (missing.length > 0) {
            return c.json(
              conflict('Не все картинки на странице подходят: причина — у каждого поля', missing),
              409,
            )
          }
          const newSlug = PageSlug.safeParse(slug)
          if (can(c.var.siteRole, 'page.create') && newSlug.success) {
            return c.json(await repo.saveDraft(siteId, slug, title, content), 200)
          }
          const page = await repo.updateDraft(siteId, slug, title, content)
          if (page) return c.json(page, 200)
          // Старый адрес годится только для страницы, которая уже есть: новую с ним не создаём
          if (!newSlug.success && can(c.var.siteRole, 'page.create')) {
            const message = newSlug.error.issues[0]?.message ?? 'Неверный адрес'
            return c.json(validationError([{ path: 'slug', message }]), 400)
          }
          return c.json(notFound('Страница не найдена'), 404)
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
          // Страница в шапке (на сайте или в черновике) — как логотип в медиатеке: иначе пункт
          // меню молча пропал бы с сайта при следующей сборке
          const header = await headerRepo(db).read(siteId)
          const uses = [
            ...new Set(
              [header?.published, header?.draft].flatMap((item) =>
                item ? headerPageUses(item, slug) : [],
              ),
            ),
          ]
          if (uses.length > 0) {
            const message = `Страница в шапке сайта: ${uses.join(', ')}. Уберите её оттуда в разделе «Шапка и подвал» и опубликуйте шапку, тогда страницу можно будет удалить`
            return c.json(
              conflict(
                message,
                uses.map((use) => ({ path: 'header', message: use })),
              ),
              409,
            )
          }
          const deleted = await repo.deletePage(siteId, slug)
          if (!deleted) return c.json(notFound('Страница не найдена'), 404)
          // Страница была на сайте — сайт на сервере собирается заново, уже без неё
          if (deleted.wasPublished) await rebuild(siteId)
          return c.body(null, 204)
        },
      )

      .post(
        '/:siteId/pages/:slug/publish',
        validate('param', PageParams),
        site('page.publish'),
        async (c) => {
          const { siteId, slug } = c.req.valid('param')
          const page = await repo.publish(siteId, slug, c.var.actor)
          if (!page) return c.json(notFound('Страница не найдена'), 404)
          await rebuild(siteId)
          return c.json(page)
        },
      )
  )
}
