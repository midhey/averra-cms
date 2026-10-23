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
