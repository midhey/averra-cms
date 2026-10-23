import { describe, expect, it } from 'vitest'
import {
  defaultTheme,
  derivedBorder,
  legacyTheme,
  readTheme,
  sameTheme,
  Theme,
  ThemeInput,
  themeContrast,
} from './theme'

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
    const theme = { ...defaultTheme, colors: { ...defaultTheme.colors, surface: '#9aa0aa' } }
    const checks = themeContrast(theme.colors)
    expect(checks.find((check) => check.id === 'text-surface')?.ok).toBe(true)
    expect(checks.find((check) => check.id === 'muted-surface')?.ok).toBe(false)
    const result = ThemeInput.safeParse(theme)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['colors.muted'])
  })

  it('предупреждение сохранению не мешает: акцент на тёмной поверхности', () => {
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
    expect(accentSurface?.blocking).toBe(false)
    expect(checks.filter((check) => check.blocking).every((check) => check.ok)).toBe(true)
    expect(ThemeInput.safeParse({ ...defaultTheme, colors }).success).toBe(true)
  })
})

describe('sameTheme', () => {
  it('регистр цвета не важен', () => {
    const upper = { ...defaultTheme, colors: { ...defaultTheme.colors, accent: '#2F5BEA' } }
    expect(sameTheme(upper, defaultTheme)).toBe(true)
    expect(sameTheme({ ...defaultTheme, radius: 'none' }, defaultTheme)).toBe(false)
  })
})
