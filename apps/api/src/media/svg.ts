import { SaxesParser, type SaxesTagNS } from 'saxes'

// Очистка SVG перед сохранением в медиатеку. Только чистые функции и web API: файл импортируют
// маршруты, а их типы читает админка.
//
// Файл не правится, а собирается заново: строгий XML-парсер (saxes) разбирает исходник, в результат
// попадают только элементы и атрибуты из списков ниже, значения экранируются при выводе. Всё, чего
// нет в списках, выбрасывается — так новая уловка (новый атрибут-обработчик, новый способ сослаться
// наружу) не проходит по умолчанию. Почему не DOMPurify, sanitize-html или svgo — в решении
// «SVG-логотипы и блок видео» документации

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'

/** Глубже не бывает у логотипа, а без предела рекурсивный вывод можно уронить вложенностью */
export const MAX_SVG_DEPTH = 64

/** Сторона в единицах SVG: больше — ошибка в файле, а растеризация иконки ушла бы в гигапиксели */
export const MAX_SVG_SIDE = 100_000

/** Статическая графика SVG: фигуры, текст, градиенты, маски, фильтры. Ни скриптов, ни анимаций */
const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'style',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'image',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
])

/**
 * Обёртки, которые выбрасываются, а содержимое остаётся: ссылка <a> (на сайте логотип — картинка,
 * ссылка внутри только открыла бы чужой адрес при прямом открытии) и <switch> (Illustrator кладёт в
 * него рисунок рядом со своим foreignObject)
 */
const UNWRAP = new Set(['a', 'switch'])

/** Где текст — содержимое, а не пробелы между тегами */
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'textPath', 'title', 'desc', 'style'])

/**
 * Где бывает только текст. Элемент внутри выбрасывается целиком, с текстом: иначе обёртка в
 * <style><a>@import url(…)</a></style> развернулась бы при выводе и её текст стал бы CSS в обход
 * проверки safeCss — она смотрит текст, лежащий прямо в <style>
 */
const TEXT_ONLY = new Set(['style', 'title', 'desc'])

/** Атрибуты без пространства имён: геометрия, оформление, текст, фильтры, доступность */
const ATTRIBUTES = new Set([
  'id',
  'class',
  'style',
  'role',
  'aria-label',
  'aria-hidden',
  'focusable',
  'version',
  'viewBox',
  'preserveAspectRatio',
  'transform',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'fr',
  'd',
  'points',
  'pathLength',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'color',
  'display',
  'visibility',
  'overflow',
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'mask',
  'maskUnits',
  'maskContentUnits',
  'filter',
  'filterUnits',
  'primitiveUnits',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'refX',
  'refY',
  'orient',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'font-stretch',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'baseline-shift',
  'letter-spacing',
  'word-spacing',
  'text-decoration',
  'writing-mode',
  'direction',
  'unicode-bidi',
  'dx',
  'dy',
  'rotate',
  'textLength',
  'lengthAdjust',
  'startOffset',
  'method',
  'spacing',
  'side',
  'vector-effect',
  'shape-rendering',
  'text-rendering',
  'image-rendering',
  'color-interpolation',
  'color-interpolation-filters',
  'mix-blend-mode',
  'isolation',
  'paint-order',
  'flood-color',
  'flood-opacity',
  'lighting-color',
  'in',
  'in2',
  'result',
  'stdDeviation',
  'mode',
  'type',
  'values',
  'tableValues',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'k1',
  'k2',
  'k3',
  'k4',
  'operator',
  'radius',
  'scale',
  'xChannelSelector',
  'yChannelSelector',
  'baseFrequency',
  'numOctaves',
  'seed',
  'stitchTiles',
  'order',
  'kernelMatrix',
  'divisor',
  'bias',
  'targetX',
  'targetY',
  'edgeMode',
  'kernelUnitLength',
  'preserveAlpha',
  'surfaceScale',
  'diffuseConstant',
  'specularConstant',
  'specularExponent',
  'azimuth',
  'elevation',
  'z',
  'pointsAtX',
  'pointsAtY',
  'pointsAtZ',
  'limitingConeAngle',
])

/** Ссылка на элемент этого же файла: #logo-gradient */
const FRAGMENT = /^#[A-Za-z_][\w.:-]*$/

/** Встроенная картинка — только растр base64. data:image/svg+xml и data:text/html — нет */
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/i

/** Где ссылка href — на фрагмент этого файла */
const FRAGMENT_HREF = new Set([
  'use',
  'textPath',
  'linearGradient',
  'radialGradient',
  'pattern',
  'filter',
])

