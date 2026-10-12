import {
  fileSizeLimitHint,
  fileTooLargeMessage,
  imageMimeTypes,
  MAIN_PAGE_SLUG,
  Uuid,
} from '@cms/schema'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import type { StoredVariant } from '../../db/schema'
import { conflict } from '../../errors'
import {
  type ImageProcessor,
  MAX_PIXELS,
  type ProcessedImage,
  type ProcessFailure,
} from '../../media/processor'
import { type MediaStorage, mediaKey } from '../../media/storage'
import { validate } from '../../validate'
import { type MediaUsage, mediaRepo } from './repo'

export type MediaDeps = {
  db: Db
  storage: MediaStorage
  images: ImageProcessor
  /** Самый большой файл в байтах (MEDIA_MAX_BYTES) */
  maxBytes: number
  log: (message: string) => void
}

// Uuid приводит id к строчным: из них строятся ключи файлов и ищутся ссылки в JSON страниц
const SiteParams = z.object({ siteId: Uuid() })
const MediaParams = SiteParams.extend({ mediaId: Uuid() })
const FileParams = z.object({ mediaId: Uuid(), file: z.string() })

const Upload = z.object({ file: z.file('Выберите файл картинки') })

// Заголовки частей multipart и граница: тело запроса чуть больше самого файла
const MULTIPART_OVERHEAD = 64 * 1024

const tooLarge = (maxBytes: number) => ({
  error: {
    code: 'payload_too_large',
    message: fileTooLargeMessage(maxBytes),
    issues: [{ path: 'file', message: fileSizeLimitHint(maxBytes) }],
  },
})

const rejected: Record<ProcessFailure, { status: 413 | 415; code: string; message: string }> = {
  unsupported: {
    status: 415,
    code: 'unsupported_media_type',
    message: 'Можно загрузить JPEG, PNG, WebP или AVIF. SVG, GIF и другие форматы не принимаются',
  },
  broken: {
    status: 415,
    code: 'unsupported_media_type',
    message: 'Файл повреждён: картинку не удалось прочитать',
  },
  too_many_pixels: {
    status: 413,
    code: 'payload_too_large',
    message: `Картинка слишком большая: не больше ${MAX_PIXELS / 1_000_000} мегапикселей`,
  },
}

/** Имя файла только для показа в админке: без управляющих символов и не длиннее 200 */
function displayName(name: string) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: вырезаем именно управляющие символы
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return clean.slice(0, 200) || 'картинка'
}

const pagePath = (slug: string) => (slug === MAIN_PAGE_SLUG ? '/' : `/${slug}`)

const usageWhere = ({ draft, published }: MediaUsage) =>
  draft && published ? 'черновик и сайт' : draft ? 'черновик' : 'сайт'

/**
 * Медиатека сайта: монтируется на /sites/:siteId/media. Права — как у страниц: смотреть —
 * чтение сайта, загружать может и клиент, удалять — владелец и редактор
 */
