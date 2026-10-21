import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { TextShaper, Weight } from './card'

// Golos Text из @fontsource/golos-text (OFL, шрифт админки) — контурами через opentype.js. Шрифт
// там разрезан на подмножества: латиница, кириллица и их расширения (казахский, турецкий…).
// Для каждой буквы берётся файл, где она есть; символ, которого нет нигде (эмодзи), пропускается.
//
// Раскладка своя, буква за буквой с кернингом пары из того же файла: getPath у opentype.js 2.0
// прогоняет строку через GSUB/GPOS и на некоторых парах («рт») выдаёт NaN в контурах — librsvg
// на таком пути обрывает рисунок. Лигатур и сложных начертаний в заголовке лендинга не нужно

const require = createRequire(import.meta.url)

type PathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' }
type Glyph = {
  advanceWidth?: number
  getPath(x: number, y: number, fontSize: number): { commands: PathCommand[] }
}
type Font = {
  unitsPerEm: number
  charToGlyphIndex(char: string): number
  charToGlyph(char: string): Glyph
  getKerningValue(left: Glyph, right: Glyph): number
}
type OpenType = { parse(buffer: ArrayBuffer): Font }

/** Порядок важен: буква берётся из первого файла, где она есть */
const SUBSETS = ['latin', 'cyrillic', 'latin-ext', 'cyrillic-ext'] as const

function loadFont(subset: (typeof SUBSETS)[number], weight: Weight): Font {
  const opentype = require('opentype.js') as OpenType
  const file = require.resolve(
    `@fontsource/golos-text/files/golos-text-${subset}-${weight}-normal.woff`,
  )
  const data = readFileSync(file)
  return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}

const fonts = new Map<Weight, Font[]>()
/** Файлы читаются один раз, при первой карточке */
function fontsOf(weight: Weight) {
  let loaded = fonts.get(weight)
  if (!loaded) {
    loaded = SUBSETS.map((subset) => loadFont(subset, weight))
    fonts.set(weight, loaded)
  }
  return loaded
}

type Placed = { font: Font; glyph: Glyph; kerning: number }

function glyphsOf(text: string, weight: Weight) {
  const placed: Placed[] = []
  let previous: { font: Font; glyph: Glyph } | undefined
  for (const char of text) {
    const font = fontsOf(weight).find((candidate) => candidate.charToGlyphIndex(char) > 0)
    if (!font) {
      previous = undefined
      continue
    }
    const glyph = font.charToGlyph(char)
    const kerning = previous?.font === font ? font.getKerningValue(previous.glyph, glyph) : 0
    placed.push({ font, glyph, kerning: Number.isFinite(kerning) ? kerning : 0 })
    previous = { font, glyph }
  }
  return placed
}

const round = (value: number) => Math.round(value * 10) / 10

/** Команды контура → d для SVG. Нечисловая координата выкидывает команду, а не весь рисунок */
function pathData(commands: readonly PathCommand[]) {
  return commands
    .map((command) => {
      const numbers =
        command.type === 'Z'
          ? []
          : command.type === 'Q'
            ? [command.x1, command.y1, command.x, command.y]
            : command.type === 'C'
              ? [command.x1, command.y1, command.x2, command.y2, command.x, command.y]
              : [command.x, command.y]
      if (!numbers.every(Number.isFinite)) return ''
      return `${command.type}${numbers.map(round).join(' ')}`
    })
    .join('')
}

/** Golos Text для карточек: ширина строки и её контуры */
export const golosShaper: TextShaper = {
  width(text, size, weight) {
    return glyphsOf(text, weight).reduce(
      (sum, { font, glyph, kerning }) =>
        sum + ((glyph.advanceWidth ?? 0) + kerning) * (size / font.unitsPerEm),
      0,
    )
  },
  path(text, x, y, size, weight) {
    let cursor = x
    let d = ''
    for (const { font, glyph, kerning } of glyphsOf(text, weight)) {
      const scale = size / font.unitsPerEm
      cursor += kerning * scale
      d += pathData(glyph.getPath(cursor, y, size).commands)
      cursor += (glyph.advanceWidth ?? 0) * scale
    }
    return d
  },
}
