import { afterAll, describe, expect, it } from 'vitest'
import { tokensRepo } from '../modules/tokens/repo'
import { createTestApi } from '../testing'
import { CliError } from './common'
import { grantRights, parseTokenCreate, parseTokenGrant } from './token-args'

// token:create и token:grant: разбор аргументов и выдача прав. Значения по умолчанию — как у
// выпуска в админке: «только черновики»

const api = await createTestApi()
afterAll(api.close)

const id = '0b6f0d4e-1c2a-4f3b-9d8e-7a6b5c4d3e2f'

describe('token:create', () => {
  it('по умолчанию — «только черновики»: черновики блоков да, публикация и удаление нет', () => {
    expect(parseTokenCreate(['--name', 'mcp']).rights).toEqual({
      blocksDraft: true,
      publish: false,
      delete: false,
    })
  })

  it('--publish и --delete включают права, --no-blocks-draft снимает черновики блоков', () => {
    expect(
      parseTokenCreate(['--name', 'mcp', '--publish', '--delete', '--no-blocks-draft']).rights,
    ).toEqual({ blocksDraft: false, publish: true, delete: true })
  })

  it('прежний --blocks-draft принимается: право и так включено', () => {
    expect(parseTokenCreate(['--name', 'mcp', '--blocks-draft']).rights.blocksDraft).toBe(true)
    expect(() =>
      parseTokenCreate(['--name', 'mcp', '--blocks-draft', '--no-blocks-draft']),
    ).toThrow(CliError)
  })

  it('флаги без значения: «on» после них — лишний аргумент', () => {
    expect(() => parseTokenCreate(['--name', 'mcp', '--blocks-draft', 'on'])).toThrow(CliError)
    expect(() => parseTokenCreate(['--name', 'mcp', '--publish', 'on'])).toThrow(CliError)
  })

  it('имя — одной строкой', () => {
    expect(() => parseTokenCreate(['--name', 'два\nимени'])).toThrow(/одной строкой/)
  })
})

describe('token:grant', () => {
  it('меняет только названные права', () => {
    expect(parseTokenGrant(['--id', id, '--blocks-draft', 'on'])).toEqual({
      id,
      rights: { blocksDraft: true },
    })
    expect(parseTokenGrant(['--id', id, '--publish', 'on', '--delete', 'off'])).toEqual({
      id,
      rights: { publish: true, delete: false },
    })
  })

  it('кривое значение, кривой id и ни одного права — понятными словами и с подсказкой', () => {
    expect(() => parseTokenGrant(['--id', id, '--blocks-draft', 'yes'])).toThrow(
      /Нужно on или off[\s\S]*token:grant/,
    )
    expect(() => parseTokenGrant(['--id', 'abc', '--publish', 'on'])).toThrow(/Нужен id токена/)
    expect(() => parseTokenGrant(['--blocks-draft', 'on'])).toThrow(CliError)
    expect(() => parseTokenGrant(['--id', id])).toThrow(/Укажите право/)
  })

  it('включает и выключает права сразу; чужой id — отказ', async () => {
    const { id: tokenId, token } = await api.createToken(undefined, 'тест', {
      publish: false,
      delete: false,
    })
    expect(await grantRights(api.db, tokenId, { blocksDraft: true, publish: true })).toMatch(
      /Публикация страниц — да/,
    )
    expect((await tokensRepo(api.db).verify(token))?.rights).toEqual({
      blocksDraft: true,
      publish: true,
      delete: false,
    })
    expect(await grantRights(api.db, tokenId, { blocksDraft: false })).toMatch(
      /Черновики своих блоков — нет/,
    )
    expect((await tokensRepo(api.db).verify(token))?.rights.blocksDraft).toBe(false)
    await expect(grantRights(api.db, id, { publish: true })).rejects.toThrow(`Нет токена ${id}`)
  })
})
