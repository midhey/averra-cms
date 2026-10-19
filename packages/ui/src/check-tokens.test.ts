import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findStyleFiles,
  findTokenViolations,
  findViolationsInSource,
  formatViolation,
} from '../tools/check-tokens'

const repoRoot = resolve(import.meta.dirname, '../../..')
const uiDir = resolve(repoRoot, 'packages/ui')
const adminSrc = resolve(repoRoot, 'apps/admin/src')

/**
 * Старые стили экранов админки на сырых цветах. Закрытый список: экраны переходят на токены
 * в шагах 3.9–3.10 и вычёркиваются отсюда. Новый .css в админке проверку не пройдёт
 */
const LEGACY_ADMIN_CSS = [
  'editor/BlockList.module.css',
  'editor/Editor.module.css',
  'editor/History.module.css',
  'editor/Inspector.module.css',
  'editor/Preview.module.css',
  'forms/SchemaForm.module.css',
  'media/ImageField.module.css',
  'media/MediaLibrary.module.css',
  'screens/MailScreen.module.css',
  'screens/screens.module.css',
  'ui/ui.module.css',
]

describe('проверка токенов: механизм', () => {
  let root: string
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('пускает цвета в токенах и темах и находит их в стилях компонентов', async () => {
    root = await mkdtemp(join(tmpdir(), 'averra-tokens-'))
    for (const dir of ['styles/tokens', 'styles/themes', 'styles/app', 'other']) {
      await mkdir(join(root, dir), { recursive: true })
    }
    await writeFile(join(root, 'styles/tokens/_palette.scss'), ':root { --palette-x: #fff; }')
    await writeFile(join(root, 'styles/themes/_dark.scss'), ':root { --bg: rgb(0 0 0); }')
    await writeFile(
      join(root, 'styles/app/_card.scss'),
      '#face { color: #abcdef; background: rgba(0, 0, 0, 50%); }\n@include ring(hsl(0 0% 0%));',
    )
    await writeFile(join(root, 'other/legacy.css'), '.a { border-color: #123456; }')
    await writeFile(join(root, 'other/skipped.css'), '.a { color: #000; }')

    const violations = await findTokenViolations({
      includeDirs: [join(root, 'styles'), join(root, 'other')],
      allowedDirs: [join(root, 'styles/tokens'), join(root, 'styles/themes')],
      skipFiles: [join(root, 'other/skipped.css')],
    })
    expect(violations.map((violation) => violation.value)).toEqual([
      '#123456',
      '#abcdef',
      'rgba(',
      'hsl(',
    ])
    expect(formatViolation(violations[0] as (typeof violations)[0], root)).toBe(
      `${join('other', 'legacy.css')}:1:6 — прямой цвет #123456`,
    )
  })

  it('селектор #id и комментарии — не нарушение', () => {
    const source = '/* цвет #fff */\n#main { color: var(--color-text); } // rgb(1 2 3)'
    expect(findViolationsInSource(source, 'a.scss')).toEqual([])
  })

  it('функции цвета CSS и именованные цвета — нарушение', () => {
    const source = [
      '.a { color: oklch(60% 0.1 250); background: lab(50% 0 0); border-color: lch(1 2 3); }',
      '.b { color: hwb(0 0% 0%); fill: color(display-p3 1 0 0); stroke: oklab(0.5 0 0); }',
      '.c { color: white; border: 1px solid Red; background: color-mix(in srgb, black, var(--x)); }',
    ].join('\n')
    expect(findViolationsInSource(source, 'a.scss').map((v) => v.value.toLowerCase())).toEqual([
      'oklch(',
      'lab(',
      'lch(',
      'hwb(',
      'color(',
      'oklab(',
      'white',
      'red',
      'black',
    ])
  })

  it('похожее на цвет, но не цвет: имена, строки, системные цвета, функции', () => {
    const source = [
      '.a { color: transparent; border-color: currentcolor; background: inherit; }',
      '.b { --tint: var(--color-text); color: var(--status-red, var(--color-danger-text)); }',
      '.c { font-family: "Golos Text", "Red Hat"; background: url(white.svg); }',
      '.d { transition: background-color var(--duration-fast) ease; width: tan(45deg); }',
      '.e { color: $red; @include ui.breakpoint(medium) { gap: 0; } }',
      '.f { background: color-mix(in srgb, var(--color-surface), var(--color-text) 10%); }',
    ].join('\n')
    expect(findViolationsInSource(source, 'a.scss')).toEqual([])
  })

  it('системные цвета — только внутри @media (forced-colors: active)', () => {
    const source = [
      '.a { outline: 2px solid Highlight; color: canvastext; }',
      '@media (forced-colors: active) { .b { color: HighlightText; background: Highlight; } }',
      '.c { &:hover { @media (forced-colors: active) { border-color: ButtonBorder; } } }',
      '@media (forced-colors: none) { .d { color: GrayText; } }',
      '.e { grid-area: field-label; animation: marker 1s; @include ui.mark; }',
    ].join('\n')
    expect(findViolationsInSource(source, 'a.scss').map((v) => [v.kind, v.value])).toEqual([
      ['system', 'Highlight'],
      ['system', 'canvastext'],
      ['system', 'GrayText'],
    ])
  })

  it('примитивы радиусов, теней и шкалы текста мимо ролей — нарушение', () => {
    const source = [
      '.a { border-radius: var(--radius-small); box-shadow: var(--shadow-surface); }',
      '.b { font-size: var(--type-3); --radius-medium: 1rem; }',
      '.c { border-radius: var(--radius-control); padding: var(--space-2); }',
    ].join('\n')
    expect(findViolationsInSource(source, 'a.scss').map((v) => [v.kind, v.value])).toEqual([
      ['primitive', '--radius-small'],
      ['primitive', '--shadow-surface'],
      ['primitive', '--type-3'],
      ['primitive', '--radius-medium'],
    ])
  })

  it('палитра мимо ролей — нарушение: и взять, и объявить', () => {
    const source = '.a { color: var(--palette-blue-600); --palette-my: var(--color-text); }'
    expect(findViolationsInSource(source, 'a.scss').map((v) => [v.kind, v.value])).toEqual([
      ['palette', '--palette-blue-600'],
      ['palette', '--palette-my'],
    ])
  })
})

describe('проверка токенов: репозиторий', () => {
  it('в стилях @averra/ui и админки нет сырых цветов и палитры вне токенов и тем', async () => {
    const violations = await findTokenViolations({
      includeDirs: [resolve(uiDir, 'src'), adminSrc],
      allowedDirs: [resolve(uiDir, 'src/foundation/tokens'), resolve(uiDir, 'src/themes')],
      skipFiles: LEGACY_ADMIN_CSS.map((file) => resolve(adminSrc, file)),
    })
    expect(violations.map((violation) => formatViolation(violation, repoRoot))).toEqual([])
  })

  it('старые .css в админке — ровно закрытый список: новых нет, удалённые вычеркнуты', async () => {
    const cssFiles = (await findStyleFiles(adminSrc))
      .filter((file) => file.endsWith('.css'))
      .map((file) => relative(adminSrc, file).replaceAll('\\', '/'))
    expect(cssFiles).toEqual(LEGACY_ADMIN_CSS)
  })
})
