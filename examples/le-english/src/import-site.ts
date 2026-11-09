import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { ApiFailure, type Client } from './api-client.ts'
import {
  footerSign,
  headerBrand,
  homeBlocks,
  legalOf,
  menuItems,
  notFoundBlock,
  type Photo,
  photosOf,
  SIGNUP_HREF,
  seoOf,
  signupFormProps,
  telegramOf,
  windowTitle,
} from './content.ts'
import {
  FOOTER_KEY,
  footer,
  footerCustomLabels,
  HEADER_KEY,
  headerBase,
  headerCustomProps,
  redirects,
  signupWindow,
  theme,
  windowCss,
} from './site-parts.ts'

// Перенос Vallex English на Averra через API — так же, как это делает владелец в админке, а не в
// обход неё: все проверки (схемы, контраст темы, ссылки меню) работают те же. Скрипт можно
// запускать повторно: вид (блоки, тема, шапка и подвал, окно, скрипт сайта) обновляется, а контент
// страниц и тексты шапки и подвала, которые клиент мог поправить, остаются (кроме --reset-content).

export type ImportOptions = {
  client: Client
  /** Контент исходного сайта: content.default.json или data/content.json живого сайта */
  contentFile: string
  /** public/ исходного сайта: из неё берутся фото (assets/images/…, uploads/…) */
  publicDir: string
  /** Файл выгрузки своих блоков (le-english.blocks.json) */
  blocksFile: string
  /** Картинка логотипа — в медиатеку про запас (в шапке логотип текстом); нет файла — без неё */
  logoFile?: string
  /** Зерно бумаги для фона темы (assets/grain.png); нет файла — фон сплошным цветом */
  grainFile?: string
  /** Скрипт сайта (site/script.js): улучшения формы записи; нет файла — без скрипта */
  siteScriptFile?: string
  /**
   * Вернуть контент из исходного сайта: страницы, тексты шапки и подвала перезаписываются
   * (правки клиента в них пропадут). Без флага на установке с прошлым переносом контент остаётся
   */
  resetContent?: boolean
  /** Адрес сайта (https://домен): для canonical и карты сайта; не задан — остаётся как есть */
  siteUrl?: string
  /**
   * Опубликовать страницы, тему, шапку и подвал. Без флага — только черновики. Форма записи
   * собирает персональные данные, поэтому сайт публикуется, только когда политика и согласие уже
   * опубликованы человеком: иначе ссылки формы вели бы на 404. Если у оставленных страниц или
   * шапки клиента есть неопубликованные правки, не сделанные самим скриптом, сайт не публикуется,
   * пока человек не проверит их или не добавит publishDrafts
   */
  publish: boolean
  /** Опубликовать и неопубликованные правки клиента (флаг --publish-drafts) */
  publishDrafts?: boolean
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
  /** Страницы, контент которых остался от прошлого запуска (правки клиента не тронуты) */
  keptPages: string[]
  legalDrafts: string[]
  /** Документы, чей черновик заменён свежим шаблоном целиком (флаг --rebuild-documents) */
  rebuiltDocuments: string[]
  /** Документы, у которых заменён только блок с ложной фразой, остальные правки на месте */
  repairedDocuments: string[]
  /** Опубликованные документы, которые говорят «нет форм заявок»: правит и публикует человек */
  staleDocuments: string[]
  published: boolean
  /** Скрипт сайта набора сохранён черновиком; false — файла нет или на установке свой скрипт */
  siteScriptSaved: boolean
  /**
   * Оставленные страницы, шапка и подвал, где есть неопубликованные правки не этого скрипта
   * (клиента): с --publish без --publish-drafts сайт не публикуется
   */
  draftsBefore: string[]
  /** Документы, которые надо опубликовать в админке, прежде чем публиковать сайт с формой */
  missingDocuments: string[]
}

type Json = Record<string, unknown>

type PageRecord = { title: string; draft: unknown; published: unknown }

