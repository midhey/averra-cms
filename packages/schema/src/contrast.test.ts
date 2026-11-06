import { describe, expect, it } from 'vitest'
import {
  accentLinkLine,
  contrastRatio,
  formatContrast,
  HOVER_CONTRAST_MIN,
  hoverBackground,
  hoverColor,
  LINK_TEXT_CONTRAST_MIN,
  mixColors,
  relativeLuminance,
} from './contrast'
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

describe('hoverColor — фон кнопки под курсором', () => {
  const check = (base: string, text: string, where: string, textMin = 4.5) => {
    const hover = hoverColor(base, text)
    expect(contrastRatio(hover, base), `заметно: ${where}`).toBeGreaterThanOrEqual(
      HOVER_CONTRAST_MIN,
    )
    expect(contrastRatio(hover, text), `текст читается: ${where}`).toBeGreaterThanOrEqual(textMin)
  }

  it('в каждой готовой теме кнопка и «обратная» кнопка заметно меняются, текст читается', () => {
    for (const preset of themePresets) {
      const { accent, onAccent } = preset.theme.colors
      check(accent, onAccent, `${preset.id}: кнопка`)
      // Белая кнопка формы на акценте: светлее некуда, текст на пределе — под курсором не хуже 3:1
      check(onAccent, accent, `${preset.id}: кнопка на акценте`, 3)
    }
  })

  it('крайние цвета: чёрный, белый, серый на пределе 4,5, светлая кнопка с тёмным текстом', () => {
    check('#000000', '#ffffff', 'чёрная')
    check('#ffffff', '#000000', 'белая')
    check('#767676', '#ffffff', 'серая на пределе')
    check('#ffffff', '#767676', 'белая с серым текстом', 3)
    check('#ffd400', '#1a1a1a', 'жёлтая')
  })

  it('тёмная кнопка со светлым текстом светлеет — как у le-english', () => {
    const hover = hoverColor('#213d32', '#fbf7f0')
    expect(relativeLuminance(hover)).toBeGreaterThan(relativeLuminance('#213d32'))
  })
})

describe('наведение на пункты меню', () => {
  const leEnglish = {
    background: '#f3ece0',
    surface: '#fbf7f0',
    text: '#1e2b25',
    accent: '#213d32',
  }

  it('«Подложка» в каждой готовой теме и у le-english заметна, текст на ней читается', () => {
    const themes = [
      ...themePresets.map((preset) => [preset.id, preset.theme.colors] as const),
      ['le-english', leEnglish] as const,
    ]
    for (const [id, colors] of themes) {
      const hover = hoverBackground(colors)
      expect(contrastRatio(hover, colors.background), `заметно: ${id}`).toBeGreaterThanOrEqual(
        HOVER_CONTRAST_MIN,
      )
      expect(contrastRatio(hover, colors.text), `текст: ${id}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('«Поверхность», которую видно, берётся как есть; почти цвета фона — сдвиг фона', () => {
    const plain = { background: '#ffffff', surface: '#e0e0e0', text: '#111111' }
    expect(hoverBackground(plain)).toBe('#e0e0e0')
    // le-english: бумага на бумаге, 1,07:1 — под курсором темнее фона, а не «Поверхность»
    const hover = hoverBackground(leEnglish)
    expect(hover).not.toBe(leEnglish.surface)
    expect(relativeLuminance(hover)).toBeLessThan(relativeLuminance(leEnglish.background))
  })

  it('«Цвет акцента»: акцент почти цвета текста — подчёркивание остаётся, иначе — нет', () => {
    expect(accentLinkLine(leEnglish.accent, leEnglish.text)).toBe('underline')
    expect(accentLinkLine('#c0503d', '#1e2b25')).toBe('none')
    for (const preset of themePresets) {
      const { accent, text } = preset.theme.colors
      const line = accentLinkLine(accent, text)
      // Без подчёркивания — только когда цвет сам заметен (WCAG 1.4.1)
      if (line === 'none') {
        expect(contrastRatio(accent, text)).toBeGreaterThanOrEqual(LINK_TEXT_CONTRAST_MIN)
      }
    }
  })
})
