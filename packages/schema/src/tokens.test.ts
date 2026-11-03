import { describe, expect, it } from 'vitest'
import { NewToken, TokenRightsPatch } from './tokens'

describe('выпуск токена', () => {
  it('без прав — «только черновики»; названные права поверх них', () => {
    expect(NewToken.parse({ name: ' mcp ' })).toEqual({
      name: 'mcp',
      rights: { blocksDraft: true, publish: false, delete: false },
    })
    expect(NewToken.parse({ name: 'mcp', rights: { publish: true } }).rights).toEqual({
      blocksDraft: true,
      publish: true,
      delete: false,
    })
  })

  it('лишнее право и пустое имя не проходят', () => {
    expect(NewToken.safeParse({ name: 'mcp', rights: { admin: true } }).success).toBe(false)
    expect(NewToken.safeParse({ name: '   ' }).success).toBe(false)
    expect(NewToken.safeParse({ name: 'два\nимени' }).success).toBe(false)
  })
})

describe('правка прав', () => {
  it('нужно хотя бы одно право', () => {
    expect(TokenRightsPatch.safeParse({}).success).toBe(false)
    expect(TokenRightsPatch.parse({ delete: true })).toEqual({ delete: true })
  })
})
