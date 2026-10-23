import {
  type ContrastCheck,
  type ContrastPair,
  formatContrast,
  systemThemeFonts,
  type Theme,
  type ThemeColorRole,
  ThemeColors,
  type ThemeFont,
  themeContrast,
  themeFontIds,
  themeFontTitles,
} from '@averra/schema'
import type { StatusTone } from '../ui/StatusPill'

/** Тема в форме экрана: цвета — как их набрали (могут быть недописаны), остальное — выбор */
export type ThemeForm = {
  colors: Record<ThemeColorRole, string>
  fonts: Theme['fonts']
  radius: Theme['radius']
}

export const formOf = (theme: Theme): ThemeForm => ({
  colors: { ...theme.colors },
  fonts: { ...theme.fonts },
  radius: theme.radius,
})

/**
 * Цвет, как его набрали, — к виду #rrggbb, если это можно сделать без догадок: без решётки
 * («2f5bea»), коротко («#fff»), заглавными. Остальное — как есть: ошибку покажет схема
 */
export function normalizeHex(value: string) {
  const raw = value.trim().toLowerCase()
  const hex = raw.startsWith('#') ? raw.slice(1) : raw
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((digit) => digit + digit).join('')}`
  return value
}

/** Тема из формы, если все цвета дописаны (#RRGGBB). Контраст здесь не проверяется */
export function themeOf(form: ThemeForm): Theme | undefined {
  const colors = ThemeColors.safeParse(form.colors)
  return colors.success
    ? { colors: colors.data, fonts: form.fonts, radius: form.radius }
    : undefined
}

/** Проверка, которую показывает строка цвета: главная пара, где этот цвет участвует */
export const roleCheck: Record<ThemeColorRole, ContrastPair['id'] | null> = {
  background: 'text-background',
  surface: 'text-surface',
  text: 'text-background',
  muted: 'muted-background',
  accent: 'accent-background',
  onAccent: 'on-accent',
  // Линии декоративные: рамки карточек «Преимуществ» и окон cookie. Рамки полей формы —
  // приглушённым цветом: им нужен контраст 3:1
  border: null,
}

/** Проверки контраста формы; пусто, пока какой-то цвет не дописан */
export function checksOf(form: ThemeForm): ContrastCheck[] {
  const theme = themeOf(form)
  return theme ? themeContrast(theme.colors) : []
}

/** «7,1 · ок», «2,8 · мало» */
export const contrastText = (check: ContrastCheck) =>
  `${formatContrast(check.ratio)} · ${check.ok ? 'ок' : 'мало'}`

/** Мало у блокирующей пары — ошибка, у предупреждающей — предупреждение */
export const contrastTone = (check: ContrastCheck): StatusTone =>
  check.ok ? 'success' : check.blocking ? 'danger' : 'warning'

/** Шрифты для выбора: свои (с сервера сайта) и системные — двумя группами */
export const fontGroups: ReadonlyArray<{ label: string; fonts: ThemeFont[] }> = [
  {
    label: 'Свои шрифты, с кириллицей',
    fonts: themeFontIds.filter((font) => !systemThemeFonts.has(font)),
  },
  { label: 'Шрифты устройства', fonts: themeFontIds.filter((font) => systemThemeFonts.has(font)) },
]

export const fontTitle = (font: ThemeFont) => themeFontTitles[font]

/** Состояние темы словами: что с правками и что на сайте */
export function themeStatus({ unsaved, unpublished }: { unsaved: boolean; unpublished: boolean }): {
  tone: StatusTone
  text: string
} {
  if (unsaved) return { tone: 'warning', text: 'Не сохранено' }
  if (unpublished) return { tone: 'info', text: 'Сохранено · не опубликовано' }
  return { tone: 'success', text: 'Опубликована' }
}

/**
 * Куда поставить фокус, когда тему не дали сохранить. Ошибка контраста встаёт у цвета текста
 * пары, а человек мог менять другой её цвет — акцент под белой надписью или фон под текстом.
 * Тогда фокус — на тот цвет, что меняли последним (его отметка «мало» рядом), иначе — на первую
 * ошибку
 */
export function refusedField(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>,
  checks: readonly ContrastCheck[],
  lastColor: ThemeColorRole | undefined,
): string | undefined {
  const paths = issues.map((issue) => issue.path.map(String).join('.'))
  if (lastColor) {
    const own = `colors.${lastColor}`
    const failing = checks.some(
      (check) =>
        check.blocking &&
        !check.ok &&
        (check.foreground === lastColor || check.background === lastColor),
    )
    if (paths.includes(own) || failing) return own
  }
  return paths[0]
}
