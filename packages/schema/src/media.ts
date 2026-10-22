import { z } from 'zod'
import { Uuid } from './id'

/** Id картинки в медиатеке сайта */
export const MediaId = Uuid('Нужен id картинки из медиатеки')

/**
 * Поле «картинка» в блоке: какая картинка из медиатеки и её описание. Alt обязателен —
 * без него картинку не поймёт ни экранный диктор, ни поисковик. Пометка x-widget доходит
 * до JSON Schema: по ней админка ставит выбор из медиатеки вместо двух текстовых полей
 */
export const Image = z
  .strictObject({
    mediaId: MediaId.meta({ title: 'Картинка' }),
    alt: z
      .string()
      .trim()
      .min(1, 'Опишите, что на картинке: это прочтёт экранный диктор и увидит поисковик')
      .max(200)
      .meta({ title: 'Описание картинки (alt)' }),
  })
  .meta({ 'x-widget': 'image' })
export type Image = z.infer<typeof Image>

/** Форматы, которые принимает медиатека и в которые режутся варианты */
export const ImageFormat = z.enum(['jpeg', 'png', 'webp', 'avif'])
export type ImageFormat = z.infer<typeof ImageFormat>

export const imageMimeTypes = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
} as const satisfies Record<ImageFormat, `image/${string}`>
export type ImageMimeType = (typeof imageMimeTypes)[ImageFormat]

/** Формат по MIME-типу: обратный справочник к imageMimeTypes, чтобы списки не разошлись */
export const imageFormatOf: Readonly<Record<string, ImageFormat>> = Object.fromEntries(
  ImageFormat.options.map((format) => [imageMimeTypes[format], format]),
)

/**
 * Форматы файлов медиатеки: растровые и SVG. SVG — отдельно от ImageFormat: его не режут на
 * варианты и не кодируют, а очищают и хранят одним файлом. Ставится только туда, где растр не
 * нужен: логотип организации и иконка сайта
 */
export const MediaFormat = z.enum([...ImageFormat.options, 'svg'])
export type MediaFormat = z.infer<typeof MediaFormat>

export const SVG_MIME_TYPE = 'image/svg+xml'

export const mediaMimeTypes = {
  ...imageMimeTypes,
  svg: SVG_MIME_TYPE,
} as const satisfies Record<MediaFormat, `image/${string}`>
export type MediaMimeType = (typeof mediaMimeTypes)[MediaFormat]

/**
 * Самый большой SVG. Логотипу и иконке хватает с запасом; больше — почти всегда вложенная
 * растровая картинка, её лучше загрузить PNG. Общий лимит медиатеки (MEDIA_MAX_BYTES) — для фото
 */
export const MAX_SVG_BYTES = 256 * 1024

export const svgTooLargeMessage = () =>
  `SVG больше ${formatBytes(MAX_SVG_BYTES)}. Логотипу столько не нужно: упростите файл или загрузите PNG`

/** Файл — SVG (по типу или имени, которые назвал браузер): админка проверяет вес до отправки */
export const isSvgFile = (file: { type: string; name: string }) =>
  file.type === SVG_MIME_TYPE || /\.svg$/i.test(file.name)

/** Картинка медиатеки — SVG: у неё один вариант формата svg */
export const isSvgMedia = (media: { variants: readonly { format: MediaFormat }[] }) =>
  media.variants.some((variant) => variant.format === 'svg')

/** Почему SVG нельзя в блок или SEO-картинку страницы: одна фраза для API и MCP */
export const svgInContentMessage =
  'SVG — только для логотипа и иконки сайта. Сюда выберите JPEG, PNG, WebP или AVIF'

/** Почему этот SVG не годится иконкой: сервер не смог превратить его в favicon и PNG */
export const svgIconMessage =
  'Из этого SVG не получилась иконка сайта. Пересохраните файл в редакторе или выберите PNG 512 × 512'

/** Почему SVG нельзя картинкой для соцсетей */
export const svgSocialMessage =
  'SVG соцсети и мессенджеры не показывают. Выберите JPEG или PNG, лучше 1200 × 630'

/**
 * Вес по-человечески: 820 Б, 14 КБ, 2,4 МБ. Единица — по величине: лимит в 2 КБ (как в тестах)
 * не превращается в «0 МБ». Одна функция на сообщения API и подписи админки
 */
export function formatBytes(bytes: number) {
  const format = (value: number, unit: string) =>
    `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)} ${unit}`
  if (bytes < 1024) return format(bytes, 'Б')
  if (bytes < 1024 * 1024) return format(Math.round(bytes / 1024), 'КБ')
  return format(bytes / 1024 / 1024, 'МБ')
}

/**
 * Сообщение «файл слишком большой». Одно на API и админку: админка проверяет размер ещё до
 * отправки и говорит то же, что сказал бы API
 */
export const fileTooLargeMessage = (maxBytes: number) =>
  `Файл больше ${formatBytes(maxBytes)}. Уменьшите картинку и загрузите снова`
export const fileSizeLimitHint = (maxBytes: number) => `Не больше ${formatBytes(maxBytes)}`

/** Вариант картинки так, как его видят рендерер и админка: формат, размеры и адрес файла */
export const MediaVariantView = z.object({
  format: MediaFormat,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  url: z.string(),
})
export type MediaVariantView = z.infer<typeof MediaVariantView>

/** Всё, что нужно блоку, чтобы вывести картинку: размеры исходника и варианты */
export const MediaFile = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  variants: z.array(MediaVariantView),
})
export type MediaFile = z.infer<typeof MediaFile>

/** Справочник картинок страницы: mediaId → файл. Его отдаёт снимок сайта и строит админка */
export type MediaMap = Readonly<Record<string, MediaFile>>

export type MediaRef = { mediaId: string; path: (string | number)[] }

/**
 * Все ссылки на картинки в содержимом страницы — с путём до каждой, чтобы ошибку можно было
 * показать у поля. Ключ mediaId бывает только у поля Image: лишние поля схемы блоков не пускают
 */
export function collectMediaRefs(value: unknown, path: (string | number)[] = []): MediaRef[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectMediaRefs(item, [...path, index]))
  }
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'mediaId' && typeof child === 'string'
      ? [{ mediaId: child, path: [...path, key] }]
      : collectMediaRefs(child, [...path, key]),
  )
}
