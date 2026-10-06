import { describe, expect, it } from 'vitest'
import { Theme } from './theme'

const theme = {
  colors: {
    background: '#ffffff',
    surface: '#f4f5f7',
    text: '#16181d',
    muted: '#5b6170',
    accent: '#2f5bea',
    onAccent: '#ffffff',
  },
  fonts: { heading: 'system', body: 'system' },
}

describe('Theme', () => {
  it('принимает корректную тему и подставляет скругления по умолчанию', () => {
    expect(Theme.parse(theme).radius).toBe('medium')
  })

  it('пропускает цвета только в формате #RRGGBB: значения попадают прямо в CSS', () => {
    const injected = { ...theme, colors: { ...theme.colors, accent: 'red}</style><script>' } }
    expect(Theme.safeParse(injected).success).toBe(false)
  })
})
