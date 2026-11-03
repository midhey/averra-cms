import { describe, expect, it } from 'vitest'
import { plainAccent } from './text-body'

describe('plainAccent', () => {
  it('снимает звёздочки акцента, текст остаётся', () => {
    expect(plainAccent('Привет, я *Лера*')).toBe('Привет, я Лера')
    expect(plainAccent('Английский, *который вписывается* в твою жизнь')).toBe(
      'Английский, который вписывается в твою жизнь',
    )
  })

  it('звёздочка без пары и через перенос строки — как есть', () => {
    expect(plainAccent('5 * 3')).toBe('5 * 3')
    expect(plainAccent('*одна\nдве*')).toBe('*одна\nдве*')
  })
})
