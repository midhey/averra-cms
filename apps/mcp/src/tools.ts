import type { AppType } from '@averra/api'
import {
  BLOCK_CATEGORIES,
  blocks,
  describeApiError,
  PageContent,
  PageSlug,
  PageTitle,
  pageSeoChecks,
  readTheme,
  SEO_DESCRIPTION_RANGE,
  SEO_TITLE_RANGE,
  type SiteSeo,
  SLUG_RECOMMENDED_MAX,
  seoAdvice,
  themeFontTitles,
  Uuid,
} from '@averra/schema'
import type { McpServer } from '@modelcontextprotocol/server'
import type { ClientResponse, hc } from 'hono/client'
import { z } from 'zod'

export type Api = ReturnType<typeof hc<AppType>>

/** Сайт из GET /api/sites/:siteId — только SEO, нужное советам по странице */
const SiteWithSeo = z.object({
  seo: z.object({
    titleTemplate: z.string(),
    description: z.string(),
    ogImage: z.string().nullable(),
    url: z.string().nullable(),
    hideFromSearch: z.boolean(),
  }),
})

/**
 * Черновик из ответа API — ровно то, что нужно советам. Блоки — как есть (проверки читают их и
 * недописанными), SEO — без строгих правил: незнакомое поле или значение не ломает разбор
 */
