import { afterAll, describe, expect, it } from 'vitest'
import { tokensRepo } from '../modules/tokens/repo'
import { createTestApi } from '../testing'
import { CliError } from './common'
import { grantBlocksDraft, parseTokenCreate, parseTokenGrant } from './token-args'

// token:create --blocks-draft и token:grant: разбор аргументов и выдача права

const api = await createTestApi()
afterAll(api.close)

const id = '0b6f0d4e-1c2a-4f3b-9d8e-7a6b5c4d3e2f'

describe('token:create', () => {
  it('без --blocks-draft право выключено, с ним — включено', () => {
    expect(parseTokenCreate(['--name', 'mcp']).blocksDraft).toBe(false)
    expect(parseTokenCreate(['--name', 'mcp', '--blocks-draft']).blocksDraft).toBe(true)
  })

  it('--blocks-draft — флаг без значения: «on» после него — лишний аргумент', () => {
    expect(() => parseTokenCreate(['--name', 'mcp', '--blocks-draft', 'on'])).toThrow(CliError)
  })
})

describe('token:grant', () => {
  it('on и off', () => {
    expect(parseTokenGrant(['--id', id, '--blocks-draft', 'on'])).toEqual({ id, allowed: true })
    expect(parseTokenGrant(['--id', id, '--blocks-draft', 'off'])).toEqual({ id, allowed: false })
  })

  it('кривое значение и кривой id — понятными словами и с подсказкой', () => {
    expect(() => parseTokenGrant(['--id', id, '--blocks-draft', 'yes'])).toThrow(
      /Нужно on или off[\s\S]*token:grant/,
    )
    expect(() => parseTokenGrant(['--id', 'abc', '--blocks-draft', 'on'])).toThrow(
      /Нужен id токена/,
    )
    expect(() => parseTokenGrant(['--blocks-draft', 'on'])).toThrow(CliError)
  })

  it('включает и выключает право; чужой id — отказ', async () => {
    const { id: tokenId, token } = await api.createToken()
    expect(await grantBlocksDraft(api.db, tokenId, true)).toMatch(/разрешены/)
    expect((await tokensRepo(api.db).verify(token))?.blocksDraft).toBe(true)
    expect(await grantBlocksDraft(api.db, tokenId, false)).toMatch(/выключено/)
    expect((await tokensRepo(api.db).verify(token))?.blocksDraft).toBe(false)
    await expect(grantBlocksDraft(api.db, id, true)).rejects.toThrow(`Нет токена ${id}`)
  })
})
