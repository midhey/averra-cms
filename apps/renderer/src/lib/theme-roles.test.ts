import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defaultTheme } from '@averra/schema'
import { themeToCss } from '@averra/tokens'
import { describe, expect, it } from 'vitest'

// Цвета темы — обещание экрана «Тема»: человек меняет цвет и видит его на сайте. Переменная,
// которую themeToCss пишет на страницу, а ни один блок не берёт, меняла бы цвет впустую

const blocksDir = dirname(createRequire(import.meta.url).resolve('@averra/blocks/base.css'))
const files = readdirSync(blocksDir, { recursive: true, encoding: 'utf8' }).filter((file) =>
  file.endsWith('.css'),
)
const css = (file: string) => readFileSync(join(blocksDir, file), 'utf8')
const all = files.map(css).join('\n')

/** Правило CSS с одним селектором в начале строки: от селектора до закрывающей скобки */
function rule(source: string, selector: string) {
  const start = source.indexOf(`\n${selector} {`)
  if (start < 0) throw new Error(`нет правила ${selector}`)
  return source.slice(start, source.indexOf('}', start))
}

describe('цвета темы в блоках сайта', () => {
  it('каждую переменную цвета темы берёт хотя бы один блок', () => {
    const colors = themeToCss(defaultTheme).match(/--color-[a-z-]+/g) ?? []
    expect(colors).toContain('--color-border')
    for (const variable of colors) expect(all, variable).toContain(`var(${variable})`)
  })

  it('«Линии и рамки» — рамка карточек «Преимуществ» и окон согласия на cookie', () => {
    const features = css(join('features', 'Features.module.css'))
    const cookie = css(join('cookie', 'CookieNotice.module.css'))
    expect(rule(features, '.item')).toContain('border: 1px solid var(--color-border)')
    expect(rule(cookie, '.notice')).toContain('border: 1px solid var(--color-border)')
    // Уведомление и окно настроек — обе рамки линиями, не поверхностью
    expect(cookie.match(/border: 1px solid var\(--color-border\)/g)).toHaveLength(2)
    expect(cookie).not.toContain('1px solid var(--color-surface)')
  })

  it('рамка полей формы — приглушённым: ей нужен контраст 3:1, а линии без проверки', () => {
    expect(css(join('form', 'Form.module.css'))).not.toContain('var(--color-border)')
  })
})
