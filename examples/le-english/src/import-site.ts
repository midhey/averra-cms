import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
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
   * Заменить черновики /privacy и /consent свежим шаблоном целиком, даже если их правили (правки
   * в черновике пропадут). Опубликованная версия остаётся до публикации человеком. Без флага
   * заменяется только блок с фразой шаблона «нет форм заявок», остальной текст не трогается
   */
  rebuildDocuments?: boolean
  /**
   * Папка, куда перед заменой черновика документа кладётся его прежний текст (файл на документ и
   * запуск). Черновики не попадают в историю версий: без файла правки юриста, затёртые шаблоном
   * при обрыве связи, не вернуть. По умолчанию — `~/.averra/le-english-backup`: вне репозитория,
   * куда скрипт обычно запускают из его папки, чтобы тексты юриста не попали в коммит
   */
  backupDir?: string
  log?: (line: string) => void
}

export type ImportResult = {
  siteId: string
  blocks: string[]
  /** Предупреждения публикации блоков (конкретные цвета и т. п.) — не ошибки */
  warnings: string[]
  pages: string[]
  legalDrafts: string[]
  /** Документы, чей черновик заменён свежим шаблоном целиком (флаг --rebuild-documents) */
  rebuiltDocuments: string[]
  /** Документы, у которых заменён только блок с ложной фразой, остальные правки на месте */
  repairedDocuments: string[]
  /** Опубликованные документы, которые говорят «нет форм заявок»: правит и публикует человек */
  staleDocuments: string[]
  published: boolean
  /** Документы, которые надо опубликовать в админке, прежде чем публиковать сайт с формой */
  missingDocuments: string[]
}

type Json = Record<string, unknown>

type PageRecord = { title: string; draft: unknown; published: unknown }

/**
 * Документ явно врёт про форму: в нём есть фраза шаблона «на нём нет форм заявок» (политика
 * создана до страницы /zapis). Признак — именно эта фраза, а не отсутствие слов про форму:
 * юрист вправе переписать раздел как угодно, и его текст не считается ложью. Если про форму в
 * тексте просто ничего не нашлось, скрипт только предупреждает
 */
const NO_FORMS_PHRASE = 'нет форм заявок'
const claimsNoForms = (document: string, value: unknown) =>
  document === 'privacy' && JSON.stringify(value ?? null).includes(NO_FORMS_PHRASE)
/**
 * Слово «форма» целиком, а не «информация», «оформление» и «платформа»: границы слова — не
 * кириллическая буква (в JSON перенос строки — `\n`, латинская n, слову не мешает)
 */
const FORM_WORD = /(^|[^а-яё])форм(а|е|у|ой|ы|ам|ами|ах)?([^а-яё]|$)/i
const mentionsForm = (value: unknown) => FORM_WORD.test(JSON.stringify(value ?? null))

/**
 * Прежний черновик документа — в файл, до замены шаблоном. Файл в том виде, как его принимает
 * `PUT /pages/<документ>` (`title` и `content`): вернуть можно тем же запросом. Не получилось
 * записать — ошибка до первого изменения, а не замена без страховки
 */
