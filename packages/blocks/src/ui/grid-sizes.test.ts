import { describe, expect, it } from 'vitest'
import { gridSizes } from './grid-sizes'

describe('gridSizes', () => {
  it('колонки по точкам CSS: шире контейнера — rem, до него — доля экрана', () => {
    expect(
      gridSizes(1, [
        [40, 2],
        [64, 4],
      ]),
    ).toBe('(min-width: 72rem) 18rem, (min-width: 64rem) 25vw, (min-width: 40rem) 50vw, 100vw')
  })

  it('точка, где число колонок не меняется, пропускается', () => {
    expect(
      gridSizes(2, [
        [40, 2],
        [64, 2],
      ]),
    ).toBe('(min-width: 72rem) 36rem, 50vw')
  })

  it('одна колонка всегда — контейнер или экран целиком', () => {
    expect(gridSizes(1)).toBe('(min-width: 72rem) 72rem, 100vw')
  })
})
