import { coverScrim, defaultTheme, Theme } from '@averra/schema'
import { fontCatalog, fontStack } from './fonts'

export {
  allFontFiles,
  type FontFile,
  fontCatalog,
  fontFaceCss,
  fontStack,
  themeFontFiles,
} from './fonts'

/** Тема нового сайта — из @averra/schema: схема и её значения по умолчанию живут вместе */
export { defaultTheme }

const radii: Record<Theme['radius'], string> = {
  none: '0',
  small: '4px',
  medium: '8px',
  large: '16px',
}

// Шкалы отступов и размеров текста общие для всех сайтов: тема их не меняет, так сохраняется ритм
const scales = {
  '--space-1': '0.25rem',
  '--space-2': '0.5rem',
  '--space-3': '0.75rem',
  '--space-4': '1rem',
  '--space-6': '1.5rem',
  '--space-8': '2rem',
  '--space-12': '3rem',
  '--space-16': '4rem',
  '--text-sm': '0.875rem',
  '--text-base': '1rem',
  '--text-lg': '1.125rem',
  '--text-xl': 'clamp(1.25rem, 1.1rem + 0.6vw, 1.5rem)',
  '--text-2xl': 'clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem)',
  '--text-3xl': 'clamp(2.25rem, 1.6rem + 3vw, 3.75rem)',
  '--container': '72rem',
}

/** Тема целиком — одна строка CSS-переменных для <style> в <head> */
export function themeToCss(theme: Theme): string {
  // Строка уходит в страницу как есть, поэтому тему ещё раз проверяем схемой
  const { colors, fonts, radius } = Theme.parse(theme)
  const vars = {
    ...scales,
    '--color-background': colors.background,
    '--color-surface': colors.surface,
    '--color-text': colors.text,
    '--color-muted': colors.muted,
    '--color-accent': colors.accent,
    '--color-on-accent': colors.onAccent,
    '--color-border': colors.border,
    // Затемнение фото «Первого экрана» на фото: посчитано так, чтобы текст читался над любым фото
    '--cover-scrim': String(coverScrim(colors)),
    '--font-heading': fontStack(fonts.heading),
    '--font-body': fontStack(fonts.body),
    // Акцентный шрифт (рукописные подписи, цифры): не выбран — как у заголовков
    '--font-accent': fonts.accent ? fontStack(fonts.accent) : 'var(--font-heading)',
    '--font-heading-weight': String(fontCatalog[fonts.heading].headingWeight),
    '--radius': radii[radius],
  }
  const declarations = Object.entries(vars).map(([name, value]) => `${name}:${value}`)
  return `:root{${declarations.join(';')}}`
}
