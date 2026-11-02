import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ApiFailure, type Client } from './api-client.ts'
import {
  homeBlocks,
  legalOf,
  menuItems,
  type Photo,
  photosOf,
  seoOf,
  signupFormProps,
  telegramOf,
} from './content.ts'
import { footer, headerBase, redirects, theme } from './site-parts.ts'

// Перенос Vallex English на Averra через API — так же, как это делает владелец в админке, а не в
// обход неё: все проверки (схемы, контраст темы, ссылки меню) работают те же. Скрипт можно
// запускать повторно: блоки заменяются, страницы и настройки перезаписываются черновиками.

export type ImportOptions = {
  client: Client
  /** Контент исходного сайта: content.default.json или data/content.json живого сайта */
  contentFile: string
  /** public/ исходного сайта: из неё берутся фото (assets/images/…, uploads/…) */
  publicDir: string
  /** Файл выгрузки своих блоков (le-english.blocks.json) */
  blocksFile: string
  /** Логотип для шапки (SVG или картинка); нет файла — в шапке название сайта */
  logoFile?: string
  /** Адрес сайта (https://домен): для canonical и карты сайта; не задан — остаётся как есть */
  siteUrl?: string
  /**
   * Опубликовать страницы, тему, шапку и подвал. Без флага — только черновики. Форма записи
   * собирает персональные данные, поэтому сайт публикуется, только когда политика и согласие уже
   * опубликованы человеком: иначе ссылки формы вели бы на 404
   */
  publish: boolean
  /**
   * Заменить черновики /privacy и /consent свежим шаблоном, даже если их правили (правки в
   * черновике пропадут). Опубликованная версия остаётся до публикации человеком. Без флага
   * черновик пересобирается, только если политика не описывает форму заявки
   */
  rebuildDocuments?: boolean
  log?: (line: string) => void
}

export type ImportResult = {
  siteId: string
  blocks: string[]
  /** Предупреждения публикации блоков (конкретные цвета и т. п.) — не ошибки */
  warnings: string[]
  pages: string[]
  legalDrafts: string[]
  /** Документы, чей черновик заменён свежим шаблоном */
  rebuiltDocuments: string[]
  /** Опубликованные документы, которые говорят «нет форм заявок»: правит и публикует человек */
  staleDocuments: string[]
  published: boolean
  /** Документы, которые надо опубликовать в админке, прежде чем публиковать сайт с формой */
  missingDocuments: string[]
}

type Json = Record<string, unknown>

type PageRecord = { draft: unknown; published: unknown }

/**
 * Документ явно врёт про форму: в нём есть фраза шаблона «на нём нет форм заявок» (политика
 * создана до страницы /zapis). Признак — именно эта фраза, а не отсутствие слов про форму:
 * юрист вправе переписать раздел как угодно, и его текст не считается ложью. Если про форму в
 * тексте просто ничего не нашлось, скрипт только предупреждает
 */
const NO_FORMS_PHRASE = 'нет форм заявок'
const claimsNoForms = (document: string, value: unknown) =>
  document === 'privacy' && JSON.stringify(value ?? null).includes(NO_FORMS_PHRASE)
const mentionsForm = (value: unknown) => /форм/i.test(JSON.stringify(value ?? null))

const MIME: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  avif: 'image/avif',
}

const SITE_NAME = 'Vallex English'
const DOCUMENTS = ['privacy', 'consent'] as const
// Как SiteUrl в настройках: только https и только адрес сайта, без пути
const SITE_URL = /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i

