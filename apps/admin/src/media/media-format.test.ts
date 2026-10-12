import { describe, expect, it } from 'vitest'
import {
  deleteQuestion,
  formatBytes,
  mediaMapOf,
  mediaSummary,
  thumbnailUrl,
  tooLargeMessage,
} from './media-format'

const variant = (format: 'avif' | 'webp' | 'jpeg', width: number) => ({
  format,
  width,
  height: width / 2,
  size: width * 10,
  url: `/api/media/id/${width}.${format}`,
})

describe('вес файла', () => {
  it.each([
    [820, '820 Б'],
    [14 * 1024, '14 КБ'],
    [1536, '2 КБ'],
    [2.4 * 1024 * 1024, '2,4 МБ'],
    [10 * 1024 * 1024, '10 МБ'],
  ])('%i байт → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })

  it('подпись под превью — размеры и вес', () => {
    expect(mediaSummary({ width: 1200, height: 800, size: 240 * 1024 })).toBe('1200 × 800 · 240 КБ')
  })
})

describe('превью', () => {
  it('самый маленький WebP, а не AVIF и не запасной JPEG', () => {
    const variants = [
      variant('avif', 480),
      variant('webp', 960),
      variant('webp', 480),
      variant('jpeg', 300),
    ]
    expect(thumbnailUrl(variants)).toBe('/api/media/id/480.webp')
  })

  it('без WebP — самый маленький из того, что есть; без вариантов — ничего', () => {
    expect(thumbnailUrl([variant('jpeg', 960), variant('jpeg', 480)])).toBe(
      '/api/media/id/480.jpeg',
    )
    expect(thumbnailUrl([])).toBeUndefined()
  })
})

describe('справочник для предпросмотра', () => {
  it('по id картинки — размеры и варианты без веса, как в снимке сайта', () => {
    const map = mediaMapOf([{ id: 'a', width: 960, height: 480, variants: [variant('webp', 960)] }])
    expect(map).toEqual({
      a: {
        width: 960,
        height: 480,
        variants: [{ format: 'webp', width: 960, height: 480, url: '/api/media/id/960.webp' }],
      },
    })
  })
})

it('вопрос перед удалением называет файл', () => {
  expect(deleteQuestion({ originalName: 'кухня.jpg' })).toBe(
    'Удалить картинку «кухня.jpg» из медиатеки? Вернуть её не получится.',
  )
})

describe('размер до отправки', () => {
  const limit = 10 * 1024 * 1024

  it('файл больше лимита — тот же текст, что у API, запрос не нужен', () => {
    expect(tooLargeMessage({ size: 18 * 1024 * 1024 }, limit)).toBe(
      'Файл больше 10 МБ. Уменьшите картинку и загрузите снова',
    )
  })

  it('файл в пределах лимита или лимит ещё неизвестен — решает API', () => {
    expect(tooLargeMessage({ size: limit }, limit)).toBeUndefined()
    expect(tooLargeMessage({ size: 50 * 1024 * 1024 }, undefined)).toBeUndefined()
  })
})
