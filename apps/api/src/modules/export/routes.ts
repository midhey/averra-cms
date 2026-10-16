import { Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, forbidden, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import type { MediaStorage } from '../../media/storage'
import { validate } from '../../validate'
import { siteDataEntries, siteMediaBytes } from './site-data'
import { ZIP_MAX_BYTES, type ZipEntry, zipStream } from './zip'

/** Файл текущей версии сайта на сервере: путь внутри версии и чтение по кускам */
export type SiteFile = {
  path: string
  size: number
  mtime: Date
  read(): AsyncIterable<Uint8Array>
}

/**
 * Опубликованный сайт на диске сервера (PUBLISH_DIR/<сайт>/current) — то, что отдаёт Caddy.
 * Реализация — src/publish/published-site.ts, подключают index.ts и testing.ts
 */
export type PublishedSite = {
  /** Файлы текущей версии; undefined — сайт ещё ни разу не собран */
  current(siteId: string): Promise<{ release: string; files: SiteFile[] } | undefined>
}

export type ExportDeps = {
  db: Db
  storage: MediaStorage
  version: string
  /** Нет — публикация на сервере выключена (PUBLISH_DIR не задан) */
  published?: PublishedSite
}

const SiteParams = z.object({ siteId: Uuid() })

const tooLarge = () => ({
  error: {
    code: 'export_too_large',
    message:
      'Выгрузка больше 3,5 ГБ — такой архив ZIP не соберётся. Возьмите бэкап установки (averra.sh backup)',
  },
})

/** Имя файла: латиница и цифры, без названия сайта (кавычки и кириллица в заголовке ломаются) */
function fileName(siteId: string, kind: 'site' | 'data', now: Date) {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '')
  return `averra-${siteId.slice(0, 8)}-${kind}-${day}.zip`
}

function zipResponse(entries: AsyncIterable<ZipEntry>, name: string) {
  return new Response(zipStream(entries), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/**
 * «Клиент не заложник» (принцип 8): сайт статическим архивом — то, что отдаёт Caddy, его
 * откроет любой веб-сервер, — и все данные сайта (JSON и оригиналы картинок). Оба — ZIP потоком
 */
export function exportRoutes({ db, storage, version, published }: ExportDeps) {
  return new Hono<AuthEnv>()
    .get('/static', validate('param', SiteParams), requireSite(db, 'site.read'), async (c) => {
      // Содержимое и так публичное, но программе с токеном (MCP) архив сайта не нужен
      if (c.var.actor.kind === 'token') {
        return c.json(forbidden('Выгрузка сайта — из админки, не токеном API'), 403)
      }
      const { siteId } = c.req.valid('param')
      if (!published) {
        return c.json(
          {
            error: {
              code: 'publish_disabled',
              message:
                'Сайт не собирается на этом сервере (не задан PUBLISH_DIR): выгружать нечего. ' +
                'Данные сайта выгружаются «Выгрузить все данные»',
            },
          },
          409,
        )
      }
      const current = await published.current(siteId)
      if (!current) {
        return c.json(
          {
            error: {
              code: 'not_built',
              message: 'Сайт ещё не собран: опубликуйте страницу и дождитесь сборки',
            },
          },
          409,
        )
      }
      const total = current.files.reduce((sum, file) => sum + file.size, 0)
      if (total > ZIP_MAX_BYTES) return c.json(tooLarge(), 413)
      async function* entries(): AsyncGenerator<ZipEntry> {
        for (const file of current?.files ?? []) {
          // Текст (HTML, CSS, JS, XML) сжимается хорошо, картинки и шрифты — уже сжаты
          const compress = /\.(html|css|js|mjs|json|xml|txt|svg|webmanifest)$/i.test(file.path)
          yield { name: file.path, compress, data: file.read(), mtime: file.mtime }
        }
      }
      return zipResponse(entries(), fileName(siteId, 'site', new Date()))
    })

    .get('/data', validate('param', SiteParams), requireSite(db, 'site.export'), async (c) => {
      const { siteId } = c.req.valid('param')
      if ((await siteMediaBytes(db, siteId)) > ZIP_MAX_BYTES) return c.json(tooLarge(), 413)
      const now = new Date()
      return zipResponse(
        siteDataEntries({ db, storage, siteId, version, now }),
        fileName(siteId, 'data', now),
      )
    })
}
