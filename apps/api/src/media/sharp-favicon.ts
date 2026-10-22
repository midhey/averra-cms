import sharp from 'sharp'
import { cachedIcons, ICO_SIZES, ICON_SIZES, type IconFile, icoFromPngs } from './favicon'
import { MAX_PIXELS } from './processor'
import { looksLikeSvg, svgForRaster } from './svg'

/** Цвет #RRGGBB → фон для sharp */
function rgb(color: string) {
  const value = Number.parseInt(color.slice(1), 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, alpha: 1 }
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

/**
 * Квадрат size×size: картинка целиком (contain), поля — прозрачные или цвета фона. iOS заливает
 * прозрачное чёрным, поэтому apple-touch-icon — на фоне сайта.
 *
 * SVG медиатеки (уже очищенный) растеризуется сразу в нужный размер: у корня подменяются width и
 * height. Через плотность (density) так не выходит — она у sharp ограничена, поэтому крошечный
 * viewBox (0.1×0.1) давал «bad dimensions», огромный (чертёж A4 в сотых миллиметра) — превышение
 * предела пикселей, а вытянутый (5000×3) — картинку нулевой высоты
 */
async function square(original: Uint8Array, size: number, background?: string) {
  const input = looksLikeSvg(original) ? svgForRaster(original, size) : original
  let pipeline = sharp(input, { autoOrient: true, limitInputPixels: MAX_PIXELS }).resize(
    size,
    size,
    { fit: 'contain', background: background ? rgb(background) : TRANSPARENT },
  )
  if (background) pipeline = pipeline.flatten({ background: rgb(background) })
  return new Uint8Array(await pipeline.png({ compressionLevel: 9 }).toBuffer())
}

/** Один файл набора из оригинала картинки. background — фон сайта (#RRGGBB) для apple-touch-icon */
export async function renderIcon(original: Uint8Array, file: IconFile, background: string) {
  if (file === 'favicon.ico') {
    const images = await Promise.all(
      ICO_SIZES.map(async (size) => ({ size, data: await square(original, size) })),
    )
    return icoFromPngs(images)
  }
  return square(
    original,
    ICON_SIZES[file],
    file === 'apple-touch-icon.png' ? background : undefined,
  )
}

/** Набор иконок на sharp с кешем: его подключают index.ts и testing.ts */
export const sharpIcons = () => cachedIcons(renderIcon)
