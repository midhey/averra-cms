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
    expect(catalog.blocks.map((block) => block.type)).toEqual([
      'hero',
      'features',
      'text',
      'video',
      'cta',
      'form',
    ])
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

  it('задают и читают SEO страницы той же схемой и возвращают советы по нему', async () => {
    const ref = { slug: 'seo-mcp' }
    const seo = {
      title: 'Ремонт квартир под ключ в Твери — смета за день',
      description: 'Короткое',
      canonical: '/seo-mcp/',
      noindex: true,
    }
    const { seoChecks } = await tools.saveDraft(
      SaveDraftInput.parse({ ...ref, title: 'SEO', content: { ...demoPage, seo } }),
    )
    if (!seoChecks) throw new Error('Нет советов по SEO')
    // Описание короче 70 символов и noindex — советы; заголовок в самый раз — не совет
    expect(seoChecks.map((check) => check.title)).toEqual(
      expect.arrayContaining([
        'Описание короткое: 8 символов',
        'Страница скрыта от поисковиков (noindex)',
      ]),
    )
    expect(seoChecks.every((check) => check.level !== 'good')).toBe(true)

    const page = z
      .object({ draft: PageContent, seoChecks: z.array(z.object({ title: z.string() })) })
      .parse(await tools.getPage(ref))
    expect(page.draft.seo).toEqual(seo)
    expect(page.seoChecks).toEqual(seoChecks.map(({ title }) => ({ title })))
  })

  it('черновик, которого эта версия не знает целиком, не ломает get_page: только без советов', async () => {
    const ref = { slug: 'iz-budushchego' }
    await tools.saveDraft(SaveDraftInput.parse({ ...ref, title: 'Новее', content: demoPage }))
    // Так отвечает API после отката с более новой версии: в черновике незнакомые блок и поле SEO
    const future = cmsTools(
      hc<AppType>('http://cms.test', {
        fetch: async (input: string | URL | Request, init?: RequestInit) => {
          const res = await api.app.request(input, init)
          if (!String(input instanceof Request ? input.url : input).endsWith(`/pages/${ref.slug}`))
            return res
          const body = (await res.json()) as { draft: { blocks: unknown[]; seo?: object } }
          body.draft.blocks.push({ id: 'n', type: 'pricing', props: { plans: [] } })
          body.draft.seo = { title: 42, schema: 'Product' }
          return Response.json(body)
        },
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    const page = z
      .object({ title: z.string(), seoChecks: z.unknown() })
      .parse(await future.getPage(ref))
    expect(page.title).toBe('Новее')
    // Блоки и SEO разобраны нестрого: советы есть, а кривое поле просто не учтено
    expect(page.seoChecks).toEqual(expect.any(Array))
  })

  /** Инструменты против API, у которого ответ GET /api/sites/:siteId подменён */
  const toolsWithSite = (site: (res: Response) => Promise<Response>) =>
    cmsTools(
      hc<AppType>('http://cms.test', {
        fetch: async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input instanceof Request ? input.url : input)
          const res = await api.app.request(input, init)
          return url.endsWith(`/api/sites/${api.demoSiteId}`) ? site(res) : res
        },
        headers: { authorization: `Bearer ${token}` },
      }),
    )

  it('установка старше MCP (сайт без seo): get_page и save_draft работают, только без советов', async () => {
    const old = toolsWithSite(async (res) => {
      const { seo: _seo, ...site } = (await res.json()) as { seo?: unknown }
      return Response.json(site)
    })
    const ref = { slug: 'staraya' }
    const saved = await old.saveDraft(
      SaveDraftInput.parse({ ...ref, title: 'Старая установка', content: demoPage }),
    )
    expect(saved.seoChecks).toBeUndefined()
    const page = z
      .object({ title: z.string(), seoChecks: z.unknown() })
      .parse(await old.getPage(ref))
    expect(page.title).toBe('Старая установка')
    expect(page.seoChecks).toBeUndefined()
  })

  it('сбой запроса сайта после сохранения — не ошибка: черновик сохранён, советов нет', async () => {
    const broken = toolsWithSite(async () => {
      throw new TypeError('fetch failed')
    })
    const ref = { slug: 'sboy-saita' }
    const saved = await broken.saveDraft(
      SaveDraftInput.parse({ ...ref, title: 'Сохранено', content: demoPage }),
    )
    expect(saved.seoChecks).toBeUndefined()
    // Черновик и правда сохранён: обычные инструменты его видят
    const page = z.object({ title: z.string() }).parse(await tools.getPage(ref))
    expect(page.title).toBe('Сохранено')

    const failing = toolsWithSite(async () => Response.json({ error: 'Сбой' }, { status: 500 }))
    const read = z.object({ seoChecks: z.unknown() }).parse(await failing.getPage(ref))
    expect(read.seoChecks).toBeUndefined()
  })

  it('правила каталога — про SEO страницы', () => {
    const rules = blockCatalog().rules.join('\n')
    expect(rules).toContain('seo.image')
    expect(rules).toContain('seoChecks')
    expect(rules).toMatch(/30–60 символов/)
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

describe('тема сайта', () => {
  it('get_theme отдаёт тему на сайте с названиями шрифтов, без права её менять', async () => {
    const result = await tools.getTheme({})
    expect(result.theme.colors.accent).toMatch(/^#[0-9a-f]{6}$/i)
    expect(result.fonts).toEqual({ heading: 'Системный', body: 'Системный' })
    expect(result.unpublishedDraft).toBe(false)
    // Тот же токен записать тему не может: тему меняют в админке
    const res = await clientWith(token).api.sites[':siteId'].theme.$put({
      param: { siteId: site.id },
      json: result.theme,
    })
    expect(res.status).toBe(403)
  })
})
