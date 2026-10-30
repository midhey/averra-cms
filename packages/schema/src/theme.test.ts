import { describe, expect, it } from 'vitest'
import { contrastRatio, mixColors } from './contrast'
import {
  coverScrim,
  defaultTheme,
  derivedBorder,
  legacyTheme,
  readTheme,
  sameTheme,
  Theme,
  ThemeColor,
  type ThemeColors,
  ThemeInput,
  themeContrast,
} from './theme'
import { themePresets } from './theme-presets'

/** Тема в формате до редактора тем — так она лежит в базе у существующих сайтов */
const legacy = {
  colors: {
    background: '#ffffff',
    surface: '#f4f5f7',
    text: '#16181d',
    muted: '#5b6170',
    accent: '#2f5bea',
    onAccent: '#ffffff',
  },
  fonts: { heading: 'serif', body: 'humanist' },
  radius: 'large',
}

describe('Theme', () => {
  it('принимает тему по умолчанию и подставляет скругления, если их нет', () => {
    const { radius: _radius, ...withoutRadius } = defaultTheme
    expect(Theme.parse(withoutRadius).radius).toBe('medium')
  })

  it('пропускает цвета только в формате #RRGGBB: значения попадают прямо в CSS', () => {
    const injected = {
      ...defaultTheme,
      colors: { ...defaultTheme.colors, accent: 'red}</style><script>' },
    }
    expect(Theme.safeParse(injected).success).toBe(false)
  })

  // Значение, которое начинается как цвет: шаблон держится только якорями ^…$ и длиной
  it.each(['#ffffff;}body{display:none', '#fff}</style><script>', '#ffffff\n}'])(
    'цвет с решёткой и хвостом CSS (%j) не проходит ни Theme, ни ThemeInput',
    (value) => {
      expect(ThemeColor.safeParse(value).success).toBe(false)
      const injected = { ...defaultTheme, colors: { ...defaultTheme.colors, accent: value } }
      expect(Theme.safeParse(injected).success).toBe(false)
      const issues = ThemeInput.safeParse(injected).error?.issues ?? []
      expect(issues.map((issue) => issue.path.join('.'))).toEqual(['colors.accent'])
    },
  )

  it('шрифт — только из списка: строка из запроса не попадёт в font-family', () => {
    const font = { ...defaultTheme, fonts: { heading: 'Comic Sans"', body: 'system' } }
    expect(Theme.safeParse(font).success).toBe(false)
  })

  it('прежняя тема без линий — не новая тема: её читает readTheme', () => {
    expect(Theme.safeParse(legacy).success).toBe(false)
  })
})

describe('readTheme — темы существующих сайтов', () => {
  it('прежняя тема читается без потерь: цвета, системные шрифты и скругления как были', () => {
    const theme = readTheme(legacy)
    expect(theme.colors).toMatchObject(legacy.colors)
    expect(theme.fonts).toEqual({ heading: 'serif', body: 'humanist' })
    expect(theme.radius).toBe('large')
    expect(Theme.safeParse(theme).success).toBe(true)
  })

  it('линии прежней темы — немного текста в фоне: видны, но тише текста', () => {
    const theme = readTheme(legacy)
    expect(theme.colors.border).toBe(derivedBorder(legacy.colors))
    expect(theme.colors.border).toBe('#dcdcdd')
  })

  it('без скруглений — средние, как и раньше по умолчанию', () => {
    const { radius: _radius, ...withoutRadius } = legacy
    expect(readTheme(withoutRadius).radius).toBe('medium')
  })

  it('новая тема читается как есть', () => {
    const theme = { ...defaultTheme, fonts: { heading: 'unbounded', body: 'golos-text' } }
    expect(readTheme(theme)).toEqual(theme)
  })

  it('незнакомое от более новой версии — значения по умолчанию, лишнее отбрасывается', () => {
    const fields: string[] = []
    const theme = readTheme(
      {
        ...defaultTheme,
        colors: { ...defaultTheme.colors, accent: 'oklch(0.6 0.2 250)', glow: '#ffffff' },
        fonts: { heading: 'future-font', body: 'manrope' },
        radius: 'pill',
        shadows: 'soft',
      },
      (field) => fields.push(field),
    )
    expect(theme.colors.accent).toBe(defaultTheme.colors.accent)
    expect(theme.fonts).toEqual({ heading: 'system', body: 'manrope' })
    expect(theme.radius).toBe('medium')
    expect(Theme.safeParse(theme).success).toBe(true)
    expect(fields.toSorted()).toEqual(['colors.accent', 'fonts.heading', 'radius'])
  })

  it('совсем не тема — тема по умолчанию, а не падение сборки', () => {
    expect(readTheme(null)).toEqual(defaultTheme)
    expect(readTheme('тема')).toEqual(defaultTheme)
  })
})

describe('legacyTheme — проекция для прежней версии', () => {
  it('без линий, свой шрифт — ближайший системный: прежняя версия строго проверяет схему', () => {
    const projected = legacyTheme({
      ...defaultTheme,
      fonts: { heading: 'lora', body: 'manrope' },
    })
    expect(projected.colors).not.toHaveProperty('border')
    expect(projected.fonts).toEqual({ heading: 'serif', body: 'system' })
    // Обратно — та же тема, только шрифты системные
    expect(readTheme(projected).colors).toEqual(defaultTheme.colors)
  })
})

