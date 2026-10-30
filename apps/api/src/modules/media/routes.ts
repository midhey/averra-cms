import {
  fileSizeLimitHint,
  fileTooLargeMessage,
  imageMimeTypes,
  MAIN_PAGE_SLUG,
  MAX_SVG_BYTES,
  type MediaMimeType,
  mediaMimeTypes,
  type SiteSettings,
  SVG_MIME_TYPE,
  svgTooLargeMessage,
  Uuid,
} from '@averra/schema'
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
  MAX_SVG_EMBEDDED_PIXELS,
  type ProcessFailure,
} from '../../media/processor'
import { type MediaStorage, mediaKey, SVG_FILE } from '../../media/storage'
import {
  looksLikeSvg,
  MAX_SVG_DEPTH,
  MAX_SVG_SIDE,
  type SvgFailure,
  sanitizeSvg,
} from '../../media/svg'
import { validate } from '../../validate'
import { customBlocksRepo } from '../custom-blocks/repo'
import { headerRepo } from '../header/repo'
import { settingsRepo } from '../settings/repo'
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

type Failure = { status: 413 | 415; code: string; message: string }

const unsupported = (message: string): Failure => ({
  status: 415,
  code: 'unsupported_media_type',
  message,
})

const rejected: Record<ProcessFailure, Failure> = {
  unsupported: unsupported(
    'Можно загрузить JPEG, PNG, WebP, AVIF или SVG (для логотипов и иконки). GIF, HEIC и другие форматы не принимаются',
  ),
  broken: unsupported('Файл повреждён: картинку не удалось прочитать'),
  too_many_pixels: {
    status: 413,
    code: 'payload_too_large',
    message: `Картинка слишком большая: не больше ${MAX_PIXELS / 1_000_000} мегапикселей`,
  },
}

const svgRejected: Record<SvgFailure | 'embedded' | 'embedded_pixels' | 'too_large', Failure> = {
  broken: unsupported('SVG не читается: файл повреждён или это не SVG'),
  doctype: unsupported(
    'SVG с объявлениями сущностей (DOCTYPE с […]) не принимаем: так атакуют сервер. Экспортируйте файл заново обычным SVG',
  ),
  encoding: unsupported('SVG должен быть в кодировке UTF-8: пересохраните файл'),
  no_size: unsupported(
    'У SVG нет размеров: нужен viewBox или width и height в пикселях, мм, см или дюймах. Экспортируйте файл заново',
  ),
  bad_size: unsupported(
    `Размеры SVG слишком большие: не больше ${MAX_SVG_SIDE.toLocaleString('ru-RU')} по стороне`,
  ),
  too_deep: unsupported(`SVG слишком сложный: вложенность элементов больше ${MAX_SVG_DEPTH}`),
  embedded: unsupported(
    'Картинка внутри SVG не читается или не того формата: внутри можно PNG, JPEG, GIF или WebP',
  ),
  embedded_pixels: {
    status: 413,
    code: 'payload_too_large',
    message: `Картинки внутри SVG слишком большие: всего не больше ${MAX_SVG_EMBEDDED_PIXELS / 1_000_000} мегапикселей. Загрузите PNG`,
  },
  too_large: { status: 413, code: 'payload_too_large', message: svgTooLargeMessage() },
}

/**
 * Что сохранить: файлы в хранилище и поля строки медиатеки. size — вес для подписи в админке: у
 * растра — загруженного файла, у SVG — очищенного (его и отдаём)
 */
type Prepared =
  | {
      ok: true
      files: { file: string; data: Uint8Array }[]
      mimeType: MediaMimeType
      width: number
      height: number
      size?: number
      variants: StoredVariant[]
      originalFile: string
    }
  | { ok: false; failure: Failure }

/**
 * Политика для SVG, открытого напрямую по адресу файла: ничего не грузить и не исполнять
 * (sandbox — ещё и отдельный источник). Очистка уже убрала скрипты; это вторая линия. Внутри
 * <img> скрипты SVG не работают и так. Тот же заголовок ставит Caddy на домене сайта
 */
export const SVG_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"

/** Имя файла только для показа в админке: без управляющих символов и не длиннее 200 */
function displayName(name: string) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: вырезаем именно управляющие символы
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return clean.slice(0, 200) || 'картинка'
}

const pagePath = (slug: string) => (slug === MAIN_PAGE_SLUG ? '/' : `/${slug}`)

/** Где в настройках SEO стоит картинка — словами для сообщения */
function settingsMediaRoles(settings: SiteSettings, mediaId: string) {
  return [
    settings.icon === mediaId && 'иконка сайта',
    settings.ogImage === mediaId && 'картинка для соцсетей',
    settings.organization.logo === mediaId && 'логотип организации',
  ].filter((role): role is string => role !== false)
}

const usageWhere = ({ draft, published }: MediaUsage) =>
  draft && published ? 'черновик и сайт' : draft ? 'черновик' : 'сайт'

/**
 * Медиатека сайта: монтируется на /sites/:siteId/media. Права — как у страниц: смотреть —
 * чтение сайта, загружать может и клиент, удалять — владелец и редактор
 */
