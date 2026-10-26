import { z } from 'zod'
import { contrastRatio, formatContrast, mixColors, relativeLuminance } from './contrast'

// Строго #RRGGBB: значения темы попадают прямо в CSS страницы, поэтому произвольную строку
// (например, с `}</style>`) сюда не пропускаем
export const ThemeColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'Цвет в формате #RRGGBB')

/**
 * Шрифты темы. Системные (system, humanist, serif) — стеки шрифтов устройства, без загрузки: с них
 * темы начинались, и сайты на них остаются как были. Остальные — свои файлы с кириллицей (OFL) со
 * своего сервера сайта; что именно грузится, решает @averra/tokens (каталог шрифтов)
 */
export const themeFontIds = [
  'golos-text',
  'manrope',
  'inter',
  'montserrat',
  'unbounded',
  'lora',
  'pt-serif',
  'system',
  'humanist',
  'serif',
] as const
export const ThemeFont = z.enum(themeFontIds)
export type ThemeFont = z.infer<typeof ThemeFont>

export const themeFontTitles: Record<ThemeFont, string> = {
  'golos-text': 'Golos Text',
  manrope: 'Manrope',
  inter: 'Inter',
  montserrat: 'Montserrat',
  unbounded: 'Unbounded',
  lora: 'Lora',
  'pt-serif': 'PT Serif',
  system: 'Системный',
  humanist: 'Системный гуманистический',
  serif: 'Системный с засечками',
}

/** Системные шрифты: файлов нет, сайт берёт шрифт устройства */
export const systemThemeFonts: ReadonlySet<ThemeFont> = new Set(['system', 'humanist', 'serif'])

export const ThemeRadius = z.enum(['none', 'small', 'medium', 'large'])
export type ThemeRadius = z.infer<typeof ThemeRadius>
export const themeRadiusTitles: Record<ThemeRadius, string> = {
  none: 'Нет',
  small: 'Малые',
  medium: 'Средние',
  large: 'Большие',
}

export const ThemeColors = z.strictObject({
  background: ThemeColor.meta({ title: 'Фон' }),
  surface: ThemeColor.meta({ title: 'Поверхность' }),
  text: ThemeColor.meta({ title: 'Текст' }),
  muted: ThemeColor.meta({ title: 'Приглушённый текст' }),
  accent: ThemeColor.meta({ title: 'Акцент' }),
  onAccent: ThemeColor.meta({ title: 'Текст на акценте' }),
  border: ThemeColor.meta({ title: 'Линии' }),
})
export type ThemeColors = z.infer<typeof ThemeColors>
export type ThemeColorRole = keyof ThemeColors
export const themeColorRoles = Object.keys(ThemeColors.shape) as ThemeColorRole[]

/** Подписи ролей для людей: где цвет встречается на сайте */
export const themeColorTitles: Record<ThemeColorRole, string> = {
  background: 'Фон',
  surface: 'Поверхность (карточки, полосы)',
  text: 'Текст',
  muted: 'Приглушённый текст',
  accent: 'Акцент (кнопки, ссылки)',
  onAccent: 'Текст на акценте',
  border: 'Линии и рамки',
}

export const Theme = z.strictObject({
  colors: ThemeColors,
  fonts: z.strictObject({
    heading: ThemeFont.meta({ title: 'Шрифт заголовков', 'x-enum-titles': themeFontTitles }),
    body: ThemeFont.meta({ title: 'Шрифт текста', 'x-enum-titles': themeFontTitles }),
  }),
  radius: ThemeRadius.default('medium').meta({
    title: 'Скругления',
    'x-enum-titles': themeRadiusTitles,
  }),
})
export type Theme = z.infer<typeof Theme>

/**
 * Пары цветов, которые проверяются на контраст. blocking — без них тему не сохранить: на этих
 * парах держится чтение страниц и работа с клавиатуры. Текст и приглушённый текст стоят и на фоне,
 * и на поверхности (полосы «Преимуществ», блок «Призыв» с подзаголовком приглушённым), кнопки —
 * акцент с текстом на акценте, ссылки — акцент на фоне. Акцент на поверхности — заливка кнопок,
 * включённый переключатель окна cookie и рамка фокуса (:focus-visible в base.css) вокруг кнопки
 * «Призыва» и вопросов FAQ: бледный акцент там прячет, где фокус клавиатуры. Пороги — WCAG 2.2 AA:
 * 4,5 для текста, 3 для акцента — ссылки и элементы интерфейса (1.4.11) и крупный текст. Поле
 * blocking оставлено: пара-предупреждение — законный случай, экран умеет их показывать. Почему
 * так — «Решения → Тема сайта и контраст»
 */