const SavedDraft = z.object({
  title: z.string(),
  draft: z.object({
    blocks: z.array(z.looseObject({ id: z.string(), type: z.string(), props: z.unknown() })),
    seo: z
      .looseObject({
        title: z.string().optional().catch(undefined),
        description: z.string().optional().catch(undefined),
        image: z.looseObject({ mediaId: z.string() }).optional().catch(undefined),
        canonical: z.string().optional().catch(undefined),
        noindex: z.boolean().optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
  }),
})

/**
 * Тема из GET /api/sites/:siteId/theme: черновик не нужен — нейронке важно то, что на сайте. Тему
 * читает readTheme: установка новее MCP могла добавить поле или шрифт, и это не повод для ошибки
 */
const SiteThemeView = z.object({
  published: z.unknown().transform((theme) => readTheme(theme)),
  unpublished: z.boolean().catch(false),
})

const SiteRef = z.object({
  siteId: Uuid()
    .optional()
    .describe('Id сайта. Не нужен: по умолчанию — сайт, на который выпущен токен'),
})
type SiteRef = z.output<typeof SiteRef>

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
  'Картинка — { mediaId, alt }: mediaId из медиатеки этого сайта (её пополняют в админке), alt обязателен — коротко, что на картинке. Чужой или выдуманный mediaId API не примет. hero в варианте split («С картинкой») без картинки не пройдёт, в других вариантах картинки быть не должно. SVG из медиатеки (mimeType image/svg+xml) — только для логотипа и иконки сайта: в блоки и seo.image его ставить нельзя.',
  'Видео (video) — ссылка url на ролик YouTube, Rutube или VK Видео (из адресной строки или «Поделиться»; другие адреса не пройдут), title обязателен, caption и cover — необязательны. cover — своя обложка { mediaId, alt }, лучше 16:9: без неё на странице заглушка в цветах сайта, обложку площадки страница не грузит. Плеер включается по клику, без JavaScript — ссылка на ролик.',
  'Форма заявки (form): у каждого поля уникальный ключ name (латиница, цифры, _; website и consent заняты), тип из списка, у select — варианты options. policyUrl — ссылка на политику конфиденциальности, обязательна; consentUrl — ссылка на текст согласия на обработку персональных данных (/consent), необязательна, но с 2025 года согласие — отдельный документ. Форма работает без JavaScript, заявки видны только в админке: через MCP их не прочитать (персональные данные).',
  'Текст (text) — заголовок и текст с лёгкой разметкой: пустая строка — новый абзац, строка с «- » — пункт списка, с «## » — подзаголовок. HTML не работает, он покажется как текст.',
  'category у блока — раздел каталога: «Начало страницы» ставь первым, «Связь» (форма) — ближе к концу. Обычный порядок лендинга: hero, text-image или features, stats, steps, pricing, faq, cta или form.',
  'Не выдумывай факты: числа, цены, сроки, гарантии и отзывы бери из брифа. Если их нет — оставь заглушку в квадратных скобках, как в example («[12]», «от [цена] ₽/м²»), чтобы человек заменил её.',
  'text-image — текст с той же разметкой, что у text, и необязательная картинка слева или справа (imagePosition). stats — 2–4 факта { value, label }, value короткий: «12», «3 года». steps — 3–6 шагов. pricing — 2–4 тарифа, featured: true — не больше чем у одного. faq — 1–20 вопросов { question, answer }; вопросы страницы уходят и в разметку FAQPage для поисковиков.',
  `SEO страницы — необязательное поле seo рядом с blocks: { title, description, image, canonical, noindex }, все поля необязательны. Без title заголовок во вкладке и в поиске собирается по шаблону сайта из заголовка страницы; title пишется целиком, шаблон к нему не добавляется — лучше ${SEO_TITLE_RANGE.min}–${SEO_TITLE_RANGE.max} символов. description — 1–2 предложения о том, что на странице, ${SEO_DESCRIPTION_RANGE.min}–${SEO_DESCRIPTION_RANGE.max} символов (без него берётся описание сайта).`,
  'seo.image — { mediaId } картинки для соцсетей из медиатеки, лучше 1200 × 630; без неё — картинка сайта, а если нет и её — карточка из заголовка страницы. seo.canonical — путь на этом сайте (/ceny/) или https://…, только если страница копирует другую; иначе не задавай. noindex: true скрывает страницу от поисковиков — только для служебных страниц («Спасибо», политика).',
  `Адрес новой страницы — короткий, 2–4 слова, не длиннее ${SLUG_RECOMMENDED_MAX} символов. У картинок в блоках alt описывает, что на картинке, а не имя файла.`,
  'get_page и save_draft возвращают seoChecks — советы по SEO черновика (warning — стоит поправить, problem — важно). Публиковать они не мешают, но поправь их, если можешь.',
  'Страница с адресом 404 — служебная: её показывают на адресах, где страницы нет. Делай её из блоков, как обычную, с кнопкой на главную.',
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
      category: BLOCK_CATEGORIES[block.category],
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
    return { listSites: fail, getPage: fail, saveDraft: fail, publishPage: fail, getTheme: fail }
  }
  const sites = client.api.sites
  const page = sites[':siteId'].pages[':slug']
  // SEO сайта (шаблон заголовка, описание и картинка по умолчанию, адрес) — для советов по
  // странице: GET /api/sites/:siteId отдаёт их и токену. Установка старше 3.13 seo не отдаёт —
  // тогда undefined
  const siteSeoOf = async (siteId: string): Promise<SiteSeo | undefined> => {
    const site = SiteWithSeo.safeParse(
      await unwrap(() => sites[':siteId'].$get({ param: { siteId } })),
    )
    return site.success ? site.data.seo : undefined
  }
  /**
   * Советы SEO по черновику — те же проверки, что в панели «SEO» редактора. Советы — добавка:
   * MCP студии ходит и в установки клиентов старее себя, и черновик к этому моменту уже сохранён.
   * Любой сбой (старый API без site.seo, незнакомый черновик после отката, API не ответил на
   * второй запрос) — не повод уронить get_page или ответить ошибкой на сохранённое: тогда
   * страница уходит без советов
   */
  const seoChecksOf = async (siteId: string, slug: string, saved: unknown) => {
    try {
      const parsed = SavedDraft.safeParse(saved)
      if (!parsed.success) return undefined
      const siteSeo = await siteSeoOf(siteId)
      if (!siteSeo) return undefined
      const { title, draft } = parsed.data
      const checks = pageSeoChecks({ slug, title, blocks: draft.blocks, seo: draft.seo }, siteSeo)
      return seoAdvice(checks).map(({ level, title, advice }) => ({ level, title, advice }))
    } catch {
      return undefined
    }
  }
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
      const found = await unwrap(() => page.$get({ param }))
      return { ...(found as object), seoChecks: await seoChecksOf(param.siteId, slug, found) }
    },
    saveDraft: async ({ siteId, slug, title, content }: SaveDraftInput) => {
      const param = { siteId: await siteOf(siteId), slug }
      const saved = await unwrap(() => page.$put({ param, json: { title, content } }))
      return { seoChecks: await seoChecksOf(param.siteId, slug, saved) }
    },
    /**
     * Тема на сайте: цвета, шрифты (с названиями) и скругления — чтобы подбирать тексты и картинки
     * под стиль. Только чтение: тему меняют в админке, токену API запись запрещена
     */
    getTheme: async ({ siteId }: SiteRef) => {
      const param = { siteId: await siteOf(siteId) }
      const view = SiteThemeView.parse(await unwrap(() => sites[':siteId'].theme.$get({ param })))
      const { heading, body } = view.published.fonts
      return {
        theme: view.published,
        fonts: { heading: themeFontTitles[heading], body: themeFontTitles[body] },
        unpublishedDraft: view.unpublished,
      }
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
      description:
        'Черновик и опубликованная версия страницы: SEO — в draft.seo и published.seo; советы по SEO черновика — в seoChecks.',
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
        'Сохраняет черновик страницы целиком: заголовок, все блоки и SEO (content.seo; в ответе get_page оно в draft.seo). Опубликованная версия не меняется. Возвращает советы по SEO (seoChecks).',
      inputSchema: SaveDraftInput,
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const { seoChecks } = await tools.saveDraft(args)
      return asText({
        result: `Черновик сохранён: ${args.content.blocks.length} блоков`,
        seoChecks,
        next: 'Чтобы изменения попали на сайт, вызови publish_page',
      })
    },
  )

  server.registerTool(
    'get_theme',
    {
      title: 'Тема сайта',
      description:
        'Цвета, шрифты и скругления сайта, как они на сайте сейчас: чтобы подбирать тексты, картинки и обложки под стиль. Менять тему через MCP нельзя — это делают в админке, на экране «Тема».',
      inputSchema: SiteRef,
      annotations: { readOnlyHint: true },
    },
    async (args) => asText(await tools.getTheme(args)),
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
