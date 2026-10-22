import {
  fileTooLargeMessage,
  formatBytes,
  isSvgFile,
  MAX_SVG_BYTES,
  type MediaMap,
  SVG_MIME_TYPE,
  svgTooLargeMessage,
} from '@averra/schema'
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

/** Размеры и вес для подписи под превью: 1200 × 800 · 240 КБ, у SVG — с пометкой формата */
export const mediaSummary = (
  media: Pick<MediaItem, 'width' | 'height' | 'size'> & { mimeType?: string },
) =>
  [
    `${media.width} × ${media.height}`,
    media.mimeType === SVG_MIME_TYPE && 'SVG',
    formatBytes(media.size),
  ]
    .filter(Boolean)
    .join(' · ')

/** SVG ставится только туда, где его допускает API: логотип и иконка сайта */
export const isSvgItem = (media: Pick<MediaItem, 'mimeType'>) => media.mimeType === SVG_MIME_TYPE

/** Порядок форматов в подписи: сначала современные, их браузер и возьмёт */
const FORMAT_ORDER = ['avif', 'webp', 'jpeg', 'png', 'svg'] as const

/** Форматы вариантов для подписи под превью: «AVIF, WebP» — без повторов, по порядку выше */
export function mediaFormats(variants: readonly Pick<Variant, 'format'>[]) {
  const present = new Set(variants.map((variant) => variant.format))
  return FORMAT_ORDER.filter((format) => present.has(format))
    .map((format) => (format === 'webp' ? 'WebP' : format.toUpperCase()))
    .join(', ')
}

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
export function tooLargeMessage(
  file: Pick<File, 'size' | 'type' | 'name'>,
  maxBytes: number | undefined,
) {
  if (maxBytes !== undefined && file.size > maxBytes) return fileTooLargeMessage(maxBytes)
  // У SVG свой предел, меньше общего: API ответил бы 413 уже после отправки
  if (isSvgFile(file) && file.size > MAX_SVG_BYTES) return svgTooLargeMessage()
  return undefined
}

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
