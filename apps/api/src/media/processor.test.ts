import { describe, expect, it } from 'vitest'
import { concurrencyLimit, variantFormats, variantWidths } from './processor'

describe('ширины вариантов', () => {
  it.each([
    [4000, [480, 960, 1440, 1920]],
    [1920, [480, 960, 1440, 1920]],
    [1500, [480, 960, 1440, 1500]],
    [960, [480, 960]],
    [700, [480, 700]],
    [480, [480]],
    [100, [100]],
  ])(
    'исходник %i px → %j: не шире исходника, сам исходник — если он меньше 1920',
    (width, expected) => {
      expect(variantWidths(width)).toEqual(expected)
    },
  )
})

describe('форматы вариантов', () => {
  it('JPEG и PNG остаются запасным форматом рядом с AVIF и WebP', () => {
    expect(variantFormats('jpeg')).toEqual(['avif', 'webp', 'jpeg'])
    expect(variantFormats('png')).toEqual(['avif', 'webp', 'png'])
  })

  it('WebP и AVIF — только AVIF и WebP: запасным будет WebP', () => {
    expect(variantFormats('webp')).toEqual(['avif', 'webp'])
    expect(variantFormats('avif')).toEqual(['avif', 'webp'])
  })
})

describe('очередь обработки', () => {
  it('одновременно идёт не больше limit задач, результаты и ошибки доходят до своих', async () => {
    const run = concurrencyLimit(2)
    let active = 0
    let peak = 0
    const task = (value: number, fail = false) =>
      run(async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        if (fail) throw new Error(`сбой ${value}`)
        return value
      })

    const results = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((n) => task(n, n === 2)))
    expect(peak).toBe(2)
    expect(
      results.map((result) => (result.status === 'fulfilled' ? result.value : 'сбой')),
    ).toEqual([1, 'сбой', 3, 4, 5, 6])
    // Ошибка освободила место: очередь не застряла
    expect(await task(7)).toBe(7)
  })
})
