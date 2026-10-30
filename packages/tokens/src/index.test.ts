import { existsSync } from 'node:fs'
import { readTheme, Theme, themeFontIds, themePresets } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import {
  allFontFiles,
  defaultTheme,
  fontCatalog,
  fontFaceCss,
  fontStack,
  themeFontFiles,
  themeToCss,
} from './index'
import { fontFilePath, fontFilesPlugin } from './vite'

describe('тема по умолчанию', () => {
  it('проходит схему', () => {
    expect(Theme.safeParse(defaultTheme).success).toBe(true)
  })

  it('превращается в CSS-переменные', () => {
    const css = themeToCss(defaultTheme)
    expect(css.startsWith(':root{')).toBe(true)
    expect(css).toContain('--color-accent:#2f5bea')
    expect(css).toContain(`--color-border:${defaultTheme.colors.border}`)
    expect(css).toContain('--radius:8px')
    expect(css).toContain('--font-heading-weight:700')
    // Затемнение фото первого экрана — посчитано из текста и фона темы
    expect(css).toContain('--cover-scrim:0.6')
  })

  // Строка уходит в <style> страницы как есть: недопустимый цвет — исключение, а не CSS
  it.each(['#ffffff;}body{display:none', '#fff}</style><script>'])(
    'цвет с решёткой и хвостом CSS (%s) — исключение, строка не пишется',
    (value) => {
      const injected = { ...defaultTheme, colors: { ...defaultTheme.colors, accent: value } }
      expect(() => themeToCss(injected)).toThrow()
    },
  )

  it('тема в прежнем формате после readTheme даёт те же цвета, что раньше, и линии', () => {
    const css = themeToCss(
      readTheme({
        colors: {
          background: '#ffffff',
          surface: '#f4f5f7',
          text: '#16181d',
          muted: '#5b6170',
          accent: '#2f5bea',
          onAccent: '#ffffff',
        },
        fonts: { heading: 'system', body: 'system' },
        radius: 'medium',
      }),
    )
    expect(css).toContain('--color-on-accent:#ffffff')
    expect(css).toContain('--color-border:#dcdcdd')
    expect(css).toContain('--font-body:system-ui, -apple-system')
  })
})

