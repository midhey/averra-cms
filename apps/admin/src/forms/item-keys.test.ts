import { describe, expect, it } from 'vitest'
import { syncKeys } from './item-keys'

const counter = () => {
  let n = 0
  return () => `k${n++}`
}

describe('ключи пунктов списка', () => {
  it('достраивает новые ключи в конец, не трогая прежние', () => {
    const make = counter()
    const first = syncKeys([], 2, make)
    expect(first).toEqual(['k0', 'k1'])
    expect(syncKeys(first, 4, make)).toEqual(['k0', 'k1', 'k2', 'k3'])
  })

  it('обрезает лишние с конца', () => {
    expect(syncKeys(['a', 'b', 'c'], 1, counter())).toEqual(['a'])
  })

  it('при той же длине возвращает тот же массив', () => {
    const keys = ['a', 'b']
    expect(syncKeys(keys, 2, counter())).toBe(keys)
  })

  it('новые ключи не повторяют прежние, даже после удаления', () => {
    const make = counter()
    const shrunk = syncKeys(syncKeys([], 3, make), 1, make)
    const grown = syncKeys(shrunk, 3, make)
    expect(new Set(grown).size).toBe(3)
  })
})
