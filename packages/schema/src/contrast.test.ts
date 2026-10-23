import { describe, expect, it } from 'vitest'
import { contrastRatio, formatContrast, mixColors, relativeLuminance } from './contrast'
import { contrastPairs, ThemeInput, themeContrast } from './theme'
import { themePresets } from './theme-presets'

describe('contrastRatio — WCAG 2.2', () => {
  it('крайние значения: чёрный на белом 21, цвет сам с собой 1, порядок не важен', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#2f5bea', '#2F5BEA')).toBe(1)
    expect(relativeLuminance('#ffffff')).toBe(1)
    expect(relativeLuminance('#000000')).toBe(0)
  })

  it('граница 4,5: #767676 на белом проходит, #777777 — уже нет', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5)
  })

  it('граница 3: #949494 на белом проходит, #959595 — уже нет', () => {
    expect(contrastRatio('#949494', '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(contrastRatio('#959595', '#ffffff')).toBeLessThan(3)
  })

  it('не цвет — ошибка, а не тихое «контраст есть»', () => {
    expect(() => contrastRatio('red', '#ffffff')).toThrow()
  })
})

describe('пороги в проверке темы', () => {
  const base = {
    background: '#ffffff',
    surface: '#ffffff',
    text: '#000000',
    muted: '#000000',
    accent: '#000000',
    onAccent: '#ffffff',
    border: '#eeeeee',
  }
  const check = (id: string, colors: typeof base) =>
    themeContrast(colors).find((item) => item.id === id)

  it('приглушённый текст: ровно на границе 4,5 проходит, чуть светлее — нет', () => {
    expect(check('muted-background', { ...base, muted: '#767676' })?.ok).toBe(true)
    expect(check('muted-background', { ...base, muted: '#777777' })?.ok).toBe(false)
  })

  it('акцент как ссылка: 3 проходит, чуть светлее — нет', () => {
    expect(
      check('accent-background', { ...base, accent: '#949494', onAccent: '#000000' })?.ok,
    ).toBe(true)
    expect(
      check('accent-background', { ...base, accent: '#959595', onAccent: '#000000' })?.ok,
    ).toBe(false)
  })

  it('блокируют все пары: текст, кнопки, ссылки и акцент на поверхности (фокус)', () => {
    expect(contrastPairs.filter((pair) => pair.blocking).map((pair) => pair.id)).toEqual([
      'text-background',
      'text-surface',
      'muted-background',
      'muted-surface',
      'on-accent',
      'accent-background',
      'accent-surface',
    ])
    expect(contrastPairs.filter((pair) => !pair.blocking)).toEqual([])
  })
})

describe('formatContrast — для людей', () => {
  it('одна цифра после запятой', () => {
    expect(formatContrast(7.14)).toBe('7,1')
    expect(formatContrast(21)).toBe('21,0')
  })

  it('округление вниз: 4,48 — «4,4», а не «4,5 · мало»', () => {
    expect(formatContrast(contrastRatio('#777777', '#ffffff'))).toBe('4,4')
    expect(formatContrast(4.5)).toBe('4,5')
    expect(formatContrast(2.999)).toBe('2,9')
  })
})

describe('mixColors', () => {
  it('доля первого цвета', () => {
    expect(mixColors('#000000', '#ffffff', 0)).toBe('#ffffff')
    expect(mixColors('#000000', '#ffffff', 1)).toBe('#000000')
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('готовые темы', () => {
  it.each(themePresets.map((preset) => [preset.title, preset] as const))(
    '«%s» проходит контраст по всем парам, и предупреждающим тоже',
    (_title, preset) => {
      const failed = themeContrast(preset.theme.colors).filter((item) => !item.ok)
      expect(failed.map((item) => item.label)).toEqual([])
      expect(ThemeInput.safeParse(preset.theme).success).toBe(true)
    },
  )

  it('шесть тем, как в концепте', () => {
    expect(themePresets.map((preset) => preset.title)).toEqual([
      'Спокойная',
      'Свежая',
      'Тёплая',
      'Строгая',
      'Ночная',
      'Яркая',
    ])
  })
})
