import { fileTooLargeMessage, type MediaMap } from '@cms/schema'
import type { InferResponseType } from 'hono/client'
import type { api } from '../api'

/** Медиатека так, как её отдаёт API: картинки и лимит размера файла */
export type MediaLibraryData = InferResponseType<
  (typeof api.sites)[':siteId']['media']['$get'],
  200
>

/** Картинка медиатеки так, как её отдаёт API */
export type MediaItem = MediaLibraryData['items'][number]

type Variant = Pick<MediaItem['variants'][number], 'format' | 'width' | 'url'>

/** Вес файла по-человечески: 820 Б, 14 КБ, 2,4 МБ */
export function formatBytes(bytes: number) {
  const format = (value: number, unit: string) =>
    `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)} ${unit}`
  if (bytes < 1024) return format(bytes, 'Б')
  if (bytes < 1024 * 1024) return format(Math.round(bytes / 1024), 'КБ')
  return format(bytes / 1024 / 1024, 'МБ')
}

/** Размеры и вес для подписи под превью: 1200 × 800 · 240 КБ */
export const mediaSummary = (media: Pick<MediaItem, 'width' | 'height' | 'size'>) =>
  `${media.width} × ${media.height} · ${formatBytes(media.size)}`

/** Превью для сетки — самый маленький WebP: его понимает любой браузер админки и он лёгкий */
export function thumbnailUrl(variants: readonly Variant[]) {
  const webp = variants.filter((variant) => variant.format === 'webp')
  const smallest = (webp.length > 0 ? webp : variants).reduce<Variant | undefined>(
    (best, variant) => (!best || variant.width < best.width ? variant : best),
    undefined,
  )
  return smallest?.url
}

/** Справочник для блоков в предпросмотре: те же поля, что отдаёт снимок сайта рендереру */
export function mediaMapOf(
  items: readonly Pick<MediaItem, 'id' | 'width' | 'height' | 'variants'>[],
): MediaMap {
  return Object.fromEntries(
    items.map(({ id, width, height, variants }) => [
      id,
      {
        width,
        height,
        variants: variants.map(({ format, width, height, url }) => ({
          format,
          width,
          height,
          url,
        })),
      },
    ]),
  )
}

/**
 * Файл больше лимита API — отказ ещё до отправки, тем же текстом, что сказал бы API. На такой
 * файл API отвечает 413, не дочитав тело, и обрывает соединение: браузер (тем более через
 * прокси) увидел бы сетевой сбой вместо понятной причины. Лимит неизвестен — решит API
 */
export const tooLargeMessage = (file: Pick<File, 'size'>, maxBytes: number | undefined) =>
  maxBytes !== undefined && file.size > maxBytes ? fileTooLargeMessage(maxBytes) : undefined

/** Подтверждение удаления: имя файла, чтобы не удалить не ту картинку из похожих превью */
export const deleteQuestion = (media: Pick<MediaItem, 'originalName'>) =>
  `Удалить картинку «${media.originalName}» из медиатеки? Вернуть её не получится.`
