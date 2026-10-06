import { Theme } from '@cms/schema'
import { describe, expect, it } from 'vitest'
import { defaultTheme, themeToCss } from './index'

describe('тема по умолчанию', () => {
  it('проходит схему', () => {
    expect(Theme.safeParse(defaultTheme).success).toBe(true)
  })

  it('превращается в CSS-переменные', () => {
    const css = themeToCss(defaultTheme)
    expect(css.startsWith(':root{')).toBe(true)
    expect(css).toContain('--color-accent:#2f5bea')
    expect(css).toContain('--radius:8px')
  })
})
