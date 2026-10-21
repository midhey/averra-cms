import type { AppType } from '@averra/api'
import { blocks, describeApiError, PageContent, PageSlug, PageTitle, Uuid } from '@averra/schema'
import type { McpServer } from '@modelcontextprotocol/server'
import type { ClientResponse, hc } from 'hono/client'
import { z } from 'zod'

export type Api = ReturnType<typeof hc<AppType>>

const PageRef = z.object({
  // Одна установка — один сайт, и токен выпущен на него: id указывать не нужно
  siteId: Uuid()
    .optional()
    .describe('Id сайта. Не нужен: по умолчанию — сайт, на который выпущен токен'),
  slug: PageSlug.default('index').describe(
    'Адрес страницы: латиница в нижнем регистре, цифры, дефис между ними. Главная — index',
  ),
})
type PageRef = z.output<typeof PageRef>

// Содержимое страницы описывает та же схема, что проверяет её в API:
// нейронка видит те же правила, которыми потом проверят её работу
export const SaveDraftInput = PageRef.extend({
  title: PageTitle.describe('Заголовок страницы, его видно во вкладке'),
  content: PageContent,
})
type SaveDraftInput = z.output<typeof SaveDraftInput>

const rules = [
  'Страница — это { blocks: [...] }, не больше 50 блоков.',
  'У каждого блока уникальный id: латиница, цифры, _ и -. Он же якорь: кнопка с href "#contact" ведёт к блоку с id "contact".',
  'Главный заголовок страницы (h1) получает первый блок hero, поэтому начинай страницу с него.',
  'Ссылки только https://, http://, /, #, mailto: и tel:.',
  'Лишних полей быть не должно: используй только поля из схем блоков.',
  'Картинка — { mediaId, alt }: mediaId из медиатеки этого сайта (её пополняют в админке), alt обязателен — коротко, что на картинке. Чужой или выдуманный mediaId API не примет. hero в варианте split («С картинкой») без картинки не пройдёт, в других вариантах картинки быть не должно.',
  'Форма заявки (form): у каждого поля уникальный ключ name (латиница, цифры, _; website и consent заняты), тип из списка, у select — варианты options. policyUrl — ссылка на политику конфиденциальности, обязательна. Форма работает без JavaScript, заявки видны только в админке: через MCP их не прочитать (персональные данные).',
  'save_draft сохраняет черновик. На сайт он попадает только после publish_page.',
]

/** Каталог блоков для нейронки: те же Zod-схемы, что в API, но в виде JSON Schema */
export function blockCatalog() {
  return {
    rules,
    blocks: blocks.map((block) => ({
      type: block.type,
      title: block.title,
      description: block.description,
      props: z.toJSONSchema(block.props, { io: 'input' }),
      example: block.example,
    })),
  }
}

const createTokenHint =
  'Создай токен: pnpm token:create --name mcp (на сайт установки) и положи строку ' +
  'CMS_API_TOKEN=… из вывода в apps/mcp/.env. Потом перезапусти MCP-сервер'

export const missingTokenMessage = `Нужен токен API: без него MCP не пускают в Averra CMS. ${createTokenHint}`

async function unwrap(request: () => Promise<ClientResponse<unknown>>) {
  let res: ClientResponse<unknown>
  try {
    res = await request()
  } catch (cause) {
    throw new Error('API не отвечает. Запусти его: pnpm dev', { cause })
  }
  const body: unknown = await res.json()
  if (res.status === 401) {
    throw new Error(`API не принял токен: он отозван или неверный. ${createTokenHint}`)
  }
  if (!res.ok) throw new Error(describeApiError(res.status, body))
  return body
}

/**
 * Операции поверх API. MCP для API — обычный клиент, как админка, только входит токеном.
 * Без клиента (нет токена) каждая операция с API отвечает, как токен получить
 */
export function cmsTools(client: Api | undefined) {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(missingTokenMessage)
    }
    return { listSites: fail, getPage: fail, saveDraft: fail, publishPage: fail }
  }
  const sites = client.api.sites
  const page = sites[':siteId'].pages[':slug']
  // Сайт токена (GET /api/site) — один раз на сервер: токен выпущен на один сайт и не меняется
  let tokenSite: Promise<string> | undefined
  const siteOf = (siteId: string | undefined) => {
    if (siteId) return Promise.resolve(siteId)
    tokenSite ??= unwrap(() => client.api.site.$get()).then(
      (site) => z.object({ id: z.string() }).parse(site).id,
    )
    // Сбой (API не отвечает) не запоминается: следующий вызов спросит снова
    tokenSite.catch(() => {
      tokenSite = undefined
    })
    return tokenSite
  }
  return {
    listSites: () => unwrap(() => sites.$get()),
    getPage: async ({ siteId, slug }: PageRef) => {
      const param = { siteId: await siteOf(siteId), slug }
      return unwrap(() => page.$get({ param }))
    },
    saveDraft: async ({ siteId, slug, title, content }: SaveDraftInput) => {
      const param = { siteId: await siteOf(siteId), slug }
      return unwrap(() => page.$put({ param, json: { title, content } }))
    },
    publishPage: async ({ siteId, slug }: PageRef) => {
      const param = { siteId: await siteOf(siteId), slug }
      return unwrap(() => page.publish.$post({ param }))
    },
  }
}

const asText = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

export function registerTools(server: McpServer, api: Api | undefined) {
  const tools = cmsTools(api)

  server.registerTool(
    'list_blocks',
    {
      title: 'Каталог блоков',
      description:
        'Какие блоки можно ставить на страницу и какие у них поля. Вызови перед тем, как собирать страницу.',
      annotations: { readOnlyHint: true },
    },
    async () => asText(blockCatalog()),
  )

  server.registerTool(
    'list_sites',
    {
      title: 'Сайты',
      description:
        'Сайт, на который выпущен токен MCP: id и название. В установке сайт один, и остальным инструментам id не нужен.',
      annotations: { readOnlyHint: true },
    },
    async () => asText(await tools.listSites()),
  )

  server.registerTool(
    'get_page',
    {
      title: 'Страница',
      description: 'Черновик и опубликованная версия страницы.',
      inputSchema: PageRef,
      annotations: { readOnlyHint: true },
    },
    async (args) => asText(await tools.getPage(args)),
  )

  server.registerTool(
    'save_draft',
    {
      title: 'Сохранить черновик',
      description:
        'Сохраняет черновик страницы целиком: заголовок и все блоки. Опубликованная версия не меняется.',
      inputSchema: SaveDraftInput,
      annotations: { idempotentHint: true },
    },
    async (args) => {
      await tools.saveDraft(args)
      return asText({
        result: `Черновик сохранён: ${args.content.blocks.length} блоков`,
        next: 'Чтобы изменения попали на сайт, вызови publish_page',
      })
    },
  )

  server.registerTool(
    'publish_page',
    {
      title: 'Опубликовать страницу',
      description: 'Публикует черновик: он заменит то, что сейчас на сайте.',
      inputSchema: PageRef,
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      await tools.publishPage(args)
      return asText({
        result: 'Опубликовано',
        next: 'При запущенном pnpm dev правки видны на http://localhost:4321 после обновления страницы; статику пересобирает pnpm build',
      })
    },
  )
}
