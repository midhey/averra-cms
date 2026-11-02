import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { compileString } from 'sass'
import { describe, expect, it } from 'vitest'
import { averraUiImporter } from '../tools/sass-importer'

/** Значения custom properties на :root после preset и темы (поздние перекрывают ранние) */
function rootProperties(source: string) {
  const css = compileString(source, { importers: [averraUiImporter] }).css
  const values = new Map<string, string>()
  postcss.parse(css).each((node) => {
    if (node.type !== 'rule' || (node as Rule).selector !== ':root') return
    ;(node as Rule).walkDecls((decl) => {
      if (decl.prop.startsWith('--')) values.set(decl.prop, decl.value.trim())
    })
  })
  return values
}

const averra = rootProperties('@use "@averra/ui/preset";\n@use "@averra/ui/themes/averra";')

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

describe('тема Averra', () => {
  it('переопределяет все цветовые роли foundation: ничего не берёт из палитры кита', () => {
    const semantic = readFileSync(
      resolve(import.meta.dirname, 'foundation/tokens/_semantic.scss'),
      'utf8',
    )
    const theme = readFileSync(resolve(import.meta.dirname, 'themes/_averra.scss'), 'utf8')
    const roles = [...semantic.matchAll(/^\s*(--color-[\w-]+):/gmu)].map((m) => m[1])
    const missing = roles.filter((role) => !new RegExp(`^\\s*${role}:`, 'mu').test(theme))
    expect(roles.length).toBeGreaterThan(20)
    expect(missing).toEqual([])
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
    ['--color-control-border-hover', '--color-control-hover'],
    ['--color-disabled-border', '--color-surface'],
    ['--color-focus-ring', '--color-surface'],
    ['--color-focus-ring', '--color-background'],
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
    expect(contrast('--color-control-hover', '--color-surface')).toBeGreaterThanOrEqual(1.2)
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