export function mediaRoutes({ db, storage, images, maxBytes, log }: MediaDeps) {
  const repo = mediaRepo(db)

  /**
   * Ключи файлов картинки в хранилище. Id — строчными (Uuid) или прямо из базы. У SVG оригинал
   * и вариант — один файл
   */
  const keysOf = (siteId: string, mediaId: string, files: readonly string[]) =>
    [...new Set(files)].map((file) => mediaKey(siteId, mediaId, file))

  /** Файлы — в хранилище, потом строка в базе. Не вышло — файлы убираем, мусора не остаётся */
  async function store(
    siteId: string,
    mediaId: string,
    files: { file: string; data: Uint8Array }[],
  ) {
    const keys = keysOf(
      siteId,
      mediaId,
      files.map((file) => file.file),
    )
    try {
      await Promise.all(
        files.map((file) => storage.put(mediaKey(siteId, mediaId, file.file), file.data)),
      )
    } catch (error) {
      await storage.remove(keys).catch(() => {})
      throw error
    }
    return keys
  }

  /** Растр: проверка и нарезка вариантов (sharp) */
  async function prepareImage(data: Uint8Array): Promise<Prepared> {
    const result = await images.process(data)
    if (!result.ok) return { ok: false, failure: rejected[result.reason] }
    const { image } = result
    return {
      ok: true,
      files: [image.original, ...image.variants],
      mimeType: imageMimeTypes[image.format],
      width: image.width,
      height: image.height,
      variants: image.variants.map(({ data: bytes, ...variant }) => ({
        ...variant,
        size: bytes.byteLength,
      })),
      originalFile: image.original.file,
    }
  }

  /**
   * SVG: свой предел веса, очистка (src/media/svg.ts) и проверка вложенных картинок по заголовку:
   * формат должен совпасть с объявленным, а пикселей — не больше MAX_SVG_EMBEDDED_PIXELS. Хранится
   * один очищенный файл: он и «оригинал», и единственный вариант
   */
  async function prepareSvg(data: Uint8Array): Promise<Prepared> {
    if (data.byteLength > MAX_SVG_BYTES) return { ok: false, failure: svgRejected.too_large }
    const result = sanitizeSvg(data)
    if (!result.ok) return { ok: false, failure: svgRejected[result.reason] }
    const { svg } = result
    let pixels = 0
    for (const embedded of svg.embedded) {
      const info = await images.inspect(embedded.data)
      if (!info || info.mediaType !== embedded.declared) {
        return { ok: false, failure: svgRejected.embedded }
      }
      pixels += info.width * info.height
    }
    if (pixels > MAX_SVG_EMBEDDED_PIXELS) {
      return { ok: false, failure: svgRejected.embedded_pixels }
    }
    return {
      ok: true,
      files: [{ file: SVG_FILE, data: svg.data }],
      mimeType: SVG_MIME_TYPE,
      width: svg.width,
      height: svg.height,
      size: svg.data.byteLength,
      variants: [
        {
          format: 'svg',
          width: svg.width,
          height: svg.height,
          size: svg.data.byteLength,
          file: SVG_FILE,
        },
      ],
      originalFile: SVG_FILE,
    }
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

          const data = new Uint8Array(await file.arrayBuffer())
          // Тип — по содержимому: SVG (XML) начинается с «<», растровые форматы — нет
          const result = looksLikeSvg(data) ? await prepareSvg(data) : await prepareImage(data)
          if (!result.ok) {
            const { status, code, message } = result.failure
            return c.json({ error: { code, message, issues: [{ path: 'file', message }] } }, status)
          }

          const upload = result
          const id = crypto.randomUUID()
          const keys = await store(siteId, id, upload.files)
          try {
            const created = await repo.create(
              {
                id,
                siteId,
                originalName: displayName(file.name),
                mimeType: upload.mimeType,
                width: upload.width,
                height: upload.height,
                size: upload.size ?? file.size,
                variants: upload.variants,
                originalFile: upload.originalFile,
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

          // Логотип шапки — на каждой странице сайта (или в её черновике)
          const header = await headerRepo(db).read(siteId)
          const inHeader = [header?.draft, header?.published].some((item) => item?.logo === mediaId)
          if (inHeader) {
            const message =
              'Картинка — логотип шапки сайта. Замените его в разделе «Шапка и подвал», тогда её можно будет удалить'
            return c.json(conflict(message, [{ path: 'header', message: 'логотип шапки' }]), 409)
          }

          // Картинка в настройках SEO (иконка, картинка для соцсетей, логотип) — тоже на сайте
          const settings = await settingsRepo(db).read(siteId)
          const roles = settings ? settingsMediaRoles(settings, mediaId) : []
          if (roles.length > 0) {
            const message = `Картинка стоит в разделе «SEO»: ${roles.join(', ')}. Замените её там, тогда её можно будет удалить`
            return c.json(
              conflict(
                message,
                roles.map((role) => ({ path: 'settings', message: role })),
              ),
              409,
            )
          }

          // Картинка в CSS или примере своего блока: на сайте пропал бы фон, в каталоге — пример
          const blocks = await customBlocksRepo(db).usingMedia(siteId, mediaId)
          if (blocks.length > 0) {
            const list = blocks.map((block) => `«${block.title}»`).join(', ')
            const message = `Картинка в своих блоках: ${list} (CSS или пример). Уберите её оттуда, тогда её можно будет удалить`
            const issues = blocks.map((block) => ({
              path: `customBlocks.${block.key}`,
              message: block.title,
            }))
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
      'content-type': mediaMimeTypes[variant.format],
      'content-length': String(data.byteLength),
      // Файл под этим адресом не меняется никогда: новая картинка — новый id
      'cache-control': 'public, max-age=31536000, immutable',
      // Браузер не угадывает тип по содержимому: что сказали, то и есть
      'x-content-type-options': 'nosniff',
      ...(variant.format === 'svg' && { 'content-security-policy': SVG_CSP }),
    })
  })
}
