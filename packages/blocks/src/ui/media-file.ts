import type { ImageFormat, MediaFile } from '@averra/schema'

// Выбор вариантов картинки — без React: им пользуются и Picture, и фильтры своих блоков

/** Запасной формат — исходный JPEG или PNG. Если исходник был WebP или AVIF, запасной — WebP */
export const fallbackFormat = (file: MediaFile): ImageFormat =>
  file.variants
    .map((variant) => variant.format)
    .find((format): format is 'jpeg' | 'png' => format === 'jpeg' || format === 'png') ?? 'webp'

export const largestVariant = (file: MediaFile, format: ImageFormat) =>
  file.variants
    .filter((variant) => variant.format === format)
    .reduce<MediaFile['variants'][number] | undefined>(
      (best, variant) => (!best || variant.width > best.width ? variant : best),
      undefined,
    )

/** Набор ширин одного формата для srcset: «адрес 640w, адрес 1280w» */
export const srcSetOf = (file: MediaFile, format: ImageFormat) =>
  file.variants
    .filter((variant) => variant.format === format)
    .toSorted((a, b) => a.width - b.width)
    .map((variant) => `${variant.url} ${variant.width}w`)
    .join(', ')

/** SVG-вариант: один файл без нарезки */
export const vectorVariant = (file: MediaFile) =>
  file.variants.find((variant) => variant.format === 'svg')

/**
 * Адрес картинки в полном размере: самый широкий вариант формата, который откроет любой браузер
 * (у SVG — сам файл). Им фото галереи ведёт на снимок целиком — без JavaScript и лайтбокса
 */
export function fullSizeUrl(file: MediaFile) {
  return vectorVariant(file)?.url ?? largestVariant(file, fallbackFormat(file))?.url
}
