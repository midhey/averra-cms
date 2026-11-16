import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { compileString } from 'sass'
import { describe, expect, it } from 'vitest'
import { averraUiImporter } from '../tools/sass-importer'

/** Значения custom properties выбранного блока после компиляции Sass */
function rootProperties(source: string, selector = ':root') {
  const css = compileString(source, { importers: [averraUiImporter] }).css
  const values = new Map<string, string>()
  postcss.parse(css).walkRules(selector, (node) => {
    node.walkDecls((decl) => {
      if (decl.prop.startsWith('--') || decl.prop === 'color-scheme') {
        values.set(decl.prop, decl.value.trim())
      }
    })
  })
  return values
}

describe.each([
  ['светлая', ':root'],
  ['тёмная', ':root[data-theme=dark]'],
  ['системная тёмная', ':root[data-theme=system]'],
  ['светлая область', '[data-theme-scope=light]'],
  ['тёмная область', '[data-theme-scope=dark]'],
])('тема Averra: %s', (_name, selector) => {
  const overrides = rootProperties('@use "@averra/ui/themes/averra";', selector)
  const averra = new Map([
    ...rootProperties('@use "@averra/ui/preset";\n@use "@averra/ui/themes/averra";'),
    ...overrides,
  ])

  /** Значение роли до конца цепочки var(): '#1a1b1e' */
  function resolveColor(name: string, seen = new Set<string>()): string {
    if (seen.has(name)) throw new Error(`Цикл в токенах: ${name}`)
    seen.add(name)
    const value = averra.get(name)
    if (!value) throw new Error(`Токен не объявлен: ${name}`)
    const ref = /^var\((--[\w-]+)\)$/u.exec(value)
    return ref ? resolveColor(ref[1] as string, seen) : value
  }

  function rgb(hex: string): [number, number, number] {
    const short = /^#([\da-f])([\da-f])([\da-f])$/iu.exec(hex)
    const full = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : hex
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(full)
    if (!match) throw new Error(`Не HEX: ${hex}`)
    return [match[1], match[2], match[3]].map((part) => Number.parseInt(part as string, 16)) as [
      number,
      number,
      number,
    ]
  }

  /** Относительная яркость по WCAG 2.2 */
  function luminance(hex: string) {
    const [r, g, b] = rgb(hex).map((channel) => {
      const c = channel / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  function contrast(foreground: string, background: string) {
    const [light, dark] = [luminance(resolveColor(foreground)), luminance(resolveColor(background))]
      .sort((a, b) => b - a)
      .map(Number) as [number, number]
    return (light + 0.05) / (dark + 0.05)
  }

  /** Светлота L* (CIELAB): по ней различаются точки статусов без цвета */
  function lightness(name: string) {
    const y = luminance(resolveColor(name))
    return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y
  }

  it('переопределяет все цветовые роли foundation: ничего не берёт из палитры кита', () => {
    const semantic = readFileSync(
      resolve(import.meta.dirname, 'foundation/tokens/_semantic.scss'),
      'utf8',
    )
    const roles = [...semantic.matchAll(/^\s*(--color-[\w-]+):/gmu)].map((m) => m[1])
    const missing = roles.filter((role) => !overrides.has(role as string))
    expect(roles.length).toBeGreaterThan(20)
    expect(missing).toEqual([])
  })

  it('задаёт браузерную цветовую схему', () => {
    expect(averra.get('color-scheme')).toBe(
      selector === ':root' || selector === '[data-theme-scope=light]' ? 'light' : 'dark',
    )
  })

  it.each([
    ['--color-text', '--color-background'],
    ['--color-text', '--color-surface'],
    ['--color-text', '--color-surface-sidebar'],
    ['--color-text', '--color-surface-accent'],
    ['--color-text-muted', '--color-background'],
    ['--color-text-muted', '--color-surface'],
    ['--color-text-muted', '--color-surface-sidebar'],
    ['--color-text-muted', '--color-surface-muted'],
    ['--color-text-muted', '--color-surface-inset'],
    ['--color-text-placeholder', '--color-surface'],
    ['--color-action', '--color-surface'],
    ['--color-action', '--color-background'],
    ['--color-action-hover', '--color-surface'],
    ['--color-action-text', '--color-action'],
    ['--color-primary-text', '--color-primary'],
    ['--color-primary-text', '--color-primary-hover'],
    ['--color-success-text', '--color-success-surface'],
    ['--color-warning-text', '--color-warning-surface'],
    ['--color-danger-text', '--color-danger-surface'],
    ['--color-danger-text', '--color-surface'],
    ['--color-info-text', '--color-info-surface'],
    // Подсветка кода: поле кода лежит на --color-surface
    ['--color-success-text', '--color-surface'],
    ['--color-warning-text', '--color-surface'],
    ['--color-info-text', '--color-surface'],
    ['--color-neutral-text', '--color-neutral-surface'],
  ])('контраст текста %s на %s не меньше 4,5:1', (text, background) => {
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['--color-border-strong', '--color-surface'],
    ['--color-border-strong', '--color-background'],
    // Рамка кнопок и флажков в покое и при наведении, на всех поверхностях админки
    ['--color-control-border', '--color-surface'],
    ['--color-control-border', '--color-background'],
    ['--color-control-border', '--color-surface-muted'],
    ['--color-control-border', '--color-surface-inset'],
    ['--color-control-border', '--color-surface-sidebar'],
    // Дорожка включённого Switch; выключенную отличает рамка control-border.
    ['--color-action', '--color-surface-muted'],
    ['--color-action', '--color-surface-inset'],
    ['--color-action', '--color-surface-accent'],
    ['--color-control-border-hover', '--color-control-hover'],
    ['--color-disabled-border', '--color-surface'],
    ['--color-focus-ring', '--color-surface'],
    ['--color-focus-ring', '--color-background'],
    ['--color-focus-ring', '--color-surface-sidebar'],
    ['--color-focus-ring', '--color-surface-muted'],
    ['--color-focus-ring', '--color-surface-inset'],
    ['--color-focus-ring', '--color-surface-accent'],
    ['--color-preview-selection', '--color-preview-surface'],
    ['--color-preview-hover', '--color-preview-surface'],
    // Точка «требует внимания» в сайдбаре — единственный признак для зрячего (WCAG 1.4.11)
    ['--color-warning-indicator', '--color-surface'],
    ['--color-warning-indicator', '--color-surface-sidebar'],
    ['--color-warning-indicator', '--color-background'],
  ])('граница полей и кольцо фокуса %s на %s не меньше 3:1', (border, background) => {
    expect(contrast(border, background)).toBeGreaterThanOrEqual(3)
  })

  it.each([
    ['--color-disabled-text', '--color-disabled-surface'],
    ['--color-text', '--color-control-hover'],
    ['--color-text', '--color-control-active'],
    ['--color-danger-text', '--color-danger-surface'],
  ])('текст %s на %s читается (4,5:1), в том числе выключенный', (text, background) => {
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5)
  })

  // Наведение должно быть заметно: заливка и рамка меняются, а не «чуть-чуть»
  it('наведение меняет заливку и рамку заметно', () => {
    // Порог выше старой заливки sand-200 (1,20:1 к поверхности): с ней наведение держалось бы на
    // одной рамке. Значение по умолчанию — sand-300 (около 1,3:1); решение владельца ещё не принято
    expect(contrast('--color-control-hover', '--color-surface')).toBeGreaterThanOrEqual(1.25)
    // И не та же заливка, что у выключенного и приглушённого (surface-muted = sand-200)
    expect(resolveColor('--color-control-hover')).not.toBe(resolveColor('--color-surface-muted'))
    expect(
      contrast('--color-control-border-hover', '--color-control-border'),
    ).toBeGreaterThanOrEqual(1.4)
    expect(contrast('--color-primary-hover', '--color-primary')).toBeGreaterThanOrEqual(1.5)
    expect(contrast('--color-control-active', '--color-control-hover')).toBeGreaterThan(1.05)
  })

  it('точки статусов различаются по светлоте, а не только по оттенку', () => {
    // Янтарь с контрастом 3:1 к поверхностям по светлоте сливается с зелёным (оба не светлее
    // ~57 L*), поэтому его отличает форма (ромб): проверка ниже
    const tones = ['info', 'danger', 'success', 'neutral'].map((tone) => ({
      tone,
      l: lightness(`--color-${tone}-indicator`),
    }))
    for (const a of tones) {
      for (const b of tones) {
        if (a.tone < b.tone) expect(Math.abs(a.l - b.l), `${a.tone} и ${b.tone}`).toBeGreaterThan(8)
      }
    }
  })
})

it.each([
  ['light', ':root'],
  ['dark', ':root[data-theme=dark]'],
])('область %s повторяет роли соответствующей темы', (theme, selector) => {
  const source = '@use "@averra/ui/themes/averra";'
  const roles = (values: Map<string, string>) =>
    new Map([...values].filter(([name]) => /^(--color-|--shadow-|color-scheme)/u.test(name)))
  expect(roles(rootProperties(source, `[data-theme-scope=${theme}]`))).toEqual(
    roles(rootProperties(source, selector)),
  )
})

it('системная тёмная тема совпадает с явной и включается только медиазапросом', () => {
  const source = '@use "@averra/ui/themes/averra";'
  const selector = ':root[data-theme=system]'
  expect(rootProperties(source, selector)).toEqual(rootProperties(source, ':root[data-theme=dark]'))
  const css = postcss.parse(compileString(source, { importers: [averraUiImporter] }).css)
  const parents: string[] = []
  css.walkRules(selector, (rule) => {
    const parent = rule.parent
    expect(parent?.type).toBe('atrule')
    if (parent?.type === 'atrule') parents.push(`${parent.name} ${parent.params}`)
    expect(
      rule.nodes.find((node) => node.type === 'decl' && node.prop === 'color-scheme'),
    ).toMatchObject({ value: 'dark' })
  })
  expect(parents).toEqual(['media (prefers-color-scheme: dark)'])
})