export async function importSite(options: ImportOptions): Promise<ImportResult> {
  const { client } = options
  const log = options.log ?? (() => {})
  // Проверки — до первых изменений: упасть на середине значило бы оставить сайт наполовину
  if (options.siteUrl !== undefined && !SITE_URL.test(options.siteUrl)) {
    throw new Error(`--site-url: нужен адрес вида https://домен, а не «${options.siteUrl}»`)
  }
  // Живой сайт хранит опубликованное как { version, savedAt, note, content }, content.default.json —
  // сам контент: берём оба вида
  const stored = JSON.parse(readFileSync(options.contentFile, 'utf8')) as Json
  const content = (
    typeof stored.content === 'object' && stored.content !== null ? stored.content : stored
  ) as Json
  const legal = legalOf(content)
  const seo = seoOf(content)

  const site = await client.get<{ id: string }>('/api/site')
  const base = `/api/sites/${site.id}`
  log(`Сайт установки: ${site.id}`)

  // ── Фото в медиатеку ────────────────────────────────────────────────────────────────────────
  const library = await client.get<{ items: { id: string; originalName: string }[] }>(
    `${base}/media`,
  )
  const known = new Map(library.items.map((item) => [item.originalName, item.id]))
  const uploaded = new Map<string, string>()
  // Файл с тем же именем уже в медиатеке — берём его: повторный запуск не плодит копии
  const uploadFile = async (path: string) => {
    const name = basename(path)
    const existing = known.get(name)
    if (existing) return existing
    if (!existsSync(path)) throw new Error(`Нет файла ${path}`)
    const type = MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
    const form = new FormData()
    form.set('file', new File([new Uint8Array(readFileSync(path))], name, { type }))
    const created = await client.upload<{ id: string }>(`${base}/media`, form)
    known.set(name, created.id)
    log(`Картинка: ${name}`)
    return created.id
  }
  const upload = async (relative: string) => {
    const cached = uploaded.get(relative)
    if (cached) return cached
    const id = await uploadFile(join(options.publicDir, relative))
    uploaded.set(relative, id)
    return id
  }
  const photos = photosOf(content)
  for (const photo of photos) await upload(photo.src)
  const bySrc = new Map<string, Photo>(photos.map((photo) => [photo.src, photo]))
  const mediaOf = (photo: unknown) => {
    const src = (photo as { src?: unknown } | null)?.src
    if (typeof src !== 'string') return undefined
    const mediaId = uploaded.get(src)
    return mediaId ? { mediaId, alt: bySrc.get(src)?.alt || SITE_NAME } : undefined
  }
  const shareImage = 'assets/images/social-card.jpg'
  const shareImageId = existsSync(join(options.publicDir, shareImage))
    ? await upload(shareImage)
    : undefined

  // Иконка сайта, как у оригинала: apple-touch-icon.png (на нём знак «Ve»), иначе favicon.svg.
  // Сервер сам собирает из неё favicon.ico и иконки для телефонов
  const iconSource = ['assets/images/apple-touch-icon.png', 'assets/images/favicon.svg'].find(
    (path) => existsSync(join(options.publicDir, path)),
  )
  const iconId = iconSource ? await upload(iconSource) : undefined

  // ── Свои блоки: загрузка и публикация ───────────────────────────────────────────────────────
  const file = JSON.parse(readFileSync(options.blocksFile, 'utf8')) as {
    blocks: { key: string }[]
  }
  const present = await client.get<{ blocks: { key: string }[] }>(`${base}/custom-blocks`)
  const taken = new Set(present.blocks.map((block) => block.key))
  const resolutions = Object.fromEntries(
    file.blocks.filter((block) => taken.has(block.key)).map((block) => [block.key, 'replace']),
  )
  await client.post(`${base}/custom-blocks/import`, { blocks: file.blocks, resolutions })
  const warnings: string[] = []
  for (const block of file.blocks) {
    // Публикуем ровно то, что загрузили: если черновик успели поменять (MCP), API ответит 409
    await client.post(`${base}/custom-blocks/${block.key}/publish`, { draft: block })
    const detail = await client.get<{
      problems: { level: string; part: string; message: string; line?: number }[]
    }>(`${base}/custom-blocks/${block.key}`)
    for (const problem of detail.problems.filter((one) => one.level === 'warning')) {
      warnings.push(`${block.key}: ${problem.message}`)
    }
    log(`Блок ${block.key}: опубликован`)
  }

  // ── Тема ────────────────────────────────────────────────────────────────────────────────────
  await client.put(`${base}/theme`, theme)
  log('Тема: черновик сохранён')

  // ── Настройки сайта: название, организация, адреса документов ────────────────────────────────
  const current = await client.get<{
    settings: { redirects: { from: string; to: string }[]; organization: Json; cookies: Json }
  }>(`${base}/settings`)
  const keptRedirects = current.settings.redirects.filter(
    (one) => !redirects.some((redirect) => redirect.from === one.from),
  )
  // Группы настроек заменяются целиком: дополняем то, что уже есть (адрес и телефон, вписанные
  // владельцем после первого запуска, вид уведомления о cookies), а не затираем
  const organization = {
    type: 'Organization',
    ...current.settings.organization,
    name: legal.operator || SITE_NAME,
    email: legal.email,
    inn: legal.inn,
    socials: telegramOf(content) ? [telegramOf(content)] : [],
  }
  await client.patch(`${base}/settings`, {
    name: SITE_NAME,
    language: 'ru',
    description: seo.description,
    ...(shareImageId && { ogImage: shareImageId }),
    ...(iconId && { icon: iconId }),
    ...(options.siteUrl && { url: options.siteUrl }),
    organization,
    redirects: [...keptRedirects, ...redirects],
  })
  log('Настройки: название, описание, организация, редиректы со старых адресов документов')

  // ── Страницы ────────────────────────────────────────────────────────────────────────────────
  await client.put(`${base}/pages/index`, {
    title: 'Vallex English',
    content: {
      blocks: homeBlocks(content, mediaOf),
      seo: {
        title: seo.title,
        description: seo.description,
        ...(shareImageId && { image: { mediaId: shareImageId } }),
      },
    },
  })
  log('Страница index: черновик сохранён')
  await client.put(`${base}/pages/zapis`, {
    title: 'Запись на пробный урок',
    content: {
      blocks: [{ id: 'zapis-form', type: 'form', props: signupFormProps(content) }],
      // Как у /zapis/ исходного сайта: страница для ссылок из биографий и сообщений
      seo: { noindex: true },
    },
  })
  log('Страница zapis: черновик сохранён')

  // ── Политика и согласие: черновики из шаблона Averra ────────────────────────────────────────
  // Только после страниц: шаблон собирается по фактам сайта в момент создания (есть ли форма,
  // какие сервисы), и политика, созданная до страницы /zapis, говорила бы «на сайте нет форм»
  const legalDrafts: string[] = []
  const rebuiltDocuments: string[] = []
  const staleDocuments: string[] = []
  const existing = await client.get<{ slug: string; publishedAt: string | null }[]>(`${base}/pages`)
  for (const document of DOCUMENTS) {
    const found = existing.find((page) => page.slug === document)
    if (!found) {
      await client.post(`${base}/settings/legal-pages`, { document })
      legalDrafts.push(document)
      log(`Документ /${document}: черновик создан`)
      continue
    }
    legalDrafts.push(document)
    const page = await client.get<PageRecord>(`${base}/pages/${document}`)
    const published = found.publishedAt !== null
    const draftStale = claimsNoForms(document, page.draft)
    // Что видят посетители: у опубликованного документа — опубликованный текст
    const liveStale = published && claimsNoForms(document, page.published)
    // Черновик пересобираем, только если он прямо говорит «форм нет» (создан до страницы /zapis)
    // или владелец попросил флагом. Любую другую правку, в том числе переписанный раздел про
    // форму, не трогаем: черновики не попадают в историю версий, затёртое не вернуть
    if (draftStale || options.rebuildDocuments) {
      await client.post(`${base}/settings/legal-pages`, { document, replaceDraft: true })
      rebuiltDocuments.push(document)
      log(
        published
          ? `Документ /${document}: черновик заменён свежим шаблоном, опубликованная версия остаётся — проверьте и опубликуйте`
          : `Документ /${document}: черновик пересобран из шаблона`,
      )
    } else {
      log(
        published
          ? `Документ /${document}: опубликован, не трогаю`
          : `Документ /${document}: правили вручную, не трогаю (пересобрать — флаг --rebuild-documents)`,
      )
    }
    if (liveStale) staleDocuments.push(document)
    else if (document === 'privacy' && !mentionsForm(published ? page.published : page.draft)) {
      log(
        `Предупреждение: в /${document} не нашлось слов про форму заявки. Проверьте, что текст описывает форму записи`,
      )
    }
  }
  for (const document of staleDocuments) {
    log(
      `ВНИМАНИЕ: опубликованный /${document} говорит, что на сайте нет форм заявок. Откройте его в «Страницах», исправьте раздел про заявки и опубликуйте (или запустите скрипт с --rebuild-documents: черновик заменится свежим шаблоном)`,
    )
  }
  await client.patch(`${base}/settings`, {
    cookies: { ...current.settings.cookies, policyPage: 'privacy' },
  })

  // ── Шапка и подвал ──────────────────────────────────────────────────────────────────────────
  const logo =
    options.logoFile && existsSync(options.logoFile) ? await uploadFile(options.logoFile) : null
  await client.put(`${base}/header`, {
    ...headerBase,
    logo,
    menu: menuItems(content),
  })
  await client.put(`${base}/footer`, footer)
  log('Шапка и подвал: черновики сохранены')

  // ── Публикация ──────────────────────────────────────────────────────────────────────────────
  const listed = await client.get<{ slug: string; publishedAt: string | null }[]>(`${base}/pages`)
  const missingDocuments = DOCUMENTS.filter(
    (slug) => !listed.some((page) => page.slug === slug && page.publishedAt !== null),
  ).map((slug) => `/${slug}`)
  const publish = options.publish && missingDocuments.length === 0 && staleDocuments.length === 0
  if (options.publish && missingDocuments.length > 0) {
    log(
      `Сайт не опубликован: форма записи собирает персональные данные, а ${missingDocuments.join(' и ')} — черновики. Проверьте их в админке, опубликуйте и запустите скрипт с --publish ещё раз`,
    )
  } else if (options.publish && staleDocuments.length > 0) {
    log(
      'Сайт не опубликован: политика всё ещё говорит, что форм на сайте нет («нет форм заявок»). Поправьте её (см. предупреждение выше) и запустите скрипт с --publish ещё раз',
    )
  }
  if (publish) {
    await client.post(`${base}/pages/index/publish`)
    await client.post(`${base}/pages/zapis/publish`)
    await client.post(`${base}/theme/publish`)
    await client.post(`${base}/header/publish`)
    await client.post(`${base}/footer/publish`)
    log('Опубликованы: страницы, тема, шапка, подвал')
  }

  return {
    siteId: site.id,
    blocks: file.blocks.map((block) => block.key),
    warnings,
    pages: ['index', 'zapis'],
    legalDrafts,
    rebuiltDocuments,
    staleDocuments,
    published: publish,
    missingDocuments,
  }
}

export { ApiFailure }
