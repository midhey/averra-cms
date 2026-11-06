// Контраст по WCAG 2.2 (1.4.3 и 1.4.11): относительная яркость sRGB и отношение (L1 + 0.05) /
// (L2 + 0.05). Одна функция на админку (живые отметки) и API (проверка при сохранении темы)

/** Цвет темы: строго #RRGGBB */
const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

function channels(hex: string): [number, number, number] {
  const match = HEX.exec(hex)
  if (!match) throw new Error(`Цвет не в формате #RRGGBB: ${hex}`)
  return [
    Number.parseInt(match[1] ?? '0', 16),
    Number.parseInt(match[2] ?? '0', 16),
    Number.parseInt(match[3] ?? '0', 16),
  ]
}

/** Относительная яркость цвета #RRGGBB: 0 — чёрный, 1 — белый */
export function relativeLuminance(hex: string) {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Отношение контраста двух цветов: от 1 (одинаковые) до 21 (чёрный на белом) */
export function contrastRatio(a: string, b: string) {
  const x = relativeLuminance(a)
  const y = relativeLuminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * Отношение для показа людям: одна цифра после запятой, округление вниз. Так 4,46 не покажется
 * как «4,5 · мало» — показанное число никогда не больше настоящего
 */
export function formatContrast(ratio: number) {
  return (Math.floor(ratio * 10) / 10).toFixed(1).replace('.', ',')
}

/**
 * Смесь двух цветов #RRGGBB: share — доля первого (0…1). Линии темы, если их не задали (тема до
 * роли «Линии»), — немного текста в фоне
 */
export function mixColors(a: string, b: string, share: number) {
  const x = channels(a)
  const y = channels(b)
  return `#${x
    .map((value, index) => {
      const mixed = Math.round(value * share + (y[index] ?? 0) * (1 - share))
      return mixed.toString(16).padStart(2, '0')
    })
    .join('')}`
}

/** Контраст текста кнопки — тот же, что тема проверяет у пары «текст на акценте» */
const BUTTON_TEXT_MIN = 4.5
/**
 * Насколько фон под курсором отличается от фона в покое. 1,15:1 — разницу видно на глаз на любом
 * цвете, а не только на светлом, как у прежнего brightness(1.08)
 */
export const HOVER_CONTRAST_MIN = 1.15

/**
 * Фон кнопки под курсором: base — фон кнопки, text — её текст. Сначала сдвиг к цвету текста
 * (тёмная кнопка со светлым текстом светлеет), пока текст читается не хуже 4,5:1; если так
 * нельзя — в обратную сторону, к чёрному или белому: контраст текста там только растёт. Шаг
 * подбирается, пока разница с покоем не станет заметной (HOVER_CONTRAST_MIN). Кнопка уже белая
 * (или чёрная), а текст на ней на пределе 4,5:1 — сдвигаться некуда, кроме как к тексту: тогда
 * текст под курсором не хуже 3:1. Это на миг наведения, а без заметной смены наведения не видно
 */
export function hoverColor(base: string, text: string) {
  for (const share of [0.12, 0.16, 0.2, 0.25, 0.3]) {
    const mixed = mixColors(text, base, share)
    if (
      contrastRatio(mixed, text) >= BUTTON_TEXT_MIN &&
      contrastRatio(mixed, base) >= HOVER_CONTRAST_MIN
    ) {
      return mixed
    }
  }
  const away = relativeLuminance(text) > relativeLuminance(base) ? '#000000' : '#ffffff'
  for (const share of [0.15, 0.2, 0.3, 0.4, 0.5, 0.6]) {
    const mixed = mixColors(away, base, share)
    if (contrastRatio(mixed, base) >= HOVER_CONTRAST_MIN) return mixed
  }
  for (const share of [0.06, 0.08, 0.1, 0.12, 0.16, 0.2]) {
    const mixed = mixColors(text, base, share)
    if (contrastRatio(mixed, base) >= HOVER_CONTRAST_MIN) return mixed
  }
  return mixColors(text, base, 0.2)
}

/**
 * Подложка пункта меню под курсором на фоне темы: «Поверхность», если она заметно отличается от
 * фона (HOVER_CONTRAST_MIN) и текст на ней читается; во многих темах «Поверхность» почти цвета
 * фона (бумага на бумаге, 1,07:1) — тогда сдвиг фона, как у кнопки (hoverColor)
 */
export function hoverBackground(colors: { background: string; surface: string; text: string }) {
  const { background, surface, text } = colors
  if (
    contrastRatio(surface, background) >= HOVER_CONTRAST_MIN &&
    contrastRatio(surface, text) >= BUTTON_TEXT_MIN
  ) {
    return surface
  }
  return hoverColor(background, text)
}

/**
 * Насколько цвет ссылки должен отличаться от цвета текста, чтобы её было видно без подчёркивания
 * (WCAG 1.4.1, техника G183)
 */
export const LINK_TEXT_CONTRAST_MIN = 3

/**
 * Подчёркивание пункта меню под курсором при наведении «Цвет акцента»: акцент заметно отличается
 * от текста — подчёркивание не нужно; почти того же цвета (тёмно-зелёный рядом с чернилами,
 * 1,25:1) — без подчёркивания наведения не видно, оно остаётся
 */
export const accentLinkLine = (accent: string, text: string) =>
  contrastRatio(accent, text) >= LINK_TEXT_CONTRAST_MIN ? 'none' : 'underline'
