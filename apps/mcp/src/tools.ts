import type { AppType } from '@cms/api'
import { blocks, PageContent } from '@cms/schema'
import type { McpServer } from '@modelcontextprotocol/server'
import type { ClientResponse, hc } from 'hono/client'
import { z } from 'zod'

export type Api = ReturnType<typeof hc<AppType>>

const PageRef = z.object({
  siteId: z.uuid().describe('Id сайта из list_sites'),
  slug: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .default('index')
    .describe('Адрес страницы: латиница, цифры и дефис. Главная страница — index'),
})
type PageRef = z.output<typeof PageRef>

// Содержимое страницы описывает та же схема, что проверяет её в API:
// нейронка видит те же правила, которыми потом проверят её работу
export const SaveDraftInput = PageRef.extend({
  title: z.string().trim().min(1).max(120).describe('Заголовок страницы, его видно во вкладке'),
  content: PageContent,
})
type SaveDraftInput = z.output<typeof SaveDraftInput>

const rules = [
  'Страница — это { blocks: [...] }, не больше 50 блоков.',
  'У каждого блока уникальный id: латиница, цифры, _ и -. Он же якорь: кнопка с href "#contact" ведёт к блоку с id "contact".',
  'Главный заголовок страницы (h1) получает первый блок hero, поэтому начинай страницу с него.',
  'Ссылки только https://, http://, /, #, mailto: и tel:.',
  'Лишних полей быть не должно: используй только поля из схем блоков.',
  'save_draft сохраняет черновик. На сайт он попадает только после publish_page.',
]

/** Каталог блоков для нейронки: те же Zod-схемы, что в API, но в виде JSON Schema */
export function blockCatalog() {
  return {
    rules,
    blocks: blocks.map((block) => ({
      type: block.type,
      title: block.title,
      props: z.toJSONSchema(block.props, { io: 'input' }),
    })),
  }
}

const ApiError = z.object({
  error: z.object({
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
})

/** Ошибка API в виде, понятном нейронке: что не так и в каком поле */
export function formatApiError(status: number, body: unknown) {
  const parsed = ApiError.safeParse(body)
  if (!parsed.success) return `API ответил ${status}`
  const { message, issues = [] } = parsed.data.error
  const lines = issues.map((issue) => `- ${issue.path}: ${issue.message}`)
  return [`API ответил ${status}: ${message}`, ...lines].join('\n')
}

async function unwrap(request: Promise<ClientResponse<unknown>>) {
  let res: ClientResponse<unknown>
  try {
    res = await request
  } catch (cause) {
    throw new Error('API не отвечает. Запусти его: pnpm dev', { cause })
  }
  const body: unknown = await res.json()
  if (!res.ok) throw new Error(formatApiError(res.status, body))
  return body
}

/** Операции поверх API. MCP для API — обычный клиент, как админка */
export function cmsTools(api: Api) {
  const sites = api.api.sites
  const page = sites[':siteId'].pages[':slug']
  return {
    listSites: () => unwrap(sites.$get()),
    getPage: ({ siteId, slug }: PageRef) => unwrap(page.$get({ param: { siteId, slug } })),
    saveDraft: ({ siteId, slug, title, content }: SaveDraftInput) =>
      unwrap(page.$put({ param: { siteId, slug }, json: { title, content } })),
    publishPage: ({ siteId, slug }: PageRef) =>
      unwrap(page.publish.$post({ param: { siteId, slug } })),
  }
}

const asText = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

export function registerTools(server: McpServer, api: Api) {
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
      description: 'Список сайтов: id и название.',
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
