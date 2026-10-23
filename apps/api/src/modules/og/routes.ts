import { ExistingPageSlug, ogCardOf, PageTitle, Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { type OgCardRenderers, OgCardsBusy } from '../../og/card'
import { validate } from '../../validate'
import { readStoredSettings } from '../settings/read'
import { effectiveSiteUrl } from '../settings/repo'
import { sitesRepo } from '../sites/repo'
import { publishedTheme } from '../theme/read'

const SiteParams = z.object({ siteId: Uuid() })
const CardParams = SiteParams.extend({ slug: ExistingPageSlug })
const PreviewQuery = z.object({ title: PageTitle })

const busy = {
  error: {
    code: 'rate_limited',
    message: 'Карточек для предпросмотра рисуется слишком много. Подождите немного и обновите',
  },
}

const pngHeaders = (data: Uint8Array, cacheControl: string) => ({
  'content-type': 'image/png',
  'content-length': String(data.byteLength),
  'cache-control': cacheControl,
  'x-content-type-options': 'nosniff',
})

/**
 * Карточка для соцсетей из заголовка страницы (src/og): её ставят страницам без своей картинки и
 * без картинки сайта.
 *
 * /og/:slug — открыт без входа (auth/middleware.ts), как снимок и иконки: его берёт сборка сайта и
 * кладёт в релиз файлом /og/<адрес>.png. Только опубликованная страница и по опубликованному
 * заголовку — черновики наружу не видны. /og-card?title=… — для админки: карточка заголовка,
 * который ещё правят, тем, кто видит сайт
 */
export function ogRoutes({
  db,
  siteUrl,
  cards,
}: {
  db: Db
  siteUrl: string | undefined
  cards: OgCardRenderers
}) {
  const repo = sitesRepo(db)

  async function cardOf(siteId: string, title: string) {
    const site = await repo.find(siteId)
    if (!site) return undefined
    const settings = readStoredSettings(site.settings)
    return ogCardOf({
      title,
      siteName: site.name,
      siteUrl: effectiveSiteUrl(settings, siteUrl),
      theme: publishedTheme(site),
    })
  }

  return new Hono<AuthEnv>()
    .get('/og/:slug', validate('param', CardParams), async (c) => {
      const { siteId, slug } = c.req.valid('param')
      const page = await repo.findPage(siteId, slug)
      const card =
        page && page.publishedTitle !== null ? await cardOf(siteId, page.publishedTitle) : undefined
      if (!card) return c.json(notFound('Страница не опубликована'), 404)
      // Без долгого кеша: заголовок могут поправить, а адрес у карточки тот же
      const data = await cards.published(card)
      return c.body(data as Uint8Array<ArrayBuffer>, 200, pngHeaders(data, 'no-cache'))
    })
    .get(
      '/og-card',
      validate('param', SiteParams),
      requireSite(db, 'site.read'),
      validate('query', PreviewQuery),
      async (c) => {
        const card = await cardOf(c.req.valid('param').siteId, c.req.valid('query').title)
        if (!card) return c.json(notFound('Сайт не найден'), 404)
        const data = await cards.preview(card).catch((error: unknown) => {
          if (error instanceof OgCardsBusy) return undefined
          throw error
        })
        // Очередь полна: заголовки шлют потоком. Админка просит карточку, когда набор затих,
        // поэтому живому редактору этот отказ не попадается
        if (!data) return c.json(busy, 429)
        return c.body(
          data as Uint8Array<ArrayBuffer>,
          200,
          pngHeaders(data, 'private, max-age=300'),
        )
      },
    )
}
