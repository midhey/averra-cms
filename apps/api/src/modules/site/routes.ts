import { findRedirect, redirectLocation } from '@averra/schema'
import { Hono } from 'hono'
import { siteRoleOf } from '../../auth/access'
import { type AuthEnv, forbidden, notFound } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { messagePage, PAGE_HEADERS } from '../leads/pages'
import { readStoredSettings } from '../settings/read'
import { sitesRepo } from '../sites/repo'
import { siteSnapshot } from '../sites/snapshot'

/** 403 участнику, у которого доступ только к другому сайту базы (старые базы разработки) */
export const NO_INSTALLATION_SITE_ACCESS =
  'Нет доступа к сайту этой установки: попросите владельца пригласить вас'

// Одна установка — один сайт. Здесь — «сайт, с которым работает пришедший», без id в адресе:
// админка и рендерер узнают по нему id и дальше ходят в /api/sites/:siteId/… как раньше.
// Сайт установки выбирает правило sitesRepo.installationSite (созданный первым)
/** Путь, под которым Caddy домена сайта передаёт сюда адрес, где файла нет (deploy/Caddyfile) */
export const FALLBACK_PREFIX = '/api/site/fallback'

type SiteRoutesDeps = {
  db: Db
  siteUrl: string | undefined
  /**
   * Страница 404 текущей версии сайта на сервере (PUBLISH_DIR/main/current/404.html). Нет
   * (разработка, сайт ещё не собран) — короткая страница «Страница не найдена» от API
   */
  notFoundPage?: () => Promise<string | undefined>
}

export function siteRoutes({ db, siteUrl, notFoundPage }: SiteRoutesDeps) {
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
        const snapshot = site ? await siteSnapshot(db, site.id, siteUrl) : undefined
        if (!snapshot) return c.json(notFound('В установке ещё нет сайта'), 404)
        return c.json(snapshot)
      })

      // Адрес на домене сайта, где нет файла: Caddy отдаёт его сюда (handle_errors 404 в
      // deploy/Caddyfile). Редирект из таблицы раздела «SEO» — 301, иначе — 404 со страницей 404
      // текущей версии сайта. Страница главнее редиректа: про существующие файлы Caddy не
      // спрашивает. Открыт без входа (auth/middleware.ts): это посетитель сайта
      .get('/fallback/*', async (c) => {
        const path = c.req.path.slice(FALLBACK_PREFIX.length) || '/'
        const site = await repo.installationSite()
        const to = site && findRedirect(readStoredSettings(site.settings).redirects, path)
        if (to) {
          // Без кеша: таблицу могут поправить, а браузер запоминает 301 надолго. Строка запроса
          // (utm-метки) — та, с которой пришёл посетитель: Caddy при rewrite её сохраняет
          c.header('cache-control', 'no-cache')
          return c.redirect(redirectLocation(to, new URL(c.req.url).search), 301)
        }
        const page = await notFoundPage?.()
        if (page !== undefined) {
          return c.html(page, 404, { 'cache-control': 'no-cache' })
        }
        return c.html(
          messagePage({
            title: 'Страница не найдена',
            message: 'По этому адресу ничего нет. Проверьте адрес или откройте главную страницу.',
            back: '/',
            backLabel: 'На главную',
          }),
          404,
          PAGE_HEADERS,
        )
      })
  )
}
