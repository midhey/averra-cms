import { legacyTheme } from '@averra/schema'
import { defaultTheme } from '@averra/tokens'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { apiTokens, sites } from '../../db/schema'
import { createTestApi } from '../../testing'
import { tokensRepo } from './repo'

const api = await createTestApi()
const tokens = tokensRepo(api.db)
const owner = await api.createUser('owner')

afterAll(api.close)

const rowOf = async (id: string) => {
  const [row] = await api.db.select().from(apiTokens).where(eq(apiTokens.id, id))
  if (!row) throw new Error(`Нет токена ${id}`)
  return row
}

describe('токены API', () => {
  it('выдаёт токен cms_<id>_<секрет>, а в базе хранит только SHA-256 от него', async () => {
    const { id, token } = await tokens.create({
      siteId: api.demoSiteId,
      name: 'mcp',
      createdBy: owner.id,
    })
    expect(token).toMatch(new RegExp(`^cms_${id}_[0-9a-f]{64}$`))

    const row = await rowOf(id)
    expect(row).toMatchObject({ siteId: api.demoSiteId, name: 'mcp', createdBy: owner.id })
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toContain(token.slice(-64))
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    expect(row.tokenHash).toBe(Buffer.from(digest).toString('hex'))
  })

  it('каждый токен свой', async () => {
    const a = await tokens.create({ siteId: api.demoSiteId, name: 'a' })
    const b = await tokens.create({ siteId: api.demoSiteId, name: 'b' })
    expect(a.token).not.toBe(b.token)
  })

  it('право на черновики блоков: выключено по умолчанию, включается и выключается, читается при проверке', async () => {
    const { id, token } = await tokens.create({ siteId: api.demoSiteId, name: 'mcp' })
    expect((await rowOf(id)).blocksDraft).toBe(false)
    expect(await tokens.setBlocksDraft(id, true)).toBe(true)
    expect((await tokens.verify(token))?.blocksDraft).toBe(true)
    expect(await tokens.setBlocksDraft(id, false)).toBe(true)
    expect((await tokens.verify(token))?.blocksDraft).toBe(false)
    expect(await tokens.setBlocksDraft(crypto.randomUUID(), true)).toBe(false)
    const granted = await tokens.create({ siteId: api.demoSiteId, name: 'mcp2', blocksDraft: true })
    expect((await tokens.verify(granted.token))?.blocksDraft).toBe(true)
  })

  it('проверка отдаёт сайт и отмечает, когда токеном пользовались', async () => {
    const { id, token } = await tokens.create({ siteId: api.demoSiteId, name: 'mcp' })
    expect((await rowOf(id)).lastUsedAt).toBeNull()
    expect(await tokens.verify(token)).toEqual({ id, siteId: api.demoSiteId, blocksDraft: false })
    expect((await rowOf(id)).lastUsedAt).toBeInstanceOf(Date)
  })

  it('верный id с чужим секретом не проходит', async () => {
    const { id } = await tokens.create({ siteId: api.demoSiteId, name: 'mcp' })
    const other = await tokens.create({ siteId: api.demoSiteId, name: 'other' })
    const forged = `cms_${id}_${other.token.slice(-64)}`
    expect(await tokens.verify(forged)).toBeUndefined()
    expect((await rowOf(id)).lastUsedAt).toBeNull()
  })

  it('отозванный не проходит; повторный отзыв не сдвигает время', async () => {
    const { id, token } = await tokens.create({ siteId: api.demoSiteId, name: 'mcp' })
    expect(await tokens.revoke(id)).toBe(true)
    const revokedAt = (await rowOf(id)).revokedAt
    expect(revokedAt).toBeInstanceOf(Date)
    expect(await tokens.verify(token)).toBeUndefined()
    expect(await tokens.revoke(id)).toBe(true)
    expect((await rowOf(id)).revokedAt).toEqual(revokedAt)
  })

  it('отзыв несуществующего — false', async () => {
    expect(await tokens.revoke('00000000-0000-4000-8000-000000000000')).toBe(false)
  })

  it('строки чужого формата отклоняются без запроса к базе', async () => {
    for (const value of ['', 'cms_', 'Bearer x', `cms_${'0'.repeat(36)}_${'0'.repeat(64)}`]) {
      expect(await tokens.verify(value)).toBeUndefined()
    }
  })

  it('список — без хешей, с сайтом и автором', async () => {
    const { id } = await tokens.create({
      siteId: api.demoSiteId,
      name: 'в списке',
      createdBy: owner.id,
    })
    const item = (await tokens.list()).find((token) => token.id === id)
    expect(item).toMatchObject({ name: 'в списке', siteId: api.demoSiteId, createdBy: owner.email })
    expect(item).not.toHaveProperty('tokenHash')
  })

  it('удаляется вместе с сайтом', async () => {
    const [site] = await api.db
      .insert(sites)
      .values({ name: 'Временный', theme: legacyTheme(defaultTheme) })
      .returning({ id: sites.id })
    if (!site) throw new Error('Сайт не создался')
    const { id } = await tokens.create({ siteId: site.id, name: 'temp' })
    await api.db.delete(sites).where(eq(sites.id, site.id))
    expect(await api.db.select().from(apiTokens).where(eq(apiTokens.id, id))).toEqual([])
  })
})
