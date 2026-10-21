import { Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { ICON_FILES, type IconRenderer, iconMimeType } from '../../media/favicon'
import { type MediaStorage, mediaKey } from '../../media/storage'
import { validate } from '../../validate'
import { mediaRepo } from '../media/repo'
import { sitesRepo } from '../sites/repo'
import { readStoredSettings } from './read'

const IconParams = z.object({ siteId: Uuid(), file: z.enum(ICON_FILES) })

/**
 * Набор иконок сайта из картинки, выбранной в «SEO» (настройка icon): /sites/:siteId/icons/:file.
 * Открыт без входа (auth/middleware.ts), как снимок сайта: его берёт рендерер — в dev отдаёт
 * вживую, при сборке кладёт файлы в корень релиза. Иконки нет — 404. Кеш браузера — с проверкой:
 * иконку могут заменить, а адрес у неё тот же
 */
export function iconsRoutes({
  db,
  storage,
  icons,
}: {
  db: Db
  storage: MediaStorage
  icons: IconRenderer
}) {
  const sites = sitesRepo(db)
  const media = mediaRepo(db)

  return new Hono<AuthEnv>().get('/:file', validate('param', IconParams), async (c) => {
    const { siteId, file } = c.req.valid('param')
    const site = await sites.find(siteId)
    const mediaId = site && readStoredSettings(site.settings).icon
    const files = mediaId ? await media.findFiles(mediaId) : undefined
    if (!site || !files || files.siteId !== site.id) {
      return c.json(notFound('У сайта нет иконки'), 404)
    }
    const data = await icons(
      { mediaId: files.id, file, background: site.theme.colors.background },
      () => storage.get(mediaKey(files.siteId, files.id, files.originalFile)),
    )
    return c.body(data as Uint8Array<ArrayBuffer>, 200, {
      'content-type': iconMimeType(file),
      'content-length': String(data.byteLength),
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    })
  })
}