describe('ThemeInput — контраст основных пар', () => {
  it('тема по умолчанию проходит', () => {
    expect(ThemeInput.safeParse(defaultTheme).success).toBe(true)
  })

  it('бледный акцент не проходит: ошибка у акцента с цифрой и порогом', () => {
    const pale = { ...defaultTheme, colors: { ...defaultTheme.colors, accent: '#ffff00' } }
    const result = ThemeInput.safeParse(pale)
    expect(result.success).toBe(false)
    const issues = result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])
    expect(issues).toContainEqual([
      'colors.accent',
      'Акцент на фоне (ссылки): контраст 1,0 — нужно не меньше 3,0',
    ])
    // Белый текст на жёлтой кнопке — тоже
    expect(issues?.some(([path]) => path === 'colors.onAccent')).toBe(true)
  })

  it('кривой цвет — ошибка формата у поля, а не падение подсчёта контраста', () => {
    const broken = { ...defaultTheme, colors: { ...defaultTheme.colors, text: 'black' } }
    const result = ThemeInput.safeParse(broken)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['colors.text'])
  })

  it('бледный приглушённый текст на поверхности — блок «Призыв» — не сохранить', () => {
    const theme = { ...defaultTheme, colors: { ...defaultTheme.colors, surface: '#c4c8d0' } }
    const checks = themeContrast(theme.colors)
    expect(checks.find((check) => check.id === 'text-surface')?.ok).toBe(true)
    expect(checks.find((check) => check.id === 'muted-surface')?.ok).toBe(false)
    const result = ThemeInput.safeParse(theme)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['colors.muted'])
  })

  it('акцент, плохо заметный на поверхности, не сохранить: там рамка фокуса и кнопки', () => {
    // Тёмная тема: поверхность чуть светлее фона, акцент проходит на фоне и не проходит на ней
    const colors = {
      background: '#111111',
      surface: '#222222',
      text: '#ffffff',
      muted: '#bbbbbb',
      accent: '#636363',
      onAccent: '#ffffff',
      border: '#333333',
    }
    const checks = themeContrast(colors)
    const accentSurface = checks.find((check) => check.id === 'accent-surface')
    expect(accentSurface?.ok).toBe(false)
    expect(accentSurface?.blocking).toBe(true)
    // Остальные пары проходят: отказ — только из-за поверхности
    expect(checks.filter((check) => !check.ok).map((check) => check.id)).toEqual(['accent-surface'])
    const result = ThemeInput.safeParse({ ...defaultTheme, colors })
    expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      [
        'colors.accent',
        'Акцент на поверхности (кнопки, фокус): контраст 2,6 — нужно не меньше 3,0',
      ],
    ])
  })
})

describe('sameTheme', () => {
  it('регистр цвета не важен', () => {
    const upper = { ...defaultTheme, colors: { ...defaultTheme.colors, accent: '#2F5BEA' } }
    expect(sameTheme(upper, defaultTheme)).toBe(true)
    expect(sameTheme({ ...defaultTheme, radius: 'none' }, defaultTheme)).toBe(false)
  })
})

describe('coverScrim — затемнение «Первого экрана» на фото', () => {
  /** Контраст текста поверх фото (цвет фона темы) над пикселем фото под слоем */
  const worst = (colors: { text: string; background: string }, pixel: string) =>
    contrastRatio(colors.background, mixColors(colors.text, pixel, coverScrim(colors)))

  const themes: [string, ThemeColors][] = [
    ['тема по умолчанию', defaultTheme.colors],
    ...themePresets.map((preset): [string, ThemeColors] => [preset.title, preset.theme.colors]),
  ]

  it.each(themes)('%s: текст читается над любым пикселем фото', (_, colors) => {
    const share = coverScrim(colors)
    expect(share).toBeGreaterThan(0)
    expect(share).toBeLessThanOrEqual(1)
    for (const pixel of ['#ffffff', '#000000', '#808080', '#ff0000', colors.background]) {
      expect(worst(colors, pixel), pixel).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('тёмная тема — слой светлый, текст поверх тёмный', () => {
    const dark = { text: '#f2f2f2', background: '#121212' }
    expect(worst(dark, '#000000')).toBeGreaterThanOrEqual(4.5)
    expect(worst(dark, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('пара на пределе 4,5 — слой сплошной: фото не видно, но текст читается', () => {
    expect(coverScrim({ text: '#767676', background: '#ffffff' })).toBe(1)
  })

  it('у темы по умолчанию фото видно: слой не сплошной', () => {
    expect(coverScrim(defaultTheme.colors)).toBeLessThan(0.8)
  })
})

describe('акцентный шрифт (рукописные подписи)', () => {
  const withAccent = { ...defaultTheme, fonts: { ...defaultTheme.fonts, accent: 'caveat' } }

  it('необязателен: тема без него проходит, с ним — читается и сравнивается', () => {
    expect(Theme.safeParse(defaultTheme).success).toBe(true)
    expect(Theme.parse(withAccent).fonts.accent).toBe('caveat')
    expect(readTheme(withAccent).fonts.accent).toBe('caveat')
    expect(readTheme(defaultTheme).fonts).not.toHaveProperty('accent')
    expect(sameTheme(defaultTheme as Theme, Theme.parse(withAccent))).toBe(false)
    expect(sameTheme(Theme.parse(withAccent), Theme.parse(withAccent))).toBe(true)
  })

  it('шрифт, которого эта версия не знает, — не задан, о нём сообщает onInvalid', () => {
    const seen: string[] = []
    const theme = readTheme(
      { ...withAccent, fonts: { ...withAccent.fonts, accent: 'comic-future' } },
      (field) => seen.push(field),
    )
    expect(theme.fonts).not.toHaveProperty('accent')
    expect(seen).toEqual(['fonts.accent'])
  })

  it('прежняя версия получает тему без акцентного шрифта', () => {
    expect(legacyTheme(Theme.parse(withAccent)).fonts).toEqual({
      heading: 'system',
      body: 'system',
    })
  })
})