export function mediaRoutes({ db, storage, images, maxBytes, log }: MediaDeps) {
  const repo = mediaRepo(db)

  /** Ключи файлов картинки в хранилище. Id — строчными (Uuid) или прямо из базы */
  const keysOf = (siteId: string, mediaId: string, files: readonly string[]) =>
    files.map((file) => mediaKey(siteId, mediaId, file))

  /** Файлы — в хранилище, потом строка в базе. Не вышло — файлы убираем, мусора не остаётся */
  async function store(siteId: string, mediaId: string, image: ProcessedImage) {
    const files = [image.original, ...image.variants]
    const keys = keysOf(
      siteId,
      mediaId,
      files.map((file) => file.file),
    )
    try {
      await Promise.all(files.map((file, index) => storage.put(keys[index] as string, file.data)))
    } catch (error) {
      await storage.remove(keys).catch(() => {})
      throw error
    }
    return keys
  }

  return (
    new Hono<AuthEnv>()
      // Лимит размера отдаём вместе с медиатекой: админка проверит файл до отправки. Иначе на
      // большой файл API ответит 413, не дочитав тело, соединение оборвётся, и браузер (особенно
      // через прокси) увидит сетевой сбой вместо понятного «файл больше N МБ»
      .get('/', validate('param', SiteParams), requireSite(db, 'site.read'), async (c) => {
        const { siteId } = c.req.valid('param')
        return c.json({ items: await repo.list(siteId), maxBytes }, 200)
      })

      .post(
        '/',
        validate('param', SiteParams),
        requireSite(db, 'media.upload'),
        // Тело режем до разбора multipart: огромный файл не читается в память целиком
        bodyLimit({
          maxSize: maxBytes + MULTIPART_OVERHEAD,
          onError: (c) => c.json(tooLarge(maxBytes), 413),
        }),
        validate('form', Upload),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const { file } = c.req.valid('form')
          if (file.size > maxBytes) return c.json(tooLarge(maxBytes), 413)

          const result = await images.process(new Uint8Array(await file.arrayBuffer()))
          if (!result.ok) {
            const { status, code, message } = rejected[result.reason]
            return c.json({ error: { code, message, issues: [{ path: 'file', message }] } }, status)
          }

          const { image } = result
          const id = crypto.randomUUID()
          const keys = await store(siteId, id, image)
          const variants: StoredVariant[] = image.variants.map(({ data, ...variant }) => ({
            ...variant,
            size: data.byteLength,
          }))
          try {
            const created = await repo.create(
              {
                id,
                siteId,
                originalName: displayName(file.name),
                mimeType: imageMimeTypes[image.format],
                width: image.width,
                height: image.height,
                size: file.size,
                variants,
                originalFile: image.original.file,
              },
              c.var.actor,
            )
            return c.json(created, 201)
          } catch (error) {
            await storage.remove(keys).catch(() => {})
            throw error
          }
        },
      )

      .delete(
        '/:mediaId',
        validate('param', MediaParams),
        requireSite(db, 'media.delete'),
        async (c) => {
          const { siteId, mediaId } = c.req.valid('param')
          const files = await repo.findFiles(mediaId)
          if (!files || files.siteId !== siteId) {
            return c.json(notFound('Картинка не найдена'), 404)
          }

          // Картинку в черновике или на сайте удалять нельзя: страница осталась бы с дырой.
          // История версий не в счёт — версию с удалённой картинкой не дадут вернуть
          const usage = await repo.usage(siteId, mediaId)
          if (usage.length > 0) {
            const list = usage
              .map((page) => `«${page.title}» (${pagePath(page.slug)}) — ${usageWhere(page)}`)
              .join('; ')
            const issues = usage.map((page) => ({
              path: `pages.${page.slug}`,
              message: usageWhere(page),
            }))
            const message = `Картинка используется на страницах: ${list}. Уберите её оттуда и опубликуйте страницы, тогда её можно будет удалить`
            return c.json(conflict(message, issues), 409)
          }

          if (!(await repo.delete(siteId, mediaId))) {
            return c.json(notFound('Картинка не найдена'), 404)
          }
          const keys = keysOf(files.siteId, files.id, [
            files.originalFile,
            ...files.variants.map((variant) => variant.file),
          ])
          // Записи уже нет, файлы никто не найдёт. Не удалились — это мусор на диске, а не
          // ошибка для человека: пишем в лог
          await storage.remove(keys).catch((error: unknown) => {
            log(`Не удалось удалить файлы картинки ${mediaId}: ${String(error)}`)
          })
          return c.body(null, 204)
        },
      )
  )
}

/**
 * Файлы вариантов: монтируется на /media и открыт без входа (список в auth/middleware.ts) —
 * на эти адреса ссылается опубликованный сайт. Оригинал наружу не отдаётся
 */
export function mediaFilesRoutes({ db, storage }: Pick<MediaDeps, 'db' | 'storage'>) {
  const repo = mediaRepo(db)

  return new Hono<AuthEnv>().get('/:mediaId/:file', validate('param', FileParams), async (c) => {
    const { mediaId, file } = c.req.valid('param')
    const found = await repo.findFiles(mediaId)
    const variant = found?.variants.find((candidate) => candidate.file === file)
    if (!found || !variant) return c.json(notFound('Файл не найден'), 404)

    const data = await storage.get(mediaKey(found.siteId, found.id, variant.file))
    if (!data) return c.json(notFound('Файл не найден'), 404)

    return c.body(data as Uint8Array<ArrayBuffer>, 200, {
      'content-type': imageMimeTypes[variant.format],
      'content-length': String(data.byteLength),
      // Файл под этим адресом не меняется никогда: новая картинка — новый id
      'cache-control': 'public, max-age=31536000, immutable',
      // Браузер не угадывает тип по содержимому: что сказали, то и есть
      'x-content-type-options': 'nosniff',
    })
  })
}
