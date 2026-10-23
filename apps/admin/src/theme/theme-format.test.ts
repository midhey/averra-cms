import { defaultTheme, ThemeInput, themeContrast } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import {
  checksOf,
  contrastText,
  contrastTone,
  fontGroups,
  formOf,
  normalizeHex,
  refusedField,
  themeOf,
  themeStatus,
} from './theme-format'

describe('цвет, как его набрали', () => {
  it('без решётки, коротко и заглавными — к #rrggbb', () => {
    expect(normalizeHex('2F5BEA')).toBe('#2f5bea')
    expect(normalizeHex(' #FFF ')).toBe('#ffffff')
    expect(normalizeHex('#abc')).toBe('#aabbcc')
  })

  it('недописанное — как есть: ошибку покажет схема', () => {
    expect(normalizeHex('#2f5b')).toBe('#2f5b')
    expect(normalizeHex('синий')).toBe('синий')
  })
})

describe('тема из формы', () => {
  it('все цвета дописаны — тема, иначе нет и проверок контраста', () => {
    const form = formOf(defaultTheme)
    expect(themeOf(form)).toEqual(defaultTheme)
    const broken = { ...form, colors: { ...form.colors, accent: '#2f5' } }
    expect(themeOf(broken)).toBeUndefined()
    expect(checksOf(broken)).toEqual([])
  })
})

describe('отметки контраста', () => {
  const checks = themeContrast({ ...defaultTheme.colors, accent: '#ffe066' })
  const byId = (id: string) => {
    const found = checks.find((check) => check.id === id)
    if (!found) throw new Error(id)
    return found
  }

  it('как в концепте: «7,1 · ок» и «1,3 · мало»', () => {
    expect(contrastText(byId('text-background'))).toMatch(/^\d+,\d · ок$/)
    expect(contrastText(byId('accent-background'))).toBe('1,3 · мало')
  })

  it('мало у основной пары — ошибка, у пары с поверхностью — предупреждение', () => {
    expect(contrastTone(byId('text-background'))).toBe('success')
    expect(contrastTone(byId('accent-background'))).toBe('danger')
    expect(contrastTone(byId('accent-surface'))).toBe('warning')
  })
})

describe('шрифты и состояние', () => {
  it('свои шрифты первыми, системные — отдельной группой', () => {
    expect(fontGroups.map((group) => group.fonts.length)).toEqual([7, 3])
    expect(fontGroups[1]?.fonts).toEqual(['system', 'humanist', 'serif'])
  })

  it('состояние словами', () => {
    expect(themeStatus({ unsaved: true, unpublished: true }).text).toBe('Не сохранено')
    expect(themeStatus({ unsaved: false, unpublished: true }).text).toBe(
      'Сохранено · не опубликовано',
    )
    expect(themeStatus({ unsaved: false, unpublished: false })).toEqual({
      tone: 'success',
      text: 'Опубликована',
    })
  })
})

describe('фокус после отказа сохранить', () => {
  const refuse = (colors: Partial<typeof defaultTheme.colors>, last?: 'accent' | 'background') => {
    const theme = { ...defaultTheme, colors: { ...defaultTheme.colors, ...colors } }
    const issues = ThemeInput.safeParse(theme).error?.issues ?? []
    return refusedField(issues, themeContrast(theme.colors), last)
  }

  it('бледный акцент: фокус на акцент, хотя первой стоит ошибка «Текст на акценте»', () => {
    expect(refuse({ accent: '#ffe066' })).toBe('colors.onAccent')
    expect(refuse({ accent: '#ffe066' }, 'accent')).toBe('colors.accent')
  })

  it('меняли фон — фокус на фон, хотя ошибка встала у текста пары', () => {
    expect(refuse({ background: '#5b6170' }, 'background')).toBe('colors.background')
    expect(refuse({ background: '#5b6170' })).toBe('colors.text')
  })

  it('последний изменённый цвет ни при чём — первая ошибка', () => {
    expect(refuse({ muted: '#cccccc' }, 'accent')).toBe('colors.muted')
  })
})
