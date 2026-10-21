import type { OgCard } from '@averra/schema'
import { concurrencyLimit } from '../media/processor'

// Карточка для соцсетей из заголовка страницы: PNG 1200 × 630, когда у страницы и у сайта нет
// своей картинки. Здесь — раскладка и SVG без Node API: текст превращает в контуры TextShaper
// (golos.ts), растр делает sharp (sharp-og.ts). В SVG нет ни одного <text>: только контуры букв,
// поэтому картинка одна и та же на любой машине и не зависит от шрифтов в системе

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

/** Начертания Golos Text: заголовок и название сайта — 600, домен — 400 */
export type Weight = 400 | 600

/** Ширина и контуры строки шрифтом Golos Text */
export type TextShaper = {
  width(text: string, size: number, weight: Weight): number
  /** Данные пути SVG (d) строки с базовой линией в y */
  path(text: string, x: number, y: number, size: number, weight: Weight): string
}

const PADDING = 80
const TEXT_WIDTH = OG_WIDTH - PADDING * 2
/** Кегли заголовка по убыванию: берётся самый крупный, при котором всё влезает в MAX_LINES */
const SMALLEST_TITLE = 52
export const TITLE_SIZES = [72, 60, SMALLEST_TITLE] as const
export const MAX_LINES = 3
const LINE_HEIGHT = 1.15
const FOOTER_SIZE = 30
const ELLIPSIS = '…'

/** Режет слово, которое шире строки, на куски по ширине строки */
function splitLongWord(word: string, size: number, shaper: TextShaper) {
  const pieces: string[] = []
  let piece = ''
  for (const char of word) {
    if (piece !== '' && shaper.width(piece + char, size, 600) > TEXT_WIDTH) {
      pieces.push(piece)
      piece = char
    } else {
      piece += char
    }
  }
  if (piece !== '') pieces.push(piece)
  return pieces
}

/** Строки заголовка: перенос по словам, слишком длинное слово — по буквам */
function wrap(text: string, size: number, shaper: TextShaper) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    for (const piece of shaper.width(word, size, 600) > TEXT_WIDTH
      ? splitLongWord(word, size, shaper)
      : [word]) {
      const next = line === '' ? piece : `${line} ${piece}`
      if (line !== '' && shaper.width(next, size, 600) > TEXT_WIDTH) {
        lines.push(line)
        line = piece
      } else {
        line = next
      }
    }
  }
  if (line !== '') lines.push(line)
  return lines
}

/** Строка с многоточием в конце, чтобы влезла в ширину */
function withEllipsis(line: string, size: number, weight: Weight, shaper: TextShaper) {
  let text = line.trimEnd()
  while (text !== '' && shaper.width(`${text}${ELLIPSIS}`, size, weight) > TEXT_WIDTH) {
    text = [...text].slice(0, -1).join('').trimEnd()
  }
  return `${text}${ELLIPSIS}`
}

/**
 * Раскладка заголовка: самый крупный кегль из TITLE_SIZES, при котором заголовок влезает в
 * MAX_LINES строк. Не влезает и в самом мелком — последняя строка кончается многоточием
 */
export function layoutTitle(title: string, shaper: TextShaper) {
  const text = title.replace(/\s+/g, ' ').trim()
  for (const size of TITLE_SIZES) {
    const lines = wrap(text, size, shaper)
    if (lines.length <= MAX_LINES) return { size, lines }
  }
  const size = SMALLEST_TITLE
  const lines = wrap(text, size, shaper).slice(0, MAX_LINES)
  const last = lines.length - 1
  lines[last] = withEllipsis(lines[last] ?? '', size, 600, shaper)
  return { size, lines }
}

/** Подпись внизу: название сайта и домен; длинное название режется многоточием */
function footer(card: OgCard, shaper: TextShaper) {
  const domain = card.domain ? ` · ${card.domain}` : ''
  const domainWidth = shaper.width(domain, FOOTER_SIZE, 400)
  let name = card.siteName
  if (shaper.width(name, FOOTER_SIZE, 600) + domainWidth > TEXT_WIDTH) {
    while (
      name !== '' &&
      shaper.width(`${name}${ELLIPSIS}`, FOOTER_SIZE, 600) + domainWidth > TEXT_WIDTH
    ) {
      name = [...name].slice(0, -1).join('').trimEnd()
    }
    name = `${name}${ELLIPSIS}`
  }
  return { name, domain, nameWidth: shaper.width(name, FOOTER_SIZE, 600) }
}

