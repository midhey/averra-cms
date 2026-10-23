import type { Theme, ThemeFont } from '@averra/schema'

// Каталог шрифтов темы: какой файл грузить и чем подстраховать, пока он не пришёл. Свои шрифты —
// из npm-пакетов @fontsource (OFL), только WOFF2, кириллица и латиница (и знак рубля): файлы раздаёт
// сервер сайта, Google Fonts сайт не трогает. Как добавить шрифт — «Разработчику → Стили»

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const SERIF = 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif'

type SystemFont = { kind: 'system'; stack: string; headingWeight: number }

type HostedFont = {
  kind: 'hosted'
  /** Имя семейства в @font-face и font-family */
  family: string
  /** Пакет @fontsource: файлы — <пакет>/files/<prefix>-<подмножество>-<вес>-normal.woff2 */
  package: string
  prefix: string
  fallback: string
  /** Вес заголовков: у широких и с засечками жирнее 600 не нужно */
  headingWeight: number
  /** Жирный в тексте (кнопки, подписи полей): у PT Serif нет 600 — берём 700 */
  boldWeight: number
}

export const fontCatalog: Record<ThemeFont, SystemFont | HostedFont> = {
  'golos-text': {
    kind: 'hosted',
    family: 'Golos Text',
    package: '@fontsource/golos-text',
    prefix: 'golos-text',
    fallback: SANS,
    headingWeight: 600,
    boldWeight: 600,
  },
  manrope: {
    kind: 'hosted',
    family: 'Manrope',
    package: '@fontsource/manrope',
    prefix: 'manrope',
    fallback: SANS,
    headingWeight: 700,
    boldWeight: 600,
  },
  inter: {
    kind: 'hosted',
    family: 'Inter',
    package: '@fontsource/inter',
    prefix: 'inter',
    fallback: SANS,
    headingWeight: 700,
    boldWeight: 600,
  },
  montserrat: {
    kind: 'hosted',
    family: 'Montserrat',
    package: '@fontsource/montserrat',
    prefix: 'montserrat',
    fallback: SANS,
    headingWeight: 700,
    boldWeight: 600,
  },
  unbounded: {
    kind: 'hosted',
    family: 'Unbounded',
    package: '@fontsource/unbounded',
    prefix: 'unbounded',
    fallback: SANS,
    headingWeight: 600,
    boldWeight: 600,
  },
  lora: {
    kind: 'hosted',
    family: 'Lora',
    package: '@fontsource/lora',
    prefix: 'lora',
    fallback: SERIF,
    headingWeight: 600,
    boldWeight: 600,
  },
  'pt-serif': {
    kind: 'hosted',
    family: 'PT Serif',
    package: '@fontsource/pt-serif',
    prefix: 'pt-serif',
    fallback: SERIF,
    headingWeight: 700,
    boldWeight: 700,
  },
  system: { kind: 'system', stack: SANS, headingWeight: 700 },
  humanist: {
    kind: 'system',
    stack: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif',
    headingWeight: 700,
  },
  serif: { kind: 'system', stack: SERIF, headingWeight: 700 },
}

/** Значение font-family: своё семейство и запасные шрифты устройства */
export function fontStack(font: ThemeFont) {
  const entry = fontCatalog[font]
  return entry.kind === 'system' ? entry.stack : `"${entry.family}", ${entry.fallback}`
}

/**
 * Диапазоны подмножеств — как у Fontsource: кириллица и латиница, без греческого. Знак рубля ₽
 * (U+20BD) у Fontsource лежит только в latin-ext: этот файл подключаем с диапазоном из одного ₽ —
 * браузер скачает его, только когда на странице есть цена в рублях, а без него ₽ рисовался бы
 * системным шрифтом, тоньше и уже соседних цифр. Файл — весь latin-ext: 7–50 КБ на начертание
 * (у Unbounded ~48 КБ). Подмножество с одним ₽ пришлось бы собирать и пересобирать с каждым
 * обновлением Fontsource — компромисс описан в «Решения → Тема сайта и контраст»
 */
const subsets = {
  cyrillic: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+20BD',
} as const
type Subset = keyof typeof subsets

/** Одно начертание одного подмножества — один файл WOFF2 */
export type FontFile = {
  family: string
  weight: number
  subset: Subset
  unicodeRange: string
  /** Пакет и имя файла в нём: <package>/files/<file> */
  package: string
  file: string
}

function filesOf(entry: HostedFont, weights: Iterable<number>): FontFile[] {
  return [...new Set(weights)]
    .sort((a, b) => a - b)
    .flatMap((weight) =>
      (Object.keys(subsets) as Subset[]).map((subset) => ({
        family: entry.family,
        weight,
        subset,
        unicodeRange: subsets[subset],
        package: entry.package,
        file: `${entry.prefix}-${subset}-${weight}-normal.woff2`,
      })),
    )
}

/**
 * Файлы шрифтов темы — только нужные начертания: тексту обычный и жирный, заголовкам свой вес.
 * Один шрифт на оба места — одни и те же файлы, без повторов
 */
export function themeFontFiles(theme: Theme): FontFile[] {
  const weights = new Map<ThemeFont, Set<number>>()
  const need = (font: ThemeFont, ...values: number[]) => {
    const entry = fontCatalog[font]
    if (entry.kind === 'system') return
    const set = weights.get(font) ?? new Set<number>()
    for (const value of values) set.add(value)
    weights.set(font, set)
  }
  const body = fontCatalog[theme.fonts.body]
  need(theme.fonts.body, 400, body.kind === 'hosted' ? body.boldWeight : 600)
  need(theme.fonts.heading, fontCatalog[theme.fonts.heading].headingWeight)
  return [...weights].flatMap(([font, set]) => {
    const entry = fontCatalog[font]
    return entry.kind === 'hosted' ? filesOf(entry, set) : []
  })
}

/** Все файлы каталога: их подключает предпросмотр админки (грузятся только используемые) */
export function allFontFiles(): FontFile[] {
  return Object.values(fontCatalog).flatMap((entry) =>
    entry.kind === 'hosted' ? filesOf(entry, [400, entry.boldWeight, entry.headingWeight]) : [],
  )
}

/** @font-face для файлов шрифтов; url — где файл лежит на сайте или в админке */
export function fontFaceCss<F extends FontFile>(files: readonly F[], url: (file: F) => string) {
  return files
    .map(
      (file) =>
        `@font-face{font-family:"${file.family}";font-style:normal;font-weight:${file.weight};` +
        `font-display:swap;src:url("${url(file)}") format("woff2");unicode-range:${file.unicodeRange}}`,
    )
    .join('')
}
