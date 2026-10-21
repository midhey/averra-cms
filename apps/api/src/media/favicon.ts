import { concurrencyLimit } from './processor'

// Только типы и чистые функции: обработка на sharp — в sharp-favicon.ts.
//
// Иконка сайта из одной картинки медиатеки: favicon.ico для вкладки и закладок, apple-touch-icon
// для экрана «Домой» на iPhone и PNG 192 и 512 для манифеста (Android, Яндекс). SVG медиатека не
// принимает, поэтому и иконка — только растровая

/** Файлы набора: имя на сайте → размер стороны. favicon.ico собирается из нескольких */
export const ICON_SIZES = {
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-512.png': 512,
} as const

/** Размеры внутри favicon.ico: вкладка (16, 32) и ярлык Windows (48) */
export const ICO_SIZES = [16, 32, 48] as const

export const ICON_FILES = ['favicon.ico', ...Object.keys(ICON_SIZES)] as [
  'favicon.ico',
  ...(keyof typeof ICON_SIZES)[],
]
export type IconFile = (typeof ICON_FILES)[number]

export const iconMimeType = (file: IconFile) =>
  file === 'favicon.ico' ? 'image/x-icon' : 'image/png'

/**
 * ICO из PNG: заголовок, по записи на картинку и сами PNG. PNG внутри ICO понимают все браузеры
 * и Windows начиная с Vista, а sharp ICO не пишет — формат простой, собираем сами.
 * Поля — little-endian; ширина 256 записывается нулём (у нас картинки меньше)
 */
export function icoFromPngs(images: readonly { size: number; data: Uint8Array }[]) {
  const headerSize = 6
  const entrySize = 16
  let offset = headerSize + entrySize * images.length
  const total = offset + images.reduce((sum, image) => sum + image.data.byteLength, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint16(0, 0, true) // зарезервировано
  view.setUint16(2, 1, true) // 1 — иконка
  view.setUint16(4, images.length, true)
  images.forEach((image, index) => {
    const entry = headerSize + entrySize * index
    view.setUint8(entry, image.size >= 256 ? 0 : image.size)
    view.setUint8(entry + 1, image.size >= 256 ? 0 : image.size)
    view.setUint8(entry + 2, 0) // палитры нет
    view.setUint8(entry + 3, 0)
    view.setUint16(entry + 4, 1, true) // плоскостей
    view.setUint16(entry + 6, 32, true) // бит на пиксель
    view.setUint32(entry + 8, image.data.byteLength, true)
    view.setUint32(entry + 12, offset, true)
    out.set(image.data, offset)
    offset += image.data.byteLength
  })
  return out
}

/** Сколько готовых файлов держать в памяти: набор одной иконки — четыре файла */
const CACHE_SIZE = 16

/** Один файл набора из оригинала картинки; background — фон сайта (#RRGGBB) для apple-touch-icon */
export type RenderIcon = (
  original: Uint8Array,
  file: IconFile,
  background: string,
) => Promise<Uint8Array>

/**
 * Генератор набора с кешем в памяти и очередью. Адрес иконок открыт без входа (их берёт сборка
 * сайта), поэтому повторный запрос того же файла не гоняет обработку заново: ключ — картинка,
 * файл и фон. Иконку меняют редко — кеша на несколько наборов хватает. Сама обработка (sharp) —
 * в sharp-favicon.ts: этот файл импортируют маршруты, а их типы читает админка
 */
export function cachedIcons(render: RenderIcon, { concurrency = 1 } = {}) {
  const queue = concurrencyLimit(concurrency)
  const cache = new Map<string, Promise<Uint8Array>>()
  return (
    key: { mediaId: string; file: IconFile; background: string },
    original: () => Promise<Uint8Array | undefined>,
  ) => {
    const id = `${key.mediaId}/${key.file}/${key.background}`
    const cached = cache.get(id)
    if (cached) return cached
    const rendering = queue(async () => {
      const data = await original()
      if (!data) throw new Error(`Нет файла картинки ${key.mediaId}`)
      return render(data, key.file, key.background)
    })
    cache.set(id, rendering)
    // Сбой не запоминаем: следующий запрос попробует снова
    rendering.catch(() => cache.delete(id))
    while (cache.size > CACHE_SIZE) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return rendering
  }
}

export type IconRenderer = ReturnType<typeof cachedIcons>
