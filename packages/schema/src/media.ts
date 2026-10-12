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

/** Размер в мегабайтах для сообщений: 10 МБ, 2,5 МБ */
const megabytes = (bytes: number) =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} МБ`

/**
 * Сообщение «файл слишком большой». Одно на API и админку: админка проверяет размер ещё до
 * отправки и говорит то же, что сказал бы API
 */
export const fileTooLargeMessage = (maxBytes: number) =>
  `Файл больше ${megabytes(maxBytes)}. Уменьшите картинку и загрузите снова`
export const fileSizeLimitHint = (maxBytes: number) => `Не больше ${megabytes(maxBytes)}`

/** Вариант картинки так, как его видят рендерер и админка: формат, размеры и адрес файла */
export const MediaVariantView = z.object({
  format: ImageFormat,
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