/**
 * SVG карточки: фон темы, полоска акцента, заголовок цветом текста и внизу название сайта с
 * доменом. Цвета — #RRGGBB из темы (их проверила схема темы), текста в SVG нет — только контуры
 */
export function ogCardSvg(card: OgCard, shaper: TextShaper) {
  const { colors } = card
  const { size, lines } = layoutTitle(card.title, shaper)
  const firstBaseline = 168 + size
  const title = lines
    .map((line, index) =>
      shaper.path(line, PADDING, firstBaseline + index * size * LINE_HEIGHT, size, 600),
    )
    .join('')
  const bottom = OG_HEIGHT - PADDING
  const { name, domain, nameWidth } = footer(card, shaper)
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${colors.background}"/>`,
    `<rect x="${PADDING}" y="${PADDING}" width="96" height="10" rx="5" fill="${colors.accent}"/>`,
    `<path fill="${colors.text}" d="${title}"/>`,
    `<path fill="${colors.text}" d="${shaper.path(name, PADDING, bottom, FOOTER_SIZE, 600)}"/>`,
  ]
  if (domain) {
    const d = shaper.path(domain, PADDING + nameWidth, bottom, FOOTER_SIZE, 400)
    parts.push(`<path fill="${colors.muted}" d="${d}"/>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

/**
 * Сколько готовых карточек держать в памяти. Опубликованных — с запасом на все страницы
 * лендинга (PNG карточки — десятки КБ): перебор адресов не заставит рисовать их заново.
 * Предпросмотров — меньше: их просят по мере правки заголовка, и старые не нужны
 */
export const PUBLISHED_CACHE_SIZE = 256
export const PREVIEW_CACHE_SIZE = 32
/**
 * Сколько предпросмотров может ждать отрисовки разом. Админка просит карточку, когда заголовок
 * перестали набирать, — это одна-две в очереди. Больше — кто-то шлёт заголовки потоком: такие
 * запросы получают отказ, а не очередь до бесконечности
 */
export const PREVIEW_MAX_PENDING = 4

export type RenderOgCard = (card: OgCard) => Promise<Uint8Array>

/** Отказ предпросмотра: очередь отрисовки полна (маршрут отвечает 429) */
export class OgCardsBusy extends Error {
  constructor() {
    super('Карточек рисуется слишком много')
  }
}

type Queue = ReturnType<typeof concurrencyLimit>

/**
 * Карточки с кешем в памяти и общей очередью. Ключ — всё, что нарисовано на карточке.
 * maxPending — сколько отрисовок может ждать: сверх того — OgCardsBusy, а не очередь
 */
export function cachedOgCards(
  render: RenderOgCard,
  {
    queue = concurrencyLimit(1),
    cacheSize = PUBLISHED_CACHE_SIZE,
    maxPending = Number.POSITIVE_INFINITY,
  }: { queue?: Queue; cacheSize?: number; maxPending?: number } = {},
) {
  const cache = new Map<string, Promise<Uint8Array>>()
  let pending = 0
  return (card: OgCard) => {
    const key = JSON.stringify(card)
    const cached = cache.get(key)
    if (cached) {
      // Свежая — в конец: вытесняется давно не нужная
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }
    if (pending >= maxPending) return Promise.reject(new OgCardsBusy())
    pending += 1
    const rendering = queue(() => render(card)).finally(() => {
      pending -= 1
    })
    cache.set(key, rendering)
    // Сбой не запоминаем: следующий запрос попробует снова
    rendering.catch(() => cache.delete(key))
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return rendering
  }
}

/**
 * Карточки для API, как иконки сайта: одновременно рисуется одна (сервер у клиента маленький).
 * Кеши у опубликованных и предпросмотров раздельные: заголовки, которые шлют в предпросмотр,
 * не вытесняют карточки сайта, и открытый адрес карточки не гоняет отрисовку заново
 */
export function ogCardRenderers(render: RenderOgCard) {
  const queue = concurrencyLimit(1)
  return {
    /** Карточки опубликованных страниц: их берёт сборка сайта по открытому адресу */
    published: cachedOgCards(render, { queue, cacheSize: PUBLISHED_CACHE_SIZE }),
    /** Предпросмотр черновика в админке: заголовок любой, поэтому очередь ограничена */
    preview: cachedOgCards(render, {
      queue,
      cacheSize: PREVIEW_CACHE_SIZE,
      maxPending: PREVIEW_MAX_PENDING,
    }),
  }
}

export type OgCardRenderers = ReturnType<typeof ogCardRenderers>