export const contrastPairs = [
  {
    id: 'text-background',
    label: 'Текст на фоне',
    foreground: 'text',
    background: 'background',
    min: 4.5,
    blocking: true,
  },
  {
    id: 'text-surface',
    label: 'Текст на поверхности',
    foreground: 'text',
    background: 'surface',
    min: 4.5,
    blocking: true,
  },
  {
    id: 'muted-background',
    label: 'Приглушённый текст на фоне',
    foreground: 'muted',
    background: 'background',
    min: 4.5,
    blocking: true,
  },
  {
    id: 'muted-surface',
    label: 'Приглушённый текст на поверхности',
    foreground: 'muted',
    background: 'surface',
    min: 4.5,
    blocking: true,
  },
  {
    id: 'on-accent',
    label: 'Текст на акценте (кнопки)',
    foreground: 'onAccent',
    background: 'accent',
    min: 4.5,
    blocking: true,
  },
  {
    id: 'accent-background',
    label: 'Акцент на фоне (ссылки)',
    foreground: 'accent',
    background: 'background',
    min: 3,
    blocking: true,
  },
  {
    id: 'accent-surface',
    label: 'Акцент на поверхности (кнопки, фокус)',
    foreground: 'accent',
    background: 'surface',
    min: 3,
    blocking: true,
  },
] as const satisfies ReadonlyArray<{
  id: string
  label: string
  foreground: ThemeColorRole
  background: ThemeColorRole
  min: number
  blocking: boolean
}>

// blocking — просто boolean: сейчас все пары блокируют, но экран и тесты умеют и предупреждение
export type ContrastPair = Omit<(typeof contrastPairs)[number], 'blocking'> & { blocking: boolean }
export type ContrastCheck = ContrastPair & { ratio: number; ok: boolean }

/** Все проверяемые пары темы с отношением контраста и итогом */
export function themeContrast(colors: ThemeColors): ContrastCheck[] {
  return contrastPairs.map((pair) => {
    const ratio = contrastRatio(colors[pair.foreground], colors[pair.background])
    return { ...pair, ratio, ok: ratio >= pair.min }
  })
}

/** «Акцент на фоне (ссылки): контраст 2,8 — нужно не меньше 3» */
export function contrastMessage(check: ContrastCheck) {
  return `${check.label}: контраст ${formatContrast(check.ratio)} — нужно не меньше ${formatContrast(check.min)}`
}

/**
 * Тема на сохранение (админка и API): та же схема плюс контраст основных пар. Ошибка встаёт у
 * цвета текста пары — его обычно и меняют
 */
export const ThemeInput = Theme.superRefine((theme, ctx) => {
  // Zod зовёт проверку и тогда, когда сами поля не прошли: кривой цвет уже получил свою ошибку,
  // а считать по нему контраст нечего
  if (!ThemeColors.safeParse(theme.colors).success) return
  for (const check of themeContrast(theme.colors)) {
    if (!check.blocking || check.ok) continue
    ctx.addIssue({
      code: 'custom',
      path: ['colors', check.foreground],
      message: contrastMessage(check),
    })
  }
})

/** Контраст текста на затемнённом фото: 4,5 по WCAG и запас на округление смешения в браузере */
const COVER_CONTRAST = 4.6

/**
 * Затемнение фото у «Первого экрана» на фото (cover) — непрозрачность слоя цвета текста темы над
 * фото, 0…1. Текст поверх — цветом фона темы. Фото может быть любым, поэтому считаем худший
 * случай: под слоем самый светлый пиксель (белый, если текст поверх светлый) или самый тёмный.
 * Берём наименьшую непрозрачность, при которой и тогда контраст не меньше 4,5 (с запасом на
 * округление браузера). Слой цвета текста целиком (1) — это пара «текст на фоне», она уже
 * проверена темой: так ответ есть у любой темы
 */
export function coverScrim(colors: Pick<ThemeColors, 'text' | 'background'>) {
  const light = relativeLuminance(colors.background)
  const lightOnPhoto = light > relativeLuminance(colors.text)
  const extreme = lightOnPhoto ? '#ffffff' : '#000000'
  for (let step = 0; step < 100; step += 1) {
    const share = step / 100
    const under = relativeLuminance(mixColors(colors.text, extreme, share))
    // Слой должен увести фото от цвета текста поверх, а не только отличаться от него
    const away = lightOnPhoto ? under < light : under > light
    const ratio = (Math.max(under, light) + 0.05) / (Math.min(under, light) + 0.05)
    if (away && ratio >= COVER_CONTRAST) return share
  }
  return 1
}

