import type { AppType } from '@averra/api'
import { createTestApi } from '@averra/api/testing'
import { demoPage, PageContent } from '@averra/schema'
import { hc } from 'hono/client'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { blockCatalog, cmsTools, missingTokenMessage, SaveDraftInput } from './tools'

// Настоящая цепочка без сети: инструменты → типизированный клиент с токеном → API → база в памяти
const api = await createTestApi()
const fetchFromApp = async (input: string | URL | Request, init?: RequestInit) =>
  api.app.request(input, init)
/** Клиент API так, как его собирает index.ts: токен в заголовке Authorization */
const clientWith = (token: string) =>
  hc<AppType>('http://cms.test', {
    fetch: fetchFromApp,
    headers: { authorization: `Bearer ${token}` },
  })
const { token } = await api.createToken(api.demoSiteId, 'mcp')
const tools = cmsTools(clientWith(token))
const [site] = z.array(z.object({ id: z.string() })).parse(await tools.listSites())
if (!site) throw new Error('Демо-сайт не создался')

afterAll(api.close)

describe('каталог блоков', () => {
  it('отдаёт все блоки с JSON Schema и подписями полей', () => {
    const catalog = blockCatalog()
    expect(catalog.blocks.map((block) => block.type)).toEqual(['hero', 'features', 'cta', 'form'])
    expect(catalog.blocks[0]?.props).toMatchObject({
      properties: { title: { title: 'Заголовок' } },
    })
  })

  it('у каждого блока — описание одной фразой: по нему нейронка выбирает блок', () => {
    for (const block of blockCatalog().blocks) {
      expect(block.description, block.type).toEqual(expect.any(String))
      expect(block.description.trim().length, block.type).toBeGreaterThan(10)
      expect(block.description, block.type).not.toMatch(/\.$/u)
    }
  })

  it('схема save_draft переводится в JSON Schema — в таком виде её видит нейронка', () => {
    expect(() => z.toJSONSchema(SaveDraftInput, { io: 'input' })).not.toThrow()
  })
})

describe('инструменты', () => {
  it('без siteId работают на сайте токена: в установке сайт один, id искать не нужно', async () => {
    const ref = { slug: 'bez-id' }
    await tools.saveDraft(SaveDraftInput.parse({ ...ref, title: 'Без id', content: demoPage }))
    await tools.publishPage(ref)
    const page = z
      .object({ siteId: z.string(), published: PageContent.nullable() })
      .parse(await tools.getPage(ref))
    expect(page.siteId).toBe(api.demoSiteId)
    expect(page.published?.blocks).toHaveLength(3)
  })

  it('проводят страницу от черновика до публикации', async () => {
    const ref = { siteId: site.id, slug: 'coffee' }
    await tools.saveDraft(SaveDraftInput.parse({ ...ref, title: 'Кофейня', content: demoPage }))
    await tools.publishPage(ref)

    const page = z.object({ published: PageContent.nullable() }).parse(await tools.getPage(ref))
    expect(page.published?.blocks).toHaveLength(3)
  })

  it('возвращают ошибку API с путём до кривого поля', async () => {
    const button = { label: 'Жми', href: 'javascript:alert(1)' }
    const save = tools.saveDraft({
      siteId: site.id,
      slug: 'index',
      title: 'Взлом',
      content: { blocks: [{ id: 'c', type: 'cta', props: { title: 'Жми', button } }] },
    })
    await expect(save).rejects.toThrow('content.blocks.0.props.button.href')
  })
})

describe('токен', () => {
  it('list_sites отдаёт только сайт токена', async () => {
    expect(await tools.listSites()).toEqual([{ id: api.demoSiteId, name: expect.any(String) }])
  })

  it('без токена инструменты с API объясняют, как его получить', async () => {
    const noToken = cmsTools(undefined)
    await expect(noToken.listSites()).rejects.toThrow(missingTokenMessage)
    await expect(noToken.getPage({ siteId: site.id, slug: 'index' })).rejects.toThrow(
      'pnpm token:create --name mcp',
    )
    await expect(noToken.getPage({ slug: 'index' })).rejects.toThrow(missingTokenMessage)
  })

  it('отозванный токен — понятная ошибка, а не «API ответил 401»', async () => {
    const revoked = await api.createToken(api.demoSiteId, 'старый')
    await api.revokeToken(revoked.id)
    const stale = cmsTools(clientWith(revoked.token))
    await expect(stale.listSites()).rejects.toThrow(/не принял токен.*pnpm token:create/s)
  })

  it('токен другого сайта не видит этот сайт', async () => {
    // Так бывает только в старых базах: API сайтов не создаёт, сайт кладётся напрямую
    const other = await api.createSite('Другой сайт')
    const otherTools = cmsTools(clientWith((await api.createToken(other)).token))
    await expect(otherTools.getPage({ siteId: site.id, slug: 'index' })).rejects.toThrow(
      'Сайт не найден',
    )
    // Без siteId — свой сайт токена, а не сайт установки
    const own = z.object({ siteId: z.string() }).parse(await otherTools.getPage({ slug: 'index' }))
    expect(own.siteId).toBe(other)
  })
})
