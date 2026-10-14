import { fileTooLargeMessage, formatBytes, type MediaMap } from '@averra/schema'
import type { InferResponseType } from 'hono/client'
import type { api } from '../api'
import { formatDateTime } from '../pages-format'

/** Медиатека так, как её отдаёт API: картинки и лимит размера файла */
export type MediaLibraryData = InferResponseType<
  (typeof api.sites)[':siteId']['media']['$get'],
  200
>

/** Картинка медиатеки так, как её отдаёт API */
export type MediaItem = MediaLibraryData['items'][number]

type Variant = Pick<MediaItem['variants'][number], 'format' | 'width' | 'url'>

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

type LabelledMedia = Pick<MediaItem, 'originalName' | 'width' | 'height' | 'createdAt'>

/**
 * Имя картинки для кнопок и вопросов: файл, размеры и когда загружена. Одного имени файла
 * мало — iOS называет каждое фото image.jpg, и диктор не отличил бы одну кнопку от другой
 */
export const mediaLabel = (media: LabelledMedia, timeZone?: string) =>
  `«${media.originalName}», ${media.width} × ${media.height}, ${formatDateTime(media.createdAt, timeZone)}`

/** Подтверждение удаления: чтобы не удалить не ту картинку из похожих превью */
export const deleteQuestion = (media: LabelledMedia, timeZone?: string) =>
  `Удалить картинку ${mediaLabel(media, timeZone)} из медиатеки? Вернуть её не получится.`