/** Линии темы, у которой их нет (тема до роли «Линии»): немного текста в фоне */
export const derivedBorder = (colors: Pick<ThemeColors, 'text' | 'background'>) =>
  mixColors(colors.text, colors.background, 0.15)

/** Тема нового сайта и запасные значения для темы, записанной непонятно */
export const defaultTheme: Theme = {
  colors: {
    background: '#ffffff',
    surface: '#f4f5f7',
    text: '#16181d',
    muted: '#5b6170',
    accent: '#2f5bea',
    onAccent: '#ffffff',
    border: derivedBorder({ text: '#16181d', background: '#ffffff' }),
  },
  fonts: { heading: 'system', body: 'system' },
  radius: 'medium',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Тема из базы — с запасом на другие версии. Тема до этого шага (без линий) получает линии из
 * текста и фона; незнакомые ключи отбрасываются; поле с непонятным значением (шрифт, которого эта
 * версия не знает, — его выбрали в более новой, а установку откатили) читается значением по
 * умолчанию, о нём сообщает onInvalid. В базе тема остаётся как была
 */
export function readTheme(stored: unknown, onInvalid?: (field: string) => void): Theme {
  const theme = isRecord(stored) ? stored : {}
  const colors = isRecord(theme.colors) ? theme.colors : {}
  const fonts = isRecord(theme.fonts) ? theme.fonts : {}
  const color = (role: Exclude<ThemeColorRole, 'border'>) => {
    const parsed = ThemeColor.safeParse(colors[role])
    if (parsed.success) return parsed.data
    onInvalid?.(`colors.${role}`)
    return defaultTheme.colors[role]
  }
  const background = color('background')
  const text = color('text')
  const border = ThemeColor.safeParse(colors.border)
  if (!border.success && colors.border !== undefined) onInvalid?.('colors.border')
  const font = (role: 'heading' | 'body') => {
    const parsed = ThemeFont.safeParse(fonts[role])
    if (parsed.success) return parsed.data
    onInvalid?.(`fonts.${role}`)
    return defaultTheme.fonts[role]
  }
  const radius = ThemeRadius.safeParse(theme.radius ?? 'medium')
  if (!radius.success) onInvalid?.('radius')
  return {
    colors: {
      background,
      surface: color('surface'),
      text,
      muted: color('muted'),
      accent: color('accent'),
      onAccent: color('onAccent'),
      border: border.success ? border.data : derivedBorder({ text, background }),
    },
    fonts: { heading: font('heading'), body: font('body') },
    radius: radius.success ? radius.data : defaultTheme.radius,
  }
}

/** Тема в формате до редактора тем: шесть цветов и системные шрифты */
export type LegacyTheme = {
  colors: Omit<ThemeColors, 'border'>
  fonts: { heading: 'system' | 'humanist' | 'serif'; body: 'system' | 'humanist' | 'serif' }
  radius: ThemeRadius
}

const legacyFont = (font: ThemeFont): LegacyTheme['fonts']['body'] => {
  if (font === 'system' || font === 'humanist' || font === 'serif') return font
  return font === 'lora' || font === 'pt-serif' ? 'serif' : 'system'
}

/**
 * Опубликованная тема в прежнем формате — для колонки sites.theme. Её строго читает версия до
 * редактора тем: после отката она соберёт сайт в тех же цветах, а свой шрифт заменит ближайшим
 * системным
 */
export function legacyTheme(theme: Theme): LegacyTheme {
  const { border: _border, ...colors } = theme.colors
  return {
    colors,
    fonts: { heading: legacyFont(theme.fonts.heading), body: legacyFont(theme.fonts.body) },
    radius: theme.radius,
  }
}

/** Темы одинаковы: те же цвета (без учёта регистра), шрифты и скругления */
export function sameTheme(a: Theme, b: Theme) {
  return (
    themeColorRoles.every(
      (role) => a.colors[role].toLowerCase() === b.colors[role].toLowerCase(),
    ) &&
    a.fonts.heading === b.fonts.heading &&
    a.fonts.body === b.fonts.body &&
    a.radius === b.radius
  )
}
