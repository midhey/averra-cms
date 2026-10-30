import type { AppType } from '@averra/api'
import { createTestApi } from '@averra/api/testing'
import { demoPage, PageContent } from '@averra/schema'
import { hc } from 'hono/client'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  blockCatalog,
  CheckCustomBlockInput,
  cmsTools,
  missingTokenMessage,
  SaveCustomBlockInput,
  SaveDraftInput,
} from './tools'

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
      'text-image',
      'features',
      'stats',
      'steps',
      'pricing',
      'gallery',
      'reviews',
      'clients',
      'team',
      'faq',
      'cta',
      'form',
      'contacts',
      'video',
      'text',
    ])
    // Раздел каталога — подписью для людей: по нему нейронка выбирает место блока на странице
    expect(catalog.blocks.find((block) => block.type === 'faq')?.category).toBe('Доверие')
    expect(catalog.blocks.find((block) => block.type === 'contacts')?.category).toBe('Связь')
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

  it('свои блоки сайта — после встроенных, только опубликованные, со схемой полей', async () => {
    const owner = await api.loginAs('owner')
    const headers = { ...owner.headers, 'content-type': 'application/json' }
    const base = `/api/sites/${api.demoSiteId}/custom-blocks`
    const drafts: Record<string, unknown> = {}
    for (const key of ['tariffs', 'draft-only']) {
      const res = await api.app.request(base, {
        method: 'POST',
        headers,
        body: JSON.stringify({ key, title: 'Тарифы' }),
      })
      expect(res.status).toBe(201)
      drafts[key] = ((await res.json()) as { draft: unknown }).draft
    }
    // Публикуется черновик, который видел человек
    const published = await api.app.request(`${base}/tariffs/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ draft: drafts.tariffs }),
    })
    expect(published.status).toBe(200)
    const catalog = await tools.listBlocks()
    const own = catalog.blocks.filter((block) => block.custom)
    expect(own.map((block) => block.type)).toEqual(['custom:tariffs'])
    expect(own[0]?.props).toMatchObject({ properties: { title: { title: 'Заголовок' } } })
    // Свой блок проходит save_draft так же, как встроенный
    const content = {
      blocks: [{ id: 'tariffs-1', type: 'custom:tariffs', props: own[0]?.example }],
    }
    await tools.saveDraft({ slug: 'svoi', title: 'Свои', content: PageContent.parse(content) })
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

describe('шапка сайта', () => {
  it('get_header: шапки на сайте ещё нет — так и говорит; менять её токену нельзя', async () => {
    const result = await tools.getHeader({})
    expect(result.header).toBeNull()
    expect(result.note).toMatch(/Шапку ещё не публиковали/)
    expect(result.draft).toMatchObject({ layout: 'classic', layoutTitle: 'Классика', menu: [] })
    const res = await clientWith(token).api.sites[':siteId'].header.$put({
      param: { siteId: site.id },
      json: { layout: 'minimal' },
    })
    expect(res.status).toBe(403)
  })

  it('get_header: пункты меню — с адресами на сайте', async () => {
    const owner = await api.loginAs('owner')
    const menu = [{ label: 'Связаться', page: 'index', block: 'contact' }]
    const headers = { ...owner.headers, 'content-type': 'application/json' }
    const url = `/api/sites/${site.id}/header`
    expect(
      (await api.app.request(url, { method: 'PUT', headers, body: JSON.stringify({ menu }) }))
        .status,
    ).toBe(200)
    expect(
      (await api.app.request(`${url}/publish`, { method: 'POST', headers: owner.headers })).status,
    ).toBe(200)
    const result = await tools.getHeader({})
    expect(result.header?.menu).toEqual([{ ...menu[0], href: '/#contact' }])
    expect(result.unpublishedDraft).toBe(false)
  })
})

const granted = await api.createToken(api.demoSiteId, 'mcp с правом', { blocksDraft: true })
const drafts = cmsTools(clientWith(granted.token))
const owner = await api.loginAs('owner')
const ownerHeaders = { ...owner.headers, 'content-type': 'application/json' }

describe('свои блоки: черновики через MCP', () => {
  const base = `/api/sites/${api.demoSiteId}/custom-blocks`

  const definition = SaveCustomBlockInput.parse({
    definition: {
      key: 'mcp-promo',
      title: 'Промо от нейронки',
      description: 'Заголовок, текст и кнопка',
      category: 'sales',
      fields: [
        { type: 'text', name: 'title', label: 'Заголовок', required: true },
        { type: 'link', name: 'button', label: 'Кнопка' },
      ],
      template:
        '<h2 class="title">{{ title }}</h2>{% if button %}<a class="button" href="{{ button | link }}">{{ button.label }}</a>{% endif %}',
      css: '.title { font-family: var(--font-heading) }',
      example: { title: 'Привет', button: { label: 'Записаться', href: '/zapis' } },
    },
  })

  it('схемы входа новых инструментов переводятся в JSON Schema', () => {
    expect(() => z.toJSONSchema(SaveCustomBlockInput, { io: 'input' })).not.toThrow()
    expect(() => z.toJSONSchema(CheckCustomBlockInput, { io: 'input' })).not.toThrow()
  })

  it('без права на черновики инструменты отвечают, как его включить', async () => {
    await expect(tools.saveCustomBlockDraft(definition)).rejects.toThrow(/pnpm token:grant/)
    await expect(tools.getCustomBlock({ key: 'mcp-promo' })).rejects.toThrow(/pnpm token:grant/)
    await expect(tools.checkCustomBlock({ definition: definition.definition })).rejects.toThrow(
      /pnpm token:grant/,
    )
    // Список опубликованного доступен и без права, как list_blocks
    const list = await tools.listCustomBlocks()
    expect(list.blocks.every((block) => block.published)).toBe(true)
    expect(list.rules.join('\n')).toContain('Без JavaScript')
  })

  it('сохраняет черновик (создаёт блок), проверяет, показывает HTML; публикует только человек', async () => {
    const saved = await drafts.saveCustomBlockDraft(definition)
    expect(saved).toMatchObject({ created: true, hasUnpublishedChanges: true })
    expect(saved.problems).toEqual([])
    // Повторное сохранение — тот же блок, не создание
    expect(await drafts.saveCustomBlockDraft(definition)).toMatchObject({ created: false })

    const checked = await drafts.checkCustomBlock({ key: 'mcp-promo' })
    expect(checked.verdict).toMatch(/Ошибок нет/)
    expect(checked.html).toContain('<a class="button" href="/zapis">Записаться</a>')

    // Свои данные вместо примера: пустая кнопка — блок выглядит правильно без неё
    const without = await drafts.checkCustomBlock({
      key: 'mcp-promo',
      data: { title: 'Только заголовок' },
    })
    expect(without.html).not.toContain('<a')

    const list = await drafts.listCustomBlocks()
    const own = list.blocks.find((block) => block.key === 'mcp-promo')
    expect(own).toMatchObject({ published: false, definition: { key: 'mcp-promo' } })
    expect(own?.state).toMatch(/только черновик/)

    // Токен публиковать не может, даже с правом
    const res = await clientWith(granted.token).api.sites[':siteId']['custom-blocks'][
      ':key'
    ].publish.$post({
      param: { siteId: site.id, key: 'mcp-promo' },
      json: { draft: definition.definition },
    })
    expect(res.status).toBe(403)

    // На страницу такой блок не встаёт, пока человек не опубликует: страницу проверяют по опубликованному
    const onPage = tools.saveDraft({
      slug: 'promo',
      title: 'Промо',
      content: PageContent.parse({
        blocks: [{ id: 'promo-1', type: 'custom:mcp-promo', props: { title: 'Привет' } }],
      }),
    })
    await expect(onPage).rejects.toThrow(/mcp-promo/)

    // Человек публикует — страница принимает блок
    expect(
      (
        await api.app.request(`${base}/mcp-promo/publish`, {
          method: 'POST',
          headers: ownerHeaders,
          body: JSON.stringify({ draft: definition.definition }),
        })
      ).status,
    ).toBe(200)
    await tools.saveDraft({
      slug: 'promo',
      title: 'Промо',
      content: PageContent.parse({
        blocks: [{ id: 'promo-1', type: 'custom:mcp-promo', props: { title: 'Привет' } }],
      }),
    })
  })

  it('ошибки шаблона возвращаются со строкой и частью — нейронка правит по ним', async () => {
    const broken = SaveCustomBlockInput.parse({
      definition: {
        ...definition.definition,
        key: 'mcp-broken',
        template: '<h2>{{ title }}</h2>\n<script>alert(1)</script>\n<p>{{ nope }}</p>',
      },
    })
    const saved = await drafts.saveCustomBlockDraft(broken)
    expect(saved.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ part: 'template', level: 'error', line: 2 }),
        expect.objectContaining({ part: 'template', level: 'error', line: 3 }),
      ]),
    )
    const checked = await drafts.checkCustomBlock({ key: 'mcp-broken' })
    expect(checked.verdict).toMatch(/Ошибок: \d/)
    // Структура полей, которую API не примет, — ошибка с путём
    await expect(
      drafts.checkCustomBlock({
        definition: {
          ...definition.definition,
          fields: [{ type: 'text', name: 'Bad Name', label: 'x', required: false, maxLength: 10 }],
        },
      }),
    ).rejects.toThrow(/fields/)
  })

  it('у проверки нужен ровно один из key и definition', () => {
    expect(CheckCustomBlockInput.safeParse({}).success).toBe(false)
    expect(
      CheckCustomBlockInput.safeParse({ key: 'a-b', definition: definition.definition }).success,
    ).toBe(false)
    expect(CheckCustomBlockInput.safeParse({ key: 'a-b' }).success).toBe(true)
  })

  it('без токена инструменты объясняют, как его получить', async () => {
    await expect(cmsTools(undefined).listCustomBlocks()).rejects.toThrow(missingTokenMessage)
  })
})