/**
 * Функции CSS, которые грузят ресурс или исполняют код. url() разрешён только как url(#id) —
 * ссылка на градиент или маску в этом же файле
 */
const LOADING_FUNCTIONS =
  /(?:^|[^\w-])(?:-webkit-)?(?:image-set|image|src|cross-fade|element|expression)\s*\(/i
const URL_CALL = /url\s*\(/gi
const FRAGMENT_URL = /^url\(\s*(['"]?)#[A-Za-z_][\w.:-]*\1\s*\)/i

/**
 * Значение CSS (style, <style>, атрибуты оформления) без загрузок и уловок: без \ (экранирование
 * в CSS превращает «\75 rl(» в url( — в обход проверки), без @ (@import, @font-face), без <, без
 * javascript: и только url(#id)
 */
export function safeCss(value: string) {
  if (/[\\@<]/.test(value)) return false
  if (/javascript:|-moz-binding|behavior\s*:/i.test(value)) return false
  if (LOADING_FUNCTIONS.test(value)) return false
  for (const match of value.matchAll(URL_CALL)) {
    if (!FRAGMENT_URL.test(value.slice(match.index))) return false
  }
  return true
}

const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (value: string) => escapeText(value).replace(/"/g, '&quot;')

type Node = {
  name: string
  attributes: [string, string][]
  children: (Node | string)[]
  /** Обёртка: сама в вывод не попадает, дети — да */
  unwrap: boolean
}

/** Вложенная растровая картинка: тип из data:-адреса и байты. Формат сверяет маршрут (sharp) */
export type EmbeddedImage = { declared: string; data: Uint8Array }

export type SanitizedSvg = {
  /** Очищенный файл: UTF-8 без BOM и объявления XML */
  data: Uint8Array
  width: number
  height: number
  embedded: EmbeddedImage[]
}

/**
 * broken — не XML или не SVG; doctype — DOCTYPE с внутренним подмножеством (объявления сущностей:
 * billion laughs, XXE); encoding — не UTF-8; no_size — нет ни viewBox, ни числовых width и height;
 * bad_size — сторона больше MAX_SVG_SIDE; too_deep — вложенность больше MAX_SVG_DEPTH
 */
export type SvgFailure = 'broken' | 'doctype' | 'encoding' | 'no_size' | 'bad_size' | 'too_deep'

export type SvgResult = { ok: true; svg: SanitizedSvg } | { ok: false; reason: SvgFailure }

/**
 * Похоже ли содержимое на SVG/XML: первый значащий символ — «<». У JPEG, PNG, WebP и AVIF первые
 * байты другие, поэтому по этому признаку загрузка уходит в очистку SVG, а не в sharp
 */
export function looksLikeSvg(data: Uint8Array) {
  let start = 0
  // BOM UTF-8
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) start = 3
  for (let index = start; index < Math.min(data.length, start + 1024); index++) {
    const byte = data[index]
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue
    return byte === 0x3c
  }
  return false
}

/** Число без единиц или в px: «120», «120.5px». Остальные единицы (mm, em, %) — не размер */
function plainLength(value: string | undefined) {
  const match = value?.trim().match(/^(\d*\.?\d+(?:e[+-]?\d+)?)(px)?$/i)
  const number = match ? Number(match[1]) : Number.NaN
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function viewBoxSize(value: string | undefined) {
  const parts = value
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (parts?.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined
  const [, , width = 0, height = 0] = parts
  return width > 0 && height > 0 ? { width, height } : undefined
}

/** Число для атрибута: без лишних знаков после запятой и без экспоненты */
const formatNumber = (value: number) => String(Number(value.toFixed(3)))

class Rejected extends Error {
  constructor(readonly reason: SvgFailure) {
    super(reason)
  }
}

/** Проверенный атрибут: имя для вывода и значение — или undefined, если его быть не должно */
function cleanAttribute(
  element: string,
  attribute: { uri: string; local: string; value: string },
  embedded: EmbeddedImage[],
): [string, string] | undefined {
  const { uri, local, value } = attribute
  if (uri === XMLNS_NS || (uri === '' && local === 'xmlns')) return undefined
  if (uri === XML_NS) return local === 'space' ? ['xml:space', value] : undefined
  const isHref = local === 'href' && (uri === '' || uri === XLINK_NS)
  if (isHref) {
    const href = value.trim()
    if (FRAGMENT_HREF.has(element) && FRAGMENT.test(href)) return ['xlink:href', href]
    if (element === 'image') {
      const match = DATA_IMAGE.exec(href)
      if (!match?.[1] || !match[2]) return undefined
      try {
        const bytes = Uint8Array.from(atob(match[2].replace(/\s+/g, '')), (char) =>
          char.charCodeAt(0),
        )
        embedded.push({ declared: `image/${match[1].toLowerCase()}`, data: bytes })
        return ['xlink:href', href.replace(/\s+/g, '')]
      } catch {
        return undefined
      }
    }
    return undefined
  }
  if (uri !== '' || !ATTRIBUTES.has(local)) return undefined
  // Атрибуты оформления читаются как CSS: те же правила, что для style
  return safeCss(value) ? [local, value] : undefined
}

function serialize(node: Node | string, out: string[]) {
  if (typeof node === 'string') {
    out.push(escapeText(node))
    return
  }
  if (node.unwrap) {
    for (const child of node.children) serialize(child, out)
    return
  }
  const attributes = node.attributes
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('')
  if (node.children.length === 0) {
    out.push(`<${node.name}${attributes}/>`)
    return
  }
  out.push(`<${node.name}${attributes}>`)
  for (const child of node.children) serialize(child, out)
  out.push(`</${node.name}>`)
}

/** Корень: размеры числами (и viewBox, если его не было) — пропорции знает любой, кто покажет файл */
function sizeRoot(root: Node) {
  const get = (name: string) => root.attributes.find(([key]) => key === name)?.[1]
  const viewBox = viewBoxSize(get('viewBox'))
  const width = plainLength(get('width'))
  const height = plainLength(get('height'))
  const size = viewBox ?? (width && height ? { width, height } : undefined)
  if (!size) throw new Rejected('no_size')
  if (size.width > MAX_SVG_SIDE || size.height > MAX_SVG_SIDE) throw new Rejected('bad_size')
  const rest = root.attributes.filter(
    ([key]) => key !== 'width' && key !== 'height' && (viewBox || key !== 'viewBox'),
  )
  root.attributes = [
    ['width', formatNumber(size.width)],
    ['height', formatNumber(size.height)],
    ...(viewBox
      ? []
      : [
          ['viewBox', `0 0 ${formatNumber(size.width)} ${formatNumber(size.height)}`] as [
            string,
            string,
          ],
        ]),
    ...rest,
  ]
  return {
    width: Math.max(1, Math.round(size.width)),
    height: Math.max(1, Math.round(size.height)),
  }
}

/** Очистка SVG. Отказ — результатом, а не исключением, как у обработки растровых картинок */
export function sanitizeSvg(input: Uint8Array): SvgResult {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input)
  } catch {
    return { ok: false, reason: 'encoding' }
  }

  const embedded: EmbeddedImage[] = []
  const stack: Node[] = []
  /** Глубина выброшенного поддерева: пока она есть, всё внутри пропускается */
  let skipping = 0
  let root: Node | undefined

  const parser = new SaxesParser({ xmlns: true, position: false })
  parser.on('xmldecl', (decl) => {
    if (decl.encoding && decl.encoding.toLowerCase() !== 'utf-8') throw new Rejected('encoding')
  })
  parser.on('doctype', (doctype) => {
    // Объявления сущностей — только во внутреннем подмножестве […]. Обычный
    // <!DOCTYPE svg PUBLIC …> старого Illustrator выбрасывается молча
    if (doctype.includes('[')) throw new Rejected('doctype')
  })
  parser.on('opentag', (tag: SaxesTagNS) => {
    const depth = stack.length + skipping
    if (depth >= MAX_SVG_DEPTH) throw new Rejected('too_deep')
    if (skipping > 0) {
      skipping += 1
      return
    }
    const parent = stack.at(-1)
    if (!parent) {
      // Корень — только <svg> в пространстве имён SVG
      if (tag.uri !== SVG_NS || tag.local !== 'svg') throw new Rejected('broken')
    }
    const known = tag.uri === SVG_NS && (ELEMENTS.has(tag.local) || UNWRAP.has(tag.local))
    if (!known || stack.some((node) => TEXT_ONLY.has(node.name))) {
      skipping = 1
      return
    }
    const unwrap = UNWRAP.has(tag.local)
    const attributes = Object.values(tag.attributes)
    // href и xlink:href вместе: по SVG 2 главнее href, и в выводе ссылка должна быть одна — оба
    // переписались бы в xlink:href, а повтор атрибута — уже не XML
    const plainHref = attributes.some(({ uri, local }) => uri === '' && local === 'href')
    const node: Node = {
      name: tag.local,
      attributes: unwrap
        ? []
        : attributes.flatMap((attribute) => {
            if (plainHref && attribute.uri === XLINK_NS && attribute.local === 'href') return []
            const clean = cleanAttribute(tag.local, attribute, embedded)
            return clean ? [clean] : []
          }),
      children: [],
      unwrap,
    }
    if (parent) parent.children.push(node)
    else root = node
    stack.push(node)
  })
  parser.on('closetag', () => {
    if (skipping > 0) {
      skipping -= 1
      return
    }
    const node = stack.pop()
    // <style> с загрузкой или уловкой выбрасывается целиком
    if (node?.name === 'style') {
      const css = node.children.filter((child) => typeof child === 'string').join('')
      if (!safeCss(css)) node.children = []
      if (node.children.length === 0) {
        const parent = stack.at(-1)
        if (parent) parent.children = parent.children.filter((child) => child !== node)
      }
    }
  })
  const onText = (value: string) => {
    const current = stack.at(-1)
    if (skipping > 0 || !current) return
    // Текст — только там, где он содержимое: в <text>, <title>, <style>… Пробелы между тегами — нет
    const holder = [...stack].reverse().find((node) => !node.unwrap)
    if (holder && TEXT_ELEMENTS.has(holder.name)) current.children.push(value)
  }
  parser.on('text', onText)
  parser.on('cdata', onText)
  // Комментарии и инструкции обработки (<?xml-stylesheet …?>) не попадают в результат: обработчиков
  // у них нет, saxes их только проверяет на правильность

  try {
    parser.write(text).close()
  } catch (error) {
    if (error instanceof Rejected) return { ok: false, reason: error.reason }
    return { ok: false, reason: 'broken' }
  }
  if (!root) return { ok: false, reason: 'broken' }

  try {
    const { width, height } = sizeRoot(root)
    const out: string[] = []
    serialize(root, out)
    const markup = out.join('')
    // Ссылки пишем как xlink:href, а не href из SVG 2: href без префикса не понимают Safari до
    // iOS 12.1 и старый librsvg, которым sharp растеризует иконку
    const xlink = markup.includes(' xlink:href="') ? ` xmlns:xlink="${XLINK_NS}"` : ''
    const body = markup.replace(/^<svg/, `<svg xmlns="${SVG_NS}"${xlink}`)
    // Страховка: вывод собран из проверенных кусков и обязан читаться тем же строгим парсером.
    // Не читается — ошибка в очистке, и такой файл не должен попасть ни в браузер, ни в librsvg
    if (!wellFormed(body)) return { ok: false, reason: 'broken' }
    return {
      ok: true,
      svg: { data: new TextEncoder().encode(body), width, height, embedded },
    }
  } catch (error) {
    if (error instanceof Rejected) return { ok: false, reason: error.reason }
    throw error
  }
}

/** Читается ли строка строгим XML-парсером с пространствами имён */
function wellFormed(markup: string) {
  try {
    new SaxesParser({ xmlns: true, position: false }).write(markup).close()
    return true
  } catch {
    return false
  }
}

/** Корневой тег очищенного SVG: значения атрибутов экранированы, «>» внутри нет */
const ROOT_TAG = /^<svg\s[^>]*>/
const ROOT_WIDTH = / width="([^"]*)"/
const ROOT_HEIGHT = / height="([^"]*)"/

/**
 * Очищенный SVG для растеризации в квадрат size×size: у корня width и height в пикселях так, чтобы
 * большая сторона была size, а меньшая — не меньше 1 px. viewBox у очищенного файла есть всегда,
 * поэтому рисунок масштабируется сам. Файл не из sanitizeSvg (без числовых размеров у корня) —
 * как есть
 */
export function svgForRaster(data: Uint8Array, size: number) {
  const text = new TextDecoder().decode(data)
  const root = ROOT_TAG.exec(text)?.[0]
  const width = plainLength(root && ROOT_WIDTH.exec(root)?.[1])
  const height = plainLength(root && ROOT_HEIGHT.exec(root)?.[1])
  if (!root || !width || !height) return data
  const scale = size / Math.max(width, height)
  const pixels = (side: number) => String(Math.max(1, Math.round(side * scale)))
  const sized = root
    .replace(ROOT_WIDTH, ` width="${pixels(width)}"`)
    .replace(ROOT_HEIGHT, ` height="${pixels(height)}"`)
  return new TextEncoder().encode(sized + text.slice(root.length))
}
