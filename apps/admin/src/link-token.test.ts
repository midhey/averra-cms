import { describe, expect, it } from 'vitest'
import { tokenFromHash } from './link-token'

describe('токен из ссылки письма', () => {
  it('берёт token из фрагмента, с решёткой и без, раскодирует', () => {
    expect(tokenFromHash('#token=abc123')).toBe('abc123')
    expect(tokenFromHash('token=a%2Bb')).toBe('a+b')
    expect(tokenFromHash('#other=1&token=inv_x')).toBe('inv_x')
  })

  it('нет токена или он пустой — undefined', () => {
    expect(tokenFromHash('')).toBeUndefined()
    expect(tokenFromHash('#')).toBeUndefined()
    expect(tokenFromHash('#token=')).toBeUndefined()
    expect(tokenFromHash('#token=%20')).toBeUndefined()
  })
})
