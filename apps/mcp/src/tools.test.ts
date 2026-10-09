import type { AppType } from '@cms/api'
import { createTestApi } from '@cms/api/testing'
import { demoPage, PageContent } from '@cms/schema'
import { hc } from 'hono/client'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { blockCatalog, cmsTools, SaveDraftInput } from './tools'

// Настоящая цепочка без сети: инструменты → типизированный клиент → API → база в памяти
const { app, close } = await createTestApi()
const fetchFromApp = async (input: string | URL | Request, init?: RequestInit) =>
  app.request(input, init)
const tools = cmsTools(hc<AppType>('http://cms.test', { fetch: fetchFromApp }))
const [site] = z.array(z.object({ id: z.string() })).parse(await tools.listSites())
if (!site) throw new Error('Демо-сайт не создался')

afterAll(close)

describe('каталог блоков', () => {
  it('отдаёт все блоки с JSON Schema и подписями полей', () => {
    const catalog = blockCatalog()
    expect(catalog.blocks.map((block) => block.type)).toEqual(['hero', 'features', 'cta'])
    expect(catalog.blocks[0]?.props).toMatchObject({
      properties: { title: { title: 'Заголовок' } },
    })
  })

  it('схема save_draft переводится в JSON Schema — в таком виде её видит нейронка', () => {
    expect(() => z.toJSONSchema(SaveDraftInput, { io: 'input' })).not.toThrow()
  })
})

describe('инструменты', () => {
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