describe('шрифты темы', () => {
  it('в каталоге — каждый шрифт схемы', () => {
    expect(Object.keys(fontCatalog).toSorted()).toEqual([...themeFontIds].toSorted())
  })

  it('свой шрифт — своё семейство и запасной стек устройства', () => {
    expect(fontStack('lora')).toBe(
      '"Lora", Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif',
    )
    expect(fontStack('system')).not.toContain('"Golos Text"')
  })

  it('только выбранные начертания: тексту 400 и 600, заголовкам свой вес, кириллица и латиница', () => {
    const theme = { ...defaultTheme, fonts: { heading: 'unbounded', body: 'golos-text' } } as const
    expect(themeFontFiles(theme).map((file) => file.file)).toEqual([
      'golos-text-cyrillic-400-normal.woff2',
      'golos-text-latin-400-normal.woff2',
      'golos-text-latin-ext-400-normal.woff2',
      'golos-text-cyrillic-600-normal.woff2',
      'golos-text-latin-600-normal.woff2',
      'golos-text-latin-ext-600-normal.woff2',
      'unbounded-cyrillic-600-normal.woff2',
      'unbounded-latin-600-normal.woff2',
      'unbounded-latin-ext-600-normal.woff2',
    ])
  })

  it('знак рубля ₽ — у каждого начертания, из latin-ext и только он', () => {
    for (const font of themeFontIds) {
      const files = themeFontFiles({ ...defaultTheme, fonts: { heading: font, body: font } })
      for (const face of new Set(files.map((file) => `${file.weight} ${file.style}`))) {
        const ruble = files.filter(
          (file) =>
            `${file.weight} ${file.style}` === face &&
            file.unicodeRange.split(',').includes('U+20BD'),
        )
        expect(
          ruble.map((file) => file.subset),
          `${font} ${face}`,
        ).toEqual(['latin-ext'])
      }
      // Остальная latin-ext сайту не нужна: файл качается, только когда на странице есть ₽
      for (const file of files.filter((item) => item.subset === 'latin-ext')) {
        expect(file.unicodeRange).toBe('U+20BD')
      }
    }
  })

  it('один шрифт на оба места — без повторов файлов', () => {
    const files = themeFontFiles({
      ...defaultTheme,
      fonts: { heading: 'manrope', body: 'manrope' },
    }).map((file) => file.file)
    expect(new Set(files).size).toBe(files.length)
    expect(files.filter((file) => file.includes('-cyrillic-'))).toEqual([
      'manrope-cyrillic-400-normal.woff2',
      'manrope-cyrillic-600-normal.woff2',
      'manrope-cyrillic-700-normal.woff2',
    ])
  })

  it('у PT Serif нет 600 — жирный в тексте 700', () => {
    const files = themeFontFiles({
      ...defaultTheme,
      fonts: { heading: 'system', body: 'pt-serif' },
    })
    expect(files.map((file) => file.weight)).toEqual([400, 400, 400, 700, 700, 700])
  })

  it('Playfair Display в заголовках — настоящий курсив того же веса; в тексте курсива нет', () => {
    const files = themeFontFiles({
      ...defaultTheme,
      fonts: { heading: 'playfair-display', body: 'manrope' },
    }).map((file) => file.file)
    expect(files).toContain('playfair-display-cyrillic-500-normal.woff2')
    expect(files).toContain('playfair-display-cyrillic-500-italic.woff2')
    const asBody = themeFontFiles({
      ...defaultTheme,
      fonts: { heading: 'manrope', body: 'playfair-display' },
    }).map((file) => file.file)
    expect(asBody.some((file) => file.includes('italic'))).toBe(false)
    const css = fontFaceCss(
      themeFontFiles({ ...defaultTheme, fonts: { heading: 'playfair-display', body: 'manrope' } }),
      (file) => `/_fonts/${file.file}`,
    )
    expect(css).toContain('font-family:"Playfair Display";font-style:italic;font-weight:500')
  })

  it('акцентный шрифт: --font-accent и файлы 400 и жирный; не выбран — как заголовки', () => {
    const plain = themeToCss(defaultTheme)
    expect(plain).toContain('--font-accent:var(--font-heading)')
    const theme = {
      ...defaultTheme,
      fonts: { heading: 'system', body: 'system', accent: 'caveat' },
    } as const
    expect(themeToCss(theme)).toContain('--font-accent:"Caveat", cursive')
    expect(
      themeFontFiles(theme)
        .filter((file) => file.subset === 'cyrillic')
        .map((file) => file.file),
    ).toEqual(['caveat-cyrillic-400-normal.woff2', 'caveat-cyrillic-600-normal.woff2'])
  })

  it('системные шрифты — ни одного файла', () => {
    expect(themeFontFiles(defaultTheme)).toEqual([])
  })

  it('у каждой готовой темы есть все нужные файлы в пакетах', () => {
    for (const preset of themePresets) {
      for (const file of themeFontFiles(preset.theme)) {
        expect(existsSync(fontFilePath(file.package, file.file)), file.file).toBe(true)
      }
    }
  })

  it('каждый файл каталога лежит в своём пакете', () => {
    for (const file of allFontFiles()) {
      expect(existsSync(fontFilePath(file.package, file.file)), file.file).toBe(true)
    }
  })

  it('@font-face: WOFF2 с адресом, диапазоном и swap', () => {
    const [file] = themeFontFiles({ ...defaultTheme, fonts: { heading: 'lora', body: 'lora' } })
    if (!file) throw new Error('нет файла')
    const css = fontFaceCss([file], (font) => `/_fonts/${font.file}`)
    expect(css).toBe(
      '@font-face{font-family:"Lora";font-style:normal;font-weight:400;font-display:swap;' +
        'src:url("/_fonts/lora-cyrillic-400-normal.woff2") format("woff2");' +
        'unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}',
    )
  })
})

describe('плагин Vite с файлами шрифтов', () => {
  const load = (as: 'path' | 'url') => {
    const plugin = fontFilesPlugin({ as })
    const id = plugin.resolveId('virtual:averra/font-files')
    if (!id) throw new Error('модуль не нашёлся')
    expect(plugin.resolveId('other')).toBeUndefined()
    return plugin.load(id) ?? ''
  }

  it('пути на диске — для рендерера', () => {
    const code = load('path')
    expect(code).toContain('"golos-text-cyrillic-400-normal.woff2":"')
    expect(code).not.toContain('?url')
  })

  it('адреса Vite — для админки', () => {
    expect(load('url')).toMatch(/import f0 from ".+\.woff2\?url"/)
  })
})
