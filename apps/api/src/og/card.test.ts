import type { OgCard } from '@averra/schema'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  cachedOgCards,
  layoutTitle,
  MAX_LINES,
  OG_HEIGHT,
  OG_WIDTH,
  OgCardsBusy,
  ogCardRenderers,
  ogCardSvg,
  PREVIEW_CACHE_SIZE,
  PREVIEW_MAX_PENDING,
  TITLE_SIZES,
} from './card'
import { golosShaper } from './golos'
import { renderOgCard } from './sharp-og'

// Карточка для соцсетей из заголовка: раскладка настоящим Golos Text и PNG через sharp

const card = (title: string, patch: Partial<OgCard> = {}): OgCard => ({
  title,
  siteName: 'Ремонт у Ивана',
  domain: 'remont.example',
  colors: { background: '#f5efe6', text: '#1c1917', muted: '#57534e', accent: '#c2410c' },
  ...patch,
})

/** Сколько пикселей цвета color (с допуском на сглаживание) в полосе y0…y1 */
async function pixelsOf(png: Uint8Array, color: string, [y0, y1]: [number, number]) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const target = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16))
  let count = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < info.width; x++) {
      const at = (y * info.width + x) * 3
      if (target.every((value, i) => Math.abs((data[at + i] ?? 0) - value) < 24)) count++
    }
  }
  return count
}

describe('раскладка заголовка', () => {
  it('короткий — одна строка самым крупным кеглем', () => {
    expect(layoutTitle('Цены', golosShaper)).toEqual({ size: TITLE_SIZES[0], lines: ['Цены'] })
  })

  it('длинный — переносится по словам и мельчает, но не больше трёх строк', () => {
    const { size, lines } = layoutTitle(
      'Ремонт квартир под ключ в Твери и области — фиксированная смета, свои бригады и гарантия три года',
      golosShaper,
    )
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES)
    expect(size).toBeLessThan(TITLE_SIZES[0])
    for (const line of lines) expect(golosShaper.width(line, size, 600)).toBeLessThanOrEqual(1040)
  })

  it('совсем длинный — последняя строка с многоточием', () => {
    const { lines } = layoutTitle('слово '.repeat(60), golosShaper)
    expect(lines).toHaveLength(MAX_LINES)
    expect(lines.at(-1)).toMatch(/…$/)
  })

  it('слово шире строки режется по буквам, пробелы схлопываются', () => {
    const { lines } = layoutTitle(`  ${'а'.repeat(60)}   б  `, golosShaper)
    expect(lines.join('')).toBe(`${'а'.repeat(60)} б`)
    expect(lines.length).toBeGreaterThan(1)
  })
})

describe('Golos Text', () => {
  it('кириллица, латиница, казахский и турецкий — из разных файлов шрифта, без NaN', () => {
    // «рт» — пара, на которой getPath у opentype.js отдаёт NaN
    const text = 'Квартира Ремонт Latin Қазақ ғ ә İstanbul ş №1'
    const d = golosShaper.path(text, 80, 200, 64, 600)
    expect(d).not.toMatch(/NaN|undefined/)
    expect(d.length).toBeGreaterThan(1000)
    expect(golosShaper.width(text, 64, 600)).toBeGreaterThan(golosShaper.width('Квартира', 64, 600))
  })

  it('символа нет в шрифте (эмодзи) — пропускается, а не ломает строку', () => {
    expect(golosShaper.width('Скидки 🔥', 40, 600)).toBe(golosShaper.width('Скидки ', 40, 600))
  })

  it('400 уже 600: начертания разные', () => {
    expect(golosShaper.width('Ремонт', 40, 400)).toBeLessThan(golosShaper.width('Ремонт', 40, 600))
  })
})

describe('SVG и PNG карточки', () => {
  it('в SVG нет текста — только контуры и цвета темы', () => {
    const svg = ogCardSvg(card('Цены <script>'), golosShaper)
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('<script')
    expect(svg).toContain('fill="#f5efe6"')
    expect(svg).toContain('fill="#c2410c"')
    expect(svg).not.toMatch(/NaN/)
  })

  it('PNG 1200 × 630: фон темы, заголовок цветом текста, домен — второстепенным', async () => {
    const png = await renderOgCard(card('Ремонт квартир под ключ'))
    const meta = await sharp(png).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', OG_WIDTH, OG_HEIGHT])
    expect(png.byteLength).toBeLessThan(60_000)
    // Заголовок — в верхней половине, подпись — внизу
    expect(await pixelsOf(png, '#1c1917', [160, 320])).toBeGreaterThan(2000)
    expect(await pixelsOf(png, '#57534e', [500, 560])).toBeGreaterThan(200)
    expect(await pixelsOf(png, '#f5efe6', [0, 60])).toBe(OG_WIDTH * 60)
  })

  it('без домена — только название сайта', () => {
    const svg = ogCardSvg(card('Цены', { domain: '' }), golosShaper)
    expect(svg).not.toContain('fill="#57534e"')
  })
})

describe('кеш карточек', () => {
  it('одна карточка рисуется один раз, сбой не запоминается', async () => {
    let calls = 0
    let fail = true
    const cards = cachedOgCards(async () => {
      calls += 1
      if (fail) throw new Error('сбой')
      return new Uint8Array([calls])
    })
    await expect(cards(card('А'))).rejects.toThrow('сбой')
    fail = false
    expect(await cards(card('А'))).toEqual(new Uint8Array([2]))
    expect(await cards(card('А'))).toEqual(new Uint8Array([2]))
    expect(await cards(card('Б'))).toEqual(new Uint8Array([3]))
    expect(calls).toBe(3)
  })

  it('предпросмотров ждёт не больше PREVIEW_MAX_PENDING, готовые отдаются и при полной очереди', async () => {
    const waiting: (() => void)[] = []
    const { preview } = ogCardRenderers(
      (drawn) =>
        new Promise((resolve) =>
          waiting.push(() => resolve(new TextEncoder().encode(drawn.title))),
        ),
    )
    const first = preview(card('0'))
    // Первая рисуется, остальные ждут в очереди — пока не наберётся предел
    const queued = Array.from({ length: PREVIEW_MAX_PENDING - 1 }, (_, i) =>
      preview(card(`${i + 1}`)),
    )
    await expect(preview(card('лишняя'))).rejects.toBeInstanceOf(OgCardsBusy)
    // Уже заказанная карточка — из кеша, а не новая отрисовка: отказа нет
    const again = preview(card('0'))
    while (waiting.length > 0) {
      waiting.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await Promise.all([first, ...queued])
    expect(await again).toEqual(await first)
    // Очередь разошлась — снова принимает
    const next = preview(card('после'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    waiting.shift()?.()
    expect(new TextDecoder().decode(await next)).toBe('после')
  })

  it('предпросмотры не вытесняют карточки сайта, а рисуется одна карточка за раз', async () => {
    let calls = 0
    let active = 0
    let most = 0
    const cards = ogCardRenderers(async (drawn) => {
      calls += 1
      active += 1
      most = Math.max(most, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return new TextEncoder().encode(drawn.title)
    })
    await Promise.all([cards.published(card('Цены')), cards.published(card('Акции'))])
    for (let i = 0; i < PREVIEW_CACHE_SIZE * 2; i++) await cards.preview(card(`Черновик ${i}`))
    const before = calls
    await cards.published(card('Цены'))
    await cards.published(card('Акции'))
    expect(calls).toBe(before)
    expect(most).toBe(1)
  })
})
