import { readFile } from 'node:fs/promises'
import { defaultTheme } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import { FONTS_PREFIX, siteFontCss, siteFontFiles } from './fonts'

describe('шрифты темы на сайте', () => {
  it('только начертания темы, с хешем содержимого в имени', async () => {
    const files = await siteFontFiles({
      ...defaultTheme,
      fonts: { heading: 'lora', body: 'golos-text' },
    })
    expect(files.map((file) => file.name.replace(/-[0-9a-f]{10}$/, ''))).toEqual([
      'golos-text-cyrillic-400-normal',
      'golos-text-latin-400-normal',
      'golos-text-latin-ext-400-normal',
      'golos-text-cyrillic-600-normal',
      'golos-text-latin-600-normal',
      'golos-text-latin-ext-600-normal',
      'lora-cyrillic-600-normal',
      'lora-latin-600-normal',
      'lora-latin-ext-600-normal',
    ])
    for (const file of files) {
      expect(file.url).toBe(`${FONTS_PREFIX}${file.name}.woff2`)
      // Настоящий WOFF2: сигнатура wOF2
      expect((await readFile(file.path)).subarray(0, 4).toString('latin1')).toBe('wOF2')
    }
  })

  it('@font-face ссылается на свой сервер, не на Google Fonts', async () => {
    const css = siteFontCss(
      await siteFontFiles({ ...defaultTheme, fonts: { heading: 'manrope', body: 'manrope' } }),
    )
    expect(css).toContain('font-family:"Manrope"')
    expect(css).toMatch(/src:url\("\/_fonts\/manrope-cyrillic-400-normal-[0-9a-f]{10}\.woff2"\)/)
    expect(css).not.toContain('googleapis')
  })

  it('знак рубля ₽ — шрифтом темы: отдельный файл с диапазоном U+20BD', async () => {
    const css = siteFontCss(
      await siteFontFiles({ ...defaultTheme, fonts: { heading: 'unbounded', body: 'manrope' } }),
    )
    const rubleFaces = css
      .split('@font-face')
      .filter((face) => face.includes('unicode-range:U+20BD}'))
      .map((face) =>
        /font-family:"([^"]+)";font-style:normal;font-weight:(\d+)/.exec(face)?.slice(1),
      )
    expect(rubleFaces).toEqual([
      ['Manrope', '400'],
      ['Manrope', '600'],
      ['Unbounded', '600'],
    ])
    expect(css).toMatch(/src:url\("\/_fonts\/unbounded-latin-ext-600-normal-[0-9a-f]{10}\.woff2"\)/)
  })

  it('системные шрифты — ни одного файла и пустой CSS', async () => {
    const files = await siteFontFiles(defaultTheme)
    expect(files).toEqual([])
    expect(siteFontCss(files)).toBe('')
  })
})
