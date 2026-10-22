import { describe, expect, it } from 'vitest'
import { countRu, pluralRu } from './plural'

const sites = ['сайт', 'сайта', 'сайтов'] as const

describe('pluralRu', () => {
  it.each([
    [1, 'сайт'],
    [2, 'сайта'],
    [5, 'сайтов'],
    [11, 'сайтов'],
    [12, 'сайтов'],
    [21, 'сайт'],
    [22, 'сайта'],
    [111, 'сайтов'],
    [0, 'сайтов'],
  ])('%i — %s', (count, word) => {
    expect(pluralRu(count, sites)).toBe(word)
  })

  it('countRu — число и слово', () => {
    expect(countRu(3, sites)).toBe('3 сайта')
  })
})