function backupDraft(dir: string, document: string, page: PageRecord) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  // Файл не перезаписывается: два запуска в одну миллисекунду получат разные имена
  let file = join(dir, `${document}-draft-${stamp}.json`)
  for (let n = 2; existsSync(file); n++) file = join(dir, `${document}-draft-${stamp}-${n}.json`)
  try {
    mkdirSync(dir, { recursive: true })
    const body = JSON.stringify({ title: page.title, content: page.draft }, null, 2)
    writeFileSync(file, `${body}\n`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Не удалось сохранить прежний черновик /${document} в ${file}: ${reason}. Ничего не заменено`,
    )
  }
  return file
}

/**
 * Папка страховочных файлов по умолчанию. Не в текущей папке: скрипт запускают из
 * examples/le-english, и тексты юриста лежали бы в рабочем дереве репозитория рядом с кодом.
 * Имя не `averra-backup`: так называются бэкапы самой установки на сервере
 */
export const defaultBackupDir = () => join(homedir(), '.averra', 'le-english-backup')

type DocBlock = { id?: unknown }
type DocContent = { blocks?: DocBlock[] } & Json

/** Id блока шаблона, где политика перечисляет данные («Какие данные мы обрабатываем») */
const DATA_BLOCK_ID = 'data'

/**
 * Черновик человека, в котором блок с ложной фразой заменён свежим блоком данных из шаблона.
 * Остальные блоки остаются как есть. Нет ложного блока или в шаблоне нет блока данных —
 * undefined: ничего не меняем. Если в черновике уже есть свой блок данных без ложной фразы
 * (юрист продублировал блок), второй с тем же id API отверг бы («Id блоков на странице должны
 * быть уникальными»), и каждый запуск падал бы заново: ложные блоки тогда убираются, а не
 * заменяются
 */
function repairStaleBlocks(
  draft: DocContent,
  fresh: DocContent,
): { content: DocContent; removedOnly: boolean } | undefined {
  const replacement = fresh.blocks?.find((block) => block.id === DATA_BLOCK_ID)
  const blocks = draft.blocks
  if (!replacement || !blocks) return undefined
  const stale = (block: DocBlock) => JSON.stringify(block).includes(NO_FORMS_PHRASE)
  if (!blocks.some(stale)) return undefined
  const hasOwnData = blocks.some((block) => block.id === DATA_BLOCK_ID && !stale(block))
  let put = hasOwnData
  const next: DocBlock[] = []
  for (const block of blocks) {
    if (!stale(block)) next.push(block)
    else if (!put) {
      next.push(replacement)
      put = true
    }
  }
  return { content: { ...draft, blocks: next }, removedOnly: hasOwnData }
}

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
  const repairedDocuments: string[] = []
  // Опубликованные ложные документы, чей черновик исправлен в этом же запуске
  const fixedDrafts = new Set<string>()
  const staleDocuments: string[] = []
  const backupDir = options.backupDir ?? defaultBackupDir()
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
    // Что в черновике сейчас: после замены — новое, предупреждение про слова о форме смотрит на него
    let draftNow: unknown = page.draft
    // Целиком черновик заменяет только флаг владельца. Без флага, когда черновик прямо говорит
    // «форм нет» (создан до страницы /zapis), заменяется один блок с этой фразой, а все остальные
    // правки человека остаются: черновики не попадают в историю версий, затёртое не вернуть
    let draftReplaced = false
    if (options.rebuildDocuments) {
      log(
        `Документ /${document}: прежний черновик сохранён в ${backupDraft(backupDir, document, page)}`,
      )
      const fresh = await client.post<PageRecord>(`${base}/settings/legal-pages`, {
        document,
        replaceDraft: true,
      })
      draftNow = fresh.draft
      rebuiltDocuments.push(document)
      draftReplaced = true
      log(
        published
          ? `Документ /${document}: черновик заменён свежим шаблоном, опубликованная версия остаётся — проверьте и опубликуйте`
          : `Документ /${document}: черновик пересобран из шаблона`,
      )
    } else if (draftStale) {
      // Свежий шаблон приходит только в ответе на замену черновика: заменяем, берём из ответа блок
      // данных, а прежний текст человека кладём обратно с этим одним блоком вместо ложного.
      // Между заменой и возвратом текст человека есть только у скрипта: пропадёт связь или
      // перезапустится API — шаблон остался бы поверх правок, поэтому сначала файл
      log(
        `Документ /${document}: прежний черновик сохранён в ${backupDraft(backupDir, document, page)}`,
      )
      const fresh = await client.post<PageRecord & { title: string }>(
        `${base}/settings/legal-pages`,
        { document, replaceDraft: true },
      )
      const repaired = repairStaleBlocks(page.draft as DocContent, fresh.draft as DocContent)
      try {
        await client.put(`${base}/pages/${document}`, {
          title: page.title,
          content: repaired?.content ?? page.draft,
        })
      } catch (error) {
        // Не вышло вернуть текст — положить его назад как был, а не оставить шаблон поверх правок
        await client.put(`${base}/pages/${document}`, { title: page.title, content: page.draft })
        throw error
      }
      if (repaired) {
        draftNow = repaired.content
        repairedDocuments.push(document)
        draftReplaced = true
        log(
          repaired.removedOnly
            ? `Документ /${document}: блок «нет форм заявок» убран (свой блок данных в черновике уже есть), остальной текст на месте. Проверьте и опубликуйте документ`
            : `Документ /${document}: блок «нет форм заявок» заменён свежим из шаблона, остальной текст на месте. Проверьте и опубликуйте документ`,
        )
      } else {
        log(`Документ /${document}: в шаблоне нет блока данных, черновик оставлен как был`)
      }
    } else {
      log(`Документ /${document}: ${published ? 'опубликован, ' : 'черновик есть, '}не трогаю`)
    }
    if (liveStale) {
      staleDocuments.push(document)
      if (draftReplaced) fixedDrafts.add(document)
    } else if (document === 'privacy' && !mentionsForm(published ? page.published : draftNow)) {
      log(
        `Предупреждение: в /${document} не нашлось слов про форму заявки. Проверьте, что текст описывает форму записи`,
      )
    }
  }
  for (const document of staleDocuments) {
    log(
      fixedDrafts.has(document)
        ? `ВНИМАНИЕ: опубликованный /${document} говорит, что на сайте нет форм заявок. Черновик уже исправлен в этом запуске: проверьте его в «Страницах» и опубликуйте`
        : `ВНИМАНИЕ: опубликованный /${document} говорит, что на сайте нет форм заявок. Откройте его в «Страницах», исправьте раздел про заявки и опубликуйте (или запустите скрипт с --rebuild-documents: черновик заменится свежим шаблоном)`,
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
    repairedDocuments,
    staleDocuments,
    published: publish,
    missingDocuments,
  }
}

export { ApiFailure }