/** JSON с ключами по алфавиту: тот же объект даёт тот же текст, в каком бы порядке он пришёл */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    const body = keys.map((key) => `${JSON.stringify(key)}:${stable((value as Json)[key])}`)
    return `{${body.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const fingerprint = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex')

/**
 * Что скрипт оставил черновиком в прошлый запуск: отпечатки страниц, шапки и подвала. Черновик с
 * тем же отпечатком — работа скрипта (первый запуск без --publish, потом с ним), с другим —
 * правка клиента. Файла нет или он не читается — каждый неопубликованный черновик считается
 * клиентским: лучше лишнее предупреждение, чем чужая незаконченная правка на сайте
 */
const draftsFile = (dir: string, siteId: string) => join(dir, `drafts-${siteId}.json`)

function readDrafts(dir: string, siteId: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(draftsFile(dir, siteId), 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

function writeDrafts(dir: string, siteId: string, drafts: Record<string, string>) {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(draftsFile(dir, siteId), `${JSON.stringify(drafts, null, 2)}\n`)
  } catch {
    // Страховка необязательная: без файла следующий запуск осторожнее, но работает
  }
}

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

/**
 * Кнопка записи в данных блока (первый экран, отзывы, запись внизу): ссылка на /zapis. Прошлый
 * перенос клал их без «Открывать в окне» — повторный запуск дописывает флажок, если клиент его не
 * трогал (поля нет). Снятый клиентом флажок (window: false) остаётся снятым
 */
const isSignupButton = (value: unknown): value is { href: string; window?: unknown } => {
  const href = (value as { href?: unknown } | null)?.href
  const bare = (path: string) => path.replace(/\/$/, '')
  return typeof href === 'string' && bare(href) === bare(SIGNUP_HREF)
}

/**
 * Черновик главной от прошлого запуска с тем, что нужно новому виду: флажок окна у кнопок записи и
 * поля для соцсетей в SEO, которых нет вовсе (пустое — выбор клиента). Тексты, порядок и состав
 * блоков — клиента, не трогаем
 */
export function upgradeHome(
  draft: Json,
  share: { shareTitle?: string; shareDescription?: string; imageAlt?: string },
) {
  const blocks = Array.isArray(draft.blocks) ? (draft.blocks as Json[]) : []
  const nextBlocks = blocks.map((block) => {
    const props = (block.props ?? {}) as Json
    if (typeof block.type !== 'string' || !block.type.startsWith('custom:le-')) return block
    let changed = false
    const nextProps: Json = { ...props }
    for (const [key, value] of Object.entries(props)) {
      if (isSignupButton(value) && value.window === undefined) {
        nextProps[key] = { ...value, window: true }
        changed = true
      }
    }
    return changed ? { ...block, props: nextProps } : block
  })
  const seo = { ...((draft.seo ?? {}) as Json) }
  for (const [key, value] of Object.entries(share)) {
    // Стёртое клиентом поле — его выбор: дописываем только то, чего нет вовсе
    if (value && seo[key] === undefined) seo[key] = value
  }
  return { ...draft, blocks: nextBlocks, seo }
}

/** Первая строка скрипта сайта набора: по ней видно, что скрипт наш, а не интегратора */
const SITE_SCRIPT_MARK = '// Скрипт сайта Vallex English'
/**
 * Последняя строка скрипта сайта, который ставит импорт: контрольная сумма кода над ней. Совпала —
 * скрипт никто не правил, его можно заменить новой версией набора; не совпала — интегратор дописал
 * своё, и повторный запуск скрипт не трогает
 */
const SITE_SCRIPT_SUM = '// Контрольная сумма набора: '
const sumOf = (code: string) => createHash('sha256').update(code).digest('hex').slice(0, 16)
export const stampSiteScript = (code: string) =>
  `${code.trim()}\n${SITE_SCRIPT_SUM}${sumOf(code.trim())}\n`
/** Скрипт сайта — набора и без правок: пустой или с меткой набора и верной контрольной суммой */
export const siteScriptUntouched = (script: string) => {
  const text = script.trim()
  if (text === '') return true
  const cut = text.lastIndexOf('\n')
  const body = text.slice(0, cut).trim()
  return (
    body.startsWith(SITE_SCRIPT_MARK) && text.slice(cut + 1) === `${SITE_SCRIPT_SUM}${sumOf(body)}`
  )
}

const SITE_NAME = 'Vallex English'
/** Описание картинки для соцсетей — как og:image:alt исходного сайта (src/render/main-page.js) */
const SHARE_IMAGE_ALT =
  'Валерия, преподаватель Vallex English, и надпись «Английский, который вписывается в твою жизнь»'
const DOCUMENTS = ['privacy', 'consent'] as const
/** Служебный адрес своей 404 в Averra (NOT_FOUND_PAGE_SLUG) */
const NOT_FOUND_SLUG = '404'
const blocksOf = (draft: Json) => (Array.isArray(draft.blocks) ? (draft.blocks as Json[]) : [])

/**
 * Страница уже перенесена этим скриптом (и её контент мог править клиент) — или это чужая страница
 * новой установки (демо-главная, своя 404 студии), которую перенос заменяет. Признак — блоки
 * переноса: свои блоки набора на главной, форма записи на /zapis, «Ой!» на 404 (и встроенный первый
 * экран 404 прошлых версий скрипта, если клиент правил в нём хоть одно поле)
 */
const OLD_NOT_FOUND = {
  title: 'Такой страницы нет',
  subtitle: 'Ой! Возможно, ссылка устарела. Всё самое важное — на главной.',
  label: 'На главную →',
  href: '/',
}
const oldNotFoundEdited = (props: Json | undefined) => {
  const button = (props?.button ?? {}) as Json
  return (
    props?.title !== OLD_NOT_FOUND.title ||
    props?.subtitle !== OLD_NOT_FOUND.subtitle ||
    button.label !== OLD_NOT_FOUND.label ||
    button.href !== OLD_NOT_FOUND.href
  )
}
/**
 * Главную уже обновлял этот скрипт с окнами записи: у кнопок записи включено «Открывать в окне»
 * (прошлые версии переноса его не ставили, а без страницы-окна клиент включать его не стал бы).
 * Тогда страница /zapis без окна — это клиент выключил окно
 */
const hasWindowFlags = (draft: Json) => JSON.stringify(blocksOf(draft)).includes('"window":true')
const ported: Record<string, (draft: Json) => boolean> = {
  index: (draft) => blocksOf(draft).some((block) => String(block.type).startsWith('custom:le-')),
  zapis: (draft) => blocksOf(draft).some((block) => block.type === 'form'),
  '404': (draft) =>
    blocksOf(draft).some(
      (block) =>
        block.type === 'custom:le-message' ||
        // 404 прошлых версий скрипта: тот же блок, но с правками клиента — остаётся
        (block.id === 'not-found' &&
          block.type === 'hero' &&
          oldNotFoundEdited(block.props as Json | undefined)),
    ),
}
type SettingsNow = {
  name: string
  titleTemplate: string
  language: string
  description: string
  ogImage: string | null
  icon: string | null
  redirects: { from: string; to: string }[]
  organization: Json & { socials?: string[] }
  cookies: Json
}
type KitSettings = Pick<
  SettingsNow,
  'name' | 'titleTemplate' | 'language' | 'description' | 'ogImage' | 'icon'
> & {
  organization: { name: string; email: string; inn: string; socials: string[] }
}

/**
 * Настройки сайта набора поверх того, что уже на установке. Первый перенос — значения набора
 * (организация дополняется: адрес и телефон, вписанные раньше, остаются). Повторный запуск
 * (`keepClient`) — настройки клиента не трогаются совсем: пустое поле (стёртый ИНН, убранный
 * Telegram, очищенное описание) — это выбор клиента, а не «не заполнено», поэтому набор
 * дописывает только то, чего у установки нет вовсе (undefined), и соцсети не объединяет. Группа
 * organization в API заменяется целиком, поэтому собираем её полностью
 */
export function settingsPatch(current: SettingsNow, kit: KitSettings, keepClient: boolean) {
  const pick = <T>(now: T | undefined, ours: T): T => (keepClient && now !== undefined ? now : ours)
  const org = current.organization
  const socials = pick(org.socials, kit.organization.socials)
  return {
    name: pick(current.name, kit.name),
    titleTemplate: pick(current.titleTemplate, kit.titleTemplate),
    language: pick(current.language, kit.language),
    description: pick(current.description, kit.description),
    // Нет картинки в исходнике — поле не трогаем, а не обнуляем
    ...(kit.ogImage && { ogImage: pick(current.ogImage, kit.ogImage) }),
    ...(kit.icon && { icon: pick(current.icon, kit.icon) }),
    organization: {
      type: 'Organization',
      ...org,
      name: pick(org.name, kit.organization.name),
      email: pick(org.email, kit.organization.email),
      inn: pick(org.inn, kit.organization.inn),
      socials,
    },
  }
}

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
  // Вид — от набора: перезаписывается при каждом запуске. Зерно бумаги — картинкой из медиатеки
  const grainId =
    options.grainFile && existsSync(options.grainFile)
      ? await uploadFile(options.grainFile)
      : undefined
  await client.put(`${base}/theme`, {
    ...theme,
    windowCss,
    ...(grainId && { background: { mediaId: grainId, size: 'tile' } }),
  })
  log('Тема: черновик сохранён')

  // ── Скрипт сайта: улучшения формы записи ────────────────────────────────────────────────────
  // Заменяем только пустой скрипт или скрипт набора без правок (метка и контрольная сумма). Свой
  // скрипт интегратора — и скрипт набора, в который дописали своё, — не затираем: предупреждаем
  let siteScript: { script: string; origins: string[] } | undefined
  if (options.siteScriptFile && existsSync(options.siteScriptFile)) {
    const raw = readFileSync(options.siteScriptFile, 'utf8')
    const code = stampSiteScript(raw)
    const present = await client.get<{ draft: { script: string; origins: string[] } }>(
      `${base}/script`,
    )
    // Тот же код без суммы — скрипт набора, вписанный руками из site/script.js: тоже не правка
    if (siteScriptUntouched(present.draft.script) || present.draft.script.trim() === raw.trim()) {
      siteScript = { script: code, origins: present.draft.origins }
      await client.put(`${base}/script`, siteScript)
      log('Скрипт сайта: черновик сохранён')
    } else {
      log(
        present.draft.script.trim().startsWith(SITE_SCRIPT_MARK)
          ? 'Скрипт сайта: скрипт набора на установке правили, не трогаю. Новая версия — site/script.js набора: перенесите отличия в «Скрипт сайта» вручную'
          : 'Скрипт сайта: на установке свой скрипт, не трогаю. Улучшения формы записи — site/script.js набора: перенесите их в «Скрипт сайта» вручную',
      )
    }
  }

  // ── Страницы прошлого переноса ──────────────────────────────────────────────────────────────
  // Контент — клиента: страница, уже перенесённая этим скриптом (ported), остаётся как есть,
  // дописывается только то, что нужно новому виду. --reset-content, первая установка и чужая
  // страница новой установки (демо-главная) — контент из исходного сайта
  const pagesBefore = await client.get<{ slug: string; hasUnpublishedChanges: boolean }[]>(
    `${base}/pages`,
  )
  const keptPages: string[] = []
  // Неопубликованные правки клиента в том, что скрипт оставляет как есть: с --publish они ушли
  // бы на сайт вместе с новым видом. Свой черновик прошлого запуска (отпечаток в backupDir) не в
  // счёт: иначе предупреждение выходило бы и на втором шаге «без --publish, потом с ним»
  const draftsBefore: string[] = []
  const draftBackupDir = options.backupDir ?? defaultBackupDir()
  const ownDrafts = readDrafts(draftBackupDir, site.id)
  // Части с правкой клиента: черновик после запуска — правка клиента, слитая с новым видом, и пока
  // её не опубликовали, он не наш (отпечаток не обновляем)
  const clientParts = new Set<string>()
  const noteClientDraft = (part: string, label: string, draft: unknown) => {
    if (fingerprint(draft) === ownDrafts[part]) return
    draftsBefore.push(label)
    clientParts.add(part)
  }
  const draftOfPage = async (slug: string) => {
    const listedPage = pagesBefore.find((page) => page.slug === slug)
    if (options.resetContent || !listedPage) return undefined
    const page = await client.get<PageRecord>(`${base}/pages/${slug}`)
    const draft = (page.draft ?? page.published) as Json | null
    if (!draft || !ported[slug]?.(draft)) return undefined
    if (listedPage.hasUnpublishedChanges && page.published !== null) {
      noteClientDraft(`page:${slug}`, `страница /${slug}`, draft)
    }
    return { title: page.title, draft }
  }
  // Главная уже перенесена — это повторный запуск: настройки сайта, шапка и подвал — клиента
  const home = await draftOfPage('index')

  // ── Настройки сайта: название, организация, адреса документов ────────────────────────────────
  const current = await client.get<{ settings: SettingsNow }>(`${base}/settings`)
  const keptRedirects = current.settings.redirects.filter(
    (one) => !redirects.some((redirect) => redirect.from === one.from),
  )
  const kitSettings: KitSettings = {
    name: SITE_NAME,
    // В заголовке вкладки документов и записи — название сайта, как у оригинала
    titleTemplate: `%s — ${SITE_NAME}`,
    language: 'ru',
    description: seo.description,
    ogImage: shareImageId ?? null,
    icon: iconId ?? null,
    organization: {
      name: legal.operator || SITE_NAME,
      email: legal.email,
      inn: legal.inn,
      socials: telegramOf(content) ? [telegramOf(content) as string] : [],
    },
  }
  await client.patch(`${base}/settings`, {
    ...settingsPatch(current.settings, kitSettings, home !== undefined),
    ...(options.siteUrl && { url: options.siteUrl }),
    redirects: [...keptRedirects, ...redirects],
  })
  log(
    home
      ? 'Настройки: правки клиента оставлены, пустые поля дописаны, редиректы со старых адресов документов'
      : 'Настройки: название, описание, организация, редиректы со старых адресов документов',
  )

  // ── Страницы ────────────────────────────────────────────────────────────────────────────────
  const share = {
    ...(seo.shareTitle && { shareTitle: seo.shareTitle }),
    ...(seo.shareDescription && { shareDescription: seo.shareDescription }),
    ...(shareImageId && { imageAlt: SHARE_IMAGE_ALT }),
  }
  if (home) {
    await client.put(`${base}/pages/index`, {
      title: home.title,
      content: upgradeHome(home.draft, share),
    })
    keptPages.push('index')
    log('Страница index: контент клиента оставлен, кнопкам записи — окно, SEO — поля для соцсетей')
  } else {
    await client.put(`${base}/pages/index`, {
      title: 'Vallex English',
      content: {
        blocks: homeBlocks(content, mediaOf),
        seo: {
          title: seo.title,
          description: seo.description,
          ...share,
          ...(shareImageId && { image: { mediaId: shareImageId } }),
        },
      },
    })
    log('Страница index: черновик сохранён')
  }
  // Запись: страница-окно. Как у /zapis/ исходного сайта — страница для ссылок из биографий и
  // сообщений и для перехода без JS: в шапке логотип и «← На главную». Подвал остаётся (у
  // оригинала его здесь нет): без подвала Averra всё равно выводит служебную полосу со ссылкой на
  // политику — она обязательна на каждой странице, а свой подвал в стиле сайта смотрится роднее
  const zapis = await draftOfPage('zapis')
  const zapisLook = { shortHeader: true, window: { ...signupWindow, title: windowTitle(content) } }
  if (zapis) {
    const draft = zapis.draft as Json & { window?: unknown }
    // Своё окно клиента (ширина, заголовок) остаётся. Нет окна: на установке прошлой версии
    // переноса — ставим окно набора, а если главную уже обновляла эта версия, окно выключил клиент
    const zapisWindow =
      draft.window ?? (home && hasWindowFlags(home.draft) ? undefined : zapisLook.window)
    await client.put(`${base}/pages/zapis`, {
      title: zapis.title,
      content: { ...draft, ...(zapisWindow !== undefined && { window: zapisWindow }) },
    })
    keptPages.push('zapis')
    log('Страница zapis: форма клиента оставлена, страница — окно записи')
  } else {
    await client.put(`${base}/pages/zapis`, {
      title: 'Запись на пробный урок',
      content: {
        blocks: [{ id: 'zapis-form', type: 'form', props: signupFormProps(content) }],
        seo: { noindex: true },
        ...zapisLook,
      },
    })
    log('Страница zapis: черновик сохранён — окно записи')
  }
  // Своя 404, как у оригинала: «Ой! Такой страницы нет» и кнопка на главную, в шапке только
  // логотип. Без неё на чужом адресе была бы стандартная «Страница не найдена»
  const notFound = await draftOfPage(NOT_FOUND_SLUG)
  if (notFound) {
    keptPages.push(NOT_FOUND_SLUG)
    log('Страница 404: контент клиента оставлен')
  } else {
    await client.put(`${base}/pages/${NOT_FOUND_SLUG}`, {
      title: 'Страница не найдена',
      content: {
        blocks: [notFoundBlock],
        seo: { noindex: true },
        shortHeader: true,
      },
    })
    log('Страница 404: черновик сохранён')
  }

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
  // Документ — служебная страница: у оригинала в шапке только логотип и «← На главную». Ставим
  // короткую шапку черновику из шаблона — только что созданному или пересобранному: в черновике,
  // который вёл человек, вид шапки решает он
  const shortenHeader = (document: string, page: { title: string; draft: unknown }) =>
    client.put(`${base}/pages/${document}`, {
      title: page.title,
      content: { ...(page.draft as Json), shortHeader: true },
    })
  for (const document of DOCUMENTS) {
    const found = existing.find((page) => page.slug === document)
    if (!found) {
      const created = await client.post<PageRecord>(`${base}/settings/legal-pages`, { document })
      await shortenHeader(document, created)
      legalDrafts.push(document)
      log(`Документ /${document}: черновик создан, шапка — короткая`)
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
      await shortenHeader(document, fresh)
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
      const draft = page.draft as { shortHeader?: unknown; hideHeader?: unknown } | null
      if (draft?.shortHeader !== true && draft?.hideHeader !== true) {
        log(
          `Документ /${document}: в шапке меню, у оригинала — логотип и «← На главную». Короткая шапка — в редакторе страницы: «SEO» → «Шапка на этой странице» → «Короткая»`,
        )
      }
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
  // Логотип в шапке — текстом (headerBrand). Картинка логотипа — только в медиатеку, про запас: в
  // виде «Текст» шапка картинку не хранит, а Лера может переключить на «Картинку» и выбрать её.
  // Вид (свой вид le-header, настройки запасной стандартной шапки) — от набора. Тексты (логотип,
  // меню, кнопка, подписи своего вида) после первого переноса — клиента: повторный запуск их не
  // трогает, только дописывает кнопке записи «Открывать в окне», если флажка ещё нет
  if (options.logoFile && existsSync(options.logoFile)) await uploadFile(options.logoFile)
  type Chrome = Json & { custom?: { key?: string; props?: Json } | null }
  const chromeDraft = async (path: string) => {
    const state = await client.get<{
      draft: Chrome | null
      published: Chrome | null
      unpublished: boolean
    }>(`${base}/${path}`)
    // Правка клиента — только то, чего нет на сайте и что скрипт оставит: решается ниже (Ours)
    if (state.draft && state.published !== null && state.unpublished) {
      clientChrome[path] = state.draft
    }
    return state.draft ?? state.published
  }
  const clientChrome: Record<string, Chrome> = {}
  const brand = headerBrand(content)
  const headerNow = options.resetContent ? null : await chromeDraft('header')
  // Шапку и подвал уже ставил этот скрипт — их тексты клиента. Признак не тексты (их клиент мог
  // поправить), а установка и вид: главная уже перенесена (home), свой вид набора или вид прошлых
  // версий переноса (у шапки — кнопка-«таблетка» с фоном у пунктов, у подвала — одна строка фоном
  // страницы рукописной подписью). Иначе это шапка и подвал новой установки — ставим свои
  const look = (headerNow?.look ?? {}) as Json
  const headerOurs =
    headerNow !== null &&
    (home !== undefined ||
      headerNow.custom?.key === HEADER_KEY ||
      (look.buttonShape === headerBase.look.buttonShape &&
        look.linkHover === headerBase.look.linkHover) ||
      (headerNow.brand === 'text' && headerNow.logoMark === brand.logoMark))
  if (headerOurs && clientChrome.header) {
    noteClientDraft('header', 'шапка', clientChrome.header)
  }
  const fresh = {
    ...headerBase,
    ...brand,
    logo: null,
    menu: menuItems(content),
    custom: { key: HEADER_KEY, props: headerCustomProps },
  }
  if (headerNow && headerOurs) {
    const button = headerNow.button as Json | null | undefined
    await client.put(`${base}/header`, {
      ...fresh,
      brand: headerNow.brand,
      logoMark: headerNow.logoMark,
      logoText: headerNow.logoText,
      logo: headerNow.logo ?? null,
      menu: headerNow.menu,
      button:
        button && button.page === 'zapis' && button.window === undefined
          ? { ...button, window: true }
          : button,
      custom: {
        key: HEADER_KEY,
        props:
          headerNow.custom?.key === HEADER_KEY
            ? { ...headerCustomProps, ...headerNow.custom.props }
            : headerCustomProps,
      },
    })
  } else {
    await client.put(`${base}/header`, fresh)
  }
  const sign = footerSign(content)
  const footerNow = options.resetContent ? null : await chromeDraft('footer')
  const footerOurs =
    footerNow !== null &&
    (home !== undefined ||
      footerNow.custom?.key === FOOTER_KEY ||
      (footerNow.layout === footer.layout &&
        footerNow.tone === footer.tone &&
        footerNow.textFont === footer.textFont) ||
      footerNow.text === sign)
  if (footerOurs && clientChrome.footer) noteClientDraft('footer', 'подвал', clientChrome.footer)
  const footerProps = (text: string) => ({ sign: text, ...footerCustomLabels })
  if (footerNow && footerOurs) {
    const text = typeof footerNow.text === 'string' ? footerNow.text : sign
    await client.put(`${base}/footer`, {
      ...footer,
      text,
      custom: {
        key: FOOTER_KEY,
        props:
          footerNow.custom?.key === FOOTER_KEY
            ? { ...footerProps(text), ...footerNow.custom.props }
            : footerProps(text),
      },
    })
  } else {
    await client.put(`${base}/footer`, {
      ...footer,
      text: sign,
      custom: { key: FOOTER_KEY, props: footerProps(sign) },
    })
  }
  log(
    headerOurs || footerOurs
      ? 'Шапка и подвал: вид обновлён, тексты клиента оставлены'
      : 'Шапка и подвал: черновики сохранены',
  )

  // ── Публикация ──────────────────────────────────────────────────────────────────────────────
  const listed = await client.get<{ slug: string; publishedAt: string | null }[]>(`${base}/pages`)
  const missingDocuments = DOCUMENTS.filter(
    (slug) => !listed.some((page) => page.slug === slug && page.publishedAt !== null),
  ).map((slug) => `/${slug}`)
  const clientDrafts = draftsBefore.length > 0 && !options.publishDrafts
  const publish =
    options.publish && missingDocuments.length === 0 && staleDocuments.length === 0 && !clientDrafts
  if (options.publish && missingDocuments.length > 0) {
    log(
      `Сайт не опубликован: форма записи собирает персональные данные, а ${missingDocuments.join(' и ')} — черновики. Проверьте их в админке, опубликуйте и запустите скрипт с --publish ещё раз`,
    )
  } else if (options.publish && staleDocuments.length > 0) {
    log(
      'Сайт не опубликован: политика всё ещё говорит, что форм на сайте нет («нет форм заявок»). Поправьте её (см. предупреждение выше) и запустите скрипт с --publish ещё раз',
    )
  }
  if (options.publish && clientDrafts) {
    log(
      `Сайт не опубликован: у оставленных частей есть неопубликованные правки клиента (${draftsBefore.join(', ')}). Проверьте их в админке и опубликуйте сами или запустите скрипт с --publish-drafts: они уйдут на сайт вместе с новым видом`,
    )
  }
  // Что осталось черновиком от этого запуска: следующий не примет это за правку клиента. Кроме
  // частей с правкой клиента, которую не опубликовали: слитый с новым видом черновик содержит её,
  // и с новым отпечатком повторный --publish принял бы её за свою и выпустил на сайт
  const after: Record<string, string> = {}
  const keep = (part: string, draft: unknown) => {
    if (clientParts.has(part) && !publish) {
      const previous = ownDrafts[part]
      if (previous !== undefined) after[part] = previous
    } else {
      after[part] = fingerprint(draft)
    }
  }
  for (const slug of ['index', 'zapis', NOT_FOUND_SLUG]) {
    const page = await client.get<PageRecord>(`${base}/pages/${slug}`)
    keep(`page:${slug}`, page.draft)
  }
  for (const path of ['header', 'footer']) {
    keep(path, (await client.get<{ draft: unknown }>(`${base}/${path}`)).draft)
  }
  writeDrafts(draftBackupDir, site.id, after)
  if (publish) {
    await client.post(`${base}/pages/index/publish`)
    await client.post(`${base}/pages/zapis/publish`)
    await client.post(`${base}/pages/${NOT_FOUND_SLUG}/publish`)
    await client.post(`${base}/theme/publish`)
    await client.post(`${base}/header/publish`)
    await client.post(`${base}/footer/publish`)
    if (siteScript) await client.post(`${base}/script/publish`, { draft: siteScript })
    log(`Опубликованы: страницы, тема, шапка, подвал${siteScript ? ', скрипт сайта' : ''}`)
  }

  return {
    siteId: site.id,
    blocks: file.blocks.map((block) => block.key),
    warnings,
    pages: ['index', 'zapis', NOT_FOUND_SLUG],
    keptPages,
    legalDrafts,
    rebuiltDocuments,
    repairedDocuments,
    staleDocuments,
    published: publish,
    siteScriptSaved: siteScript !== undefined,
    draftsBefore,
    missingDocuments,
  }
}

export { ApiFailure }
