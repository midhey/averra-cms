import type { ImageFormat } from '@cms/schema'

// Только типы и чистые функции: этот файл импортируют маршруты, а их типы читает админка.
// Обработка на sharp — в sharp-processor.ts, её подключают index.ts и testing.ts

/** Ширины вариантов: телефон, планшет и ноутбук, большой экран, Full HD */
export const VARIANT_WIDTHS = [480, 960, 1440, 1920] as const

/**
 * Больше пикселей не обрабатываем: маленький по весу PNG может развернуться в гигабайты
 * памяти. 50 Мп хватает любой фотографии с телефона и большинству зеркалок
 */
export const MAX_PIXELS = 50_000_000

/**
 * Самая длинная сторона варианта. Больше не умеют WebP (16383 px) и AVIF: длинная
 * инфографика или скриншот страницы целиком после уменьшения до ширины варианта упёрлись бы
 * в этот предел. Такой вариант ужимается ещё и по высоте, пропорции сохраняются
 */
export const MAX_VARIANT_SIDE = 16_383

/** Файл, который получился из загрузки: имя внутри папки картинки и содержимое */
export type ProcessedFile = {
  file: string
  format: ImageFormat
  width: number
  height: number
  data: Uint8Array
}

export type ProcessedImage = {
  /** Формат исходника по его содержимому */
  format: ImageFormat
  /** Размеры после поворота по EXIF */
  width: number
  height: number
  /** Исходник без метаданных в полном размере — для будущей перенарезки, наружу не отдаётся */
  original: ProcessedFile
  variants: ProcessedFile[]
}

/**
 * unsupported — не JPEG, PNG, WebP или AVIF (SVG, GIF, текст…); too_many_pixels — больше
 * MAX_PIXELS; broken — тип верный, но файл не читается
 */
export type ProcessFailure = 'unsupported' | 'too_many_pixels' | 'broken'

export type ProcessResult =
  | { ok: true; image: ProcessedImage }
  | { ok: false; reason: ProcessFailure }

/** Проверка и нарезка загруженной картинки. Отказ — результатом, а не исключением */
export type ImageProcessor = { process(data: Uint8Array): Promise<ProcessResult> }

/**
 * Ширины вариантов для исходника такой ширины. Больше исходника не растягиваем. Если
 * исходник уже 1920, его собственная ширина тоже идёт в набор: картинку в 1000 px
 * на широком экране лучше отдать целиком, чем 960
 */
export function variantWidths(sourceWidth: number): number[] {
  const widths: number[] = VARIANT_WIDTHS.filter((width) => width <= sourceWidth)
  const largest = VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1] ?? sourceWidth
  if (sourceWidth < largest && !widths.includes(sourceWidth)) widths.push(sourceWidth)
  return widths
}

/** Расширение файла варианта. JPEG — привычным .jpg */
export const fileExtension = (format: ImageFormat) => (format === 'jpeg' ? 'jpg' : format)

/** Форматы вариантов: AVIF и WebP всем, плюс исходный JPEG или PNG как запасной */
export function variantFormats(source: ImageFormat): ImageFormat[] {
  return source === 'jpeg' || source === 'png' ? ['avif', 'webp', source] : ['avif', 'webp']
}

/**
 * Сколько картинок обрабатывается одновременно на весь процесс API. Каждая обработка — это
 * несколько конвейеров sharp с десятками мегабайт памяти на большое фото: без очереди
 * несколько одновременных загрузок (их может делать и клиент сайта) съели бы память и процессор
 */
export const PROCESSING_CONCURRENCY = 2

/**
 * Очередь: не больше limit задач одновременно, остальные ждут. Освободившееся место сразу
 * переходит следующему в очереди, поэтому счётчик не уходит за limit
 */
export function concurrencyLimit(limit: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < limit) active += 1
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active -= 1
    }
  }
}
