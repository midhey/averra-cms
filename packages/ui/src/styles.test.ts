import { relative, resolve } from 'node:path'
import { compile, compileString } from 'sass'
import { describe, expect, it } from 'vitest'
import { findStyleFiles } from '../tools/check-tokens'
import { averraUiImporter } from '../tools/sass-importer'

const repoRoot = resolve(import.meta.dirname, '../../..')
const uiSrc = resolve(repoRoot, 'packages/ui/src')
const adminSrc = resolve(repoRoot, 'apps/admin/src')

const compileFile = (file: string) => compile(file, { importers: [averraUiImporter] }).css

async function scssFiles() {
  const files = [...(await findStyleFiles(uiSrc)), ...(await findStyleFiles(adminSrc))]
  return files.filter((file) => file.endsWith('.scss'))
}

describe('стили на Sass', () => {
  it('каждый .scss пакета и админки компилируется', async () => {
    const failures: string[] = []
    for (const file of await scssFiles()) {
      try {
        compileFile(file)
      } catch (error) {
        failures.push(`${relative(repoRoot, file)}: ${(error as Error).message}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('Sass API не выводит CSS, а preset и тема выводят', () => {
    expect(compileFile(resolve(uiSrc, 'foundation/_index.scss')).trim()).toBe('')
    expect(compileFile(resolve(uiSrc, 'foundation/preset.scss'))).toContain('--color-text:')
    expect(compileFile(resolve(uiSrc, 'themes/_averra.scss'))).toContain('--color-text:')
  })

  it('breakpoint-down — та же граница, что у breakpoint, но «уже неё»', () => {
    const css = compileString(
      '@use "@averra/ui" as ui; @include ui.breakpoint(medium) { a { b: c } } @include ui.breakpoint-down(medium) { a { b: d } }',
      { importers: [averraUiImporter] },
    ).css
    expect(css).toContain('@media (min-width: 64rem)')
    expect(css).toContain('@media (width < 64rem)')
  })

  it('глубокий импорт мимо exports не находится', () => {
    expect(() =>
      averraUiImporter.findFileUrl('@averra/ui/foundation/tools/mixins', {
        fromImport: false,
        containingUrl: null,
      }),
    ).toThrow(/нет входа/)
  })

  it('каждая var(--…) в стилях объявлена в токенах, теме или самом стиле', async () => {
    const declared = new Set<string>()
    const used = new Map<string, string>()
    for (const file of await scssFiles()) {
      const css = compileFile(file)
      for (const [, name] of css.matchAll(/(--[\w-]+)\s*:/gu)) declared.add(name as string)
      for (const [, name] of css.matchAll(/var\(\s*(--[\w-]+)/gu)) {
        if (!used.has(name as string)) used.set(name as string, relative(repoRoot, file))
      }
    }
    const missing = [...used].filter(([name]) => !declared.has(name)).map(([n, f]) => `${n} (${f})`)
    expect(missing).toEqual([])
  })
})
