import { blocks as blockCatalog } from './blocks'
import { samePhone } from './contact'
import { type BlockSchemaNode, blockPropsSchema, schemaStep } from './media-svg'
import {
  MAIN_PAGE_SLUG,
  NOT_FOUND_PAGE_SLUG,
  type PageSeo,
  SEO_DESCRIPTION_RECOMMENDED,
} from './page'
import { pluralRu } from './plural'
import { applyTitleTemplate, normalizeRedirectPath } from './site-settings'
import type { Theme } from './theme'
import { isInternalPath } from './url'

// SEO страницы: какой у неё заголовок во вкладке и в поиске, какой адрес канонический, кто
// получает h1 и что посоветовать до публикации. Одни функции у рендерера, админки и MCP — чтобы
// сниппет в редакторе, проверки и собранный сайт не разошлись

/** Блок страницы так, как его видят проверки: черновик может быть ещё не проверен схемой */
export type SeoBlock = { readonly id: string; readonly type: string; readonly props?: unknown }

/**
 * Какой блок получает главный заголовок страницы (h1): первый «Первый экран». Остальные блоки —
 * h2, поэтому h1 на странице не больше одного. Это правило рисует Page (@averra/blocks)
 */
export const mainHeadingBlock = <B extends SeoBlock>(blocks: readonly B[]) =>
  blocks.find((block) => block.type === 'hero')

/**
 * Что сайт сообщает странице для SEO: GET /api/sites/:siteId отдаёт это всем, кто правит страницы
 */
export type SiteSeo = {
  /** Шаблон заголовка (%s — заголовок страницы), пусто — без шаблона */
  titleTemplate: string
  /** Описание по умолчанию */
  description: string
  /** Картинка сайта для соцсетей (id в медиатеке) */
  ogImage: string | null
  /** Адрес сайта https://домен; null — не задан (нет canonical, og:image, карты сайта) */
  url: string | null
  /** Сайт скрыт от поисковиков целиком (раздел «SEO») */
  hideFromSearch: boolean
  /**
   * Организация из «SEO → Организация» — сверить с «Контактами», которые просят разметку. Только
   * людям: телефон ИП — персональные данные, токену API их не отдаём. Нет — проверки нет
   */
  organization?: SiteOrganization | undefined
}

/** Что от «SEO → Организация» нужно проверке «Контактов»: название и то, что пишет разметка */
export type SiteOrganization = { name: string; phone: string; email: string; street: string }

type TitledPage = { slug: string; title: string; seo?: Pick<PageSeo, 'title'> | undefined }

/**
 * Заголовок во вкладке и в поиске: SEO-заголовок целиком; нет его — заголовок страницы по шаблону
 * сайта, а у главной — как есть (его пишут целиком)
 */
export function pageDocumentTitle(page: TitledPage, titleTemplate: string) {
  const own = page.seo?.title?.trim()
  if (own) return own
  return page.slug === MAIN_PAGE_SLUG ? page.title : applyTitleTemplate(titleTemplate, page.title)
}

/**
 * Адрес страницы на собранном сайте: главная — /, остальные — /адрес/ с косой чертой. Так их
 * отдаёт Caddy (папка с index.html), и такой адрес — канонический по умолчанию
 */
export const canonicalPath = (slug: string) => (slug === MAIN_PAGE_SLUG ? '/' : `/${slug}/`)

/**
 * Канонический адрес страницы целиком: заданный в SEO страницы (путь — на домене сайта) или свой.
 * Без адреса сайта путь в абсолютный не превратить — undefined
 */
export function pageCanonicalUrl(
  page: { slug: string; seo?: Pick<PageSeo, 'canonical'> | undefined },
  siteUrl: string | null,
) {
  // Canonical на эту же страницу, но в другом написании (/ceny, ?utm=…, ДОМЕН) выводится её
  // каноническим адресом: /ceny Caddy перенаправляет на /ceny/, и canonical разошёлся бы с картой
  // сайта, где лежит /ceny/
  const own = canonicalElsewhere(page, siteUrl) ? page.seo?.canonical?.trim() : undefined
  // Другая страница своего сайта (путь или https://сайт/…) пишется так же, как в карте сайта:
  // /ceny → /ceny/, иначе canonical вёл бы на адрес с редиректом Caddy
  const ownPath = own && (isInternalPath(own) ? own : sameSiteRest(own, siteUrl))
  if (own && !ownPath) return own
  if (!siteUrl) return undefined
  // Склейка, а не URL: у схемы нет API среды. Адрес сайта — https://домен без косой черты в
  // конце, путь — с / в начале. Не-ASCII в пути (/цены) кодируется, как сделал бы URL
  const path = (ownPath ? withPageSlash(ownPath) : canonicalPath(page.slug)).replace(
    /[^\p{ASCII}]+/gu,
    (chunk) => encodeURIComponent(chunk),
  )
  return `${siteUrl.replace(/\/+$/, '')}${path}`
}

/** Путь ссылки https на этот сайт (/… с ?… и #…), или undefined — ссылка на другой сайт */
function sameSiteRest(href: string, siteUrl: string | null) {
  if (!siteUrl) return undefined
  const origin = siteUrl.toLowerCase().replace(/\/$/, '')
  const lower = href.toLowerCase()
  if (lower !== origin && !lower.startsWith(`${origin}/`)) return undefined
  return href.slice(origin.length) || '/'
}

/**
 * Путь страницы в том виде, в каком его отдаёт сервер: /ceny → /ceny/ (папка с index.html). Путь
 * с расширением (/price.pdf) — файл, он остаётся как есть; ?… и #… сохраняются
 */
function withPageSlash(href: string) {
  const split = href.search(/[?#]/)
  const path = split === -1 ? href : href.slice(0, split)
  const tail = split === -1 ? '' : href.slice(split)
  if (path.endsWith('/') || /\.[^/]*$/.test(path)) return href
  return `${path}/${tail}`
}

/**
 * Указывает ли canonical страницы на другой адрес. Тогда поисковик показывает тот адрес, а эта
 * страница не попадает в карту сайта. Ссылка https на свой же адрес — не «другой»
 */
export function canonicalElsewhere(
  page: { slug: string; seo?: Pick<PageSeo, 'canonical'> | undefined },
  siteUrl: string | null,
) {
  const own = page.seo?.canonical?.trim()
  if (!own) return false
  const ownPath = normalizeRedirectPath(canonicalPath(page.slug))
  if (isInternalPath(own)) return normalizeRedirectPath(own.split('?')[0] ?? own) !== ownPath
  const rest = sameSiteRest(own, siteUrl)
  if (rest === undefined) return true
  return normalizeRedirectPath(rest.split('?')[0] ?? rest) !== ownPath
}

// ── Карточка для соцсетей ───────────────────────────────────────────────────────────────────

/**
 * Что нарисовано на карточке из заголовка (картинка для соцсетей, когда своей нет): по этим полям
 * API рисует PNG, а рендерер считает версию адреса. Поменялось хоть что-то — адрес другой, и
 * соцсеть не покажет старую карточку
 */
export type OgCard = {
  title: string
  siteName: string
  /** Домен сайта без https:// или пусто */
  domain: string
  colors: Pick<Theme['colors'], 'background' | 'text' | 'muted' | 'accent'>
}

/** Версия вида карточки: поменяли раскладку в API — увеличьте, и у всех карточек новый адрес */
export const OG_CARD_DESIGN = 1

export function ogCardOf(input: {
  title: string
  siteName: string
  siteUrl: string | null
  theme: Theme
}): OgCard {
  const { background, text, muted, accent } = input.theme.colors
  return {
    title: input.title.trim(),
    siteName: input.siteName.trim(),
    domain: input.siteUrl ? input.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : '',
    colors: { background, text, muted, accent },
  }
}

/** Короткий хеш карточки (FNV-1a, 32 бита) для ?v= в адресе картинки */
export function ogCardVersion(card: OgCard) {
  const text = JSON.stringify([OG_CARD_DESIGN, card])
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ── Проверки ────────────────────────────────────────────────────────────────────────────────

/**
 * Длины, которые показывают поисковики. Режут они по ширине в пикселях, поэтому границы —
 * примерные: Google показывает около 60 символов заголовка, Яндекс — около 70; описание —
 * около 160 символов, а короче 70 поисковик охотно заменяет куском текста со страницы
 */
export const SEO_TITLE_RANGE = { min: 30, max: 60, cut: 70 } as const
export const SEO_DESCRIPTION_RANGE = { min: 70, max: SEO_DESCRIPTION_RECOMMENDED } as const
/** Адрес страницы длиннее — совет укоротить: в выдаче и в сообщении его читают целиком */
export const SLUG_RECOMMENDED_MAX = 40

/** good — всё хорошо, warning — стоит поправить, problem — важно. Ни одна не мешает публикации */
export type SeoCheckLevel = 'good' | 'warning' | 'problem'

export type SeoCheckId =
  | 'title'
  | 'description'
  | 'h1'
  | 'alt'
  | 'slug'
  | 'site-hidden'
  | 'noindex'
  | 'canonical'
  | 'image'
  | 'contacts'

export type SeoCheck = { id: SeoCheckId; level: SeoCheckLevel; title: string; advice?: string }

export type SeoCheckPage = {
  slug: string
  title: string
  /** Блоки черновика как есть: правка идёт, и схему они могут ещё не проходить */
  blocks: readonly SeoBlock[]
  seo?: PageSeo | undefined
}

const chars = (count: number) => `${count} ${pluralRu(count, ['символ', 'символа', 'символов'])}`

/** Длина так, как её видит человек: «ё» и эмодзи — по одному символу */
const lengthOf = (text: string) => [...text].length

function titleCheck(title: string, ownSeoTitle: boolean): SeoCheck {
  const length = lengthOf(title)
  const fix = ownSeoTitle
    ? 'Поправьте SEO-заголовок.'
    : 'Поправьте заголовок страницы или задайте SEO-заголовок — он пишется целиком.'
  if (length < SEO_TITLE_RANGE.min) {
    return {
      id: 'title',
      level: 'warning',
      title: `Заголовок короткий: ${chars(length)}`,
      advice: `В поиске это главная строка. Допишите, что на странице и для кого, — лучше ${SEO_TITLE_RANGE.min}–${SEO_TITLE_RANGE.max} символов. ${fix}`,
    }
  }
  if (length <= SEO_TITLE_RANGE.max) {
    return { id: 'title', level: 'good', title: `Заголовок ${chars(length)} — в самый раз` }
  }
  if (length <= SEO_TITLE_RANGE.cut) {
    return {
      id: 'title',
      level: 'warning',
      title: `Заголовок ${chars(length)}: Google может обрезать`,
      advice: `Google показывает около ${SEO_TITLE_RANGE.max} символов, Яндекс — чуть больше. Главное — в начало. ${fix}`,
    }
  }
  return {
    id: 'title',
    level: 'warning',
    title: `Заголовок ${chars(length)}: в поиске обрежется`,
    advice: `Поисковики показывают около ${SEO_TITLE_RANGE.max}–${SEO_TITLE_RANGE.cut} символов, остальное — многоточием. ${fix}`,
  }
}

function descriptionCheck(own: string, site: string): SeoCheck {
  const range = `${SEO_DESCRIPTION_RANGE.min}–${SEO_DESCRIPTION_RANGE.max} символов`
  if (own === '' && site === '') {
    return {
      id: 'description',
      level: 'problem',
      title: 'Описания нет',
      advice: `Поисковик возьмёт кусок текста со страницы сам, часто неудачный. Напишите 1–2 предложения: что здесь и чем полезно, — ${range}.`,
    }
  }
  if (own === '') {
    return {
      id: 'description',
      level: 'warning',
      title: 'Своего описания нет — берётся описание сайта',
      advice: `Одно описание на много страниц поисковик считает дублем. Напишите своё, ${range}.`,
    }
  }
  const length = lengthOf(own)
  if (length < SEO_DESCRIPTION_RANGE.min) {
    return {
      id: 'description',
      level: 'warning',
      title: `Описание короткое: ${chars(length)}`,
      advice: `Короткое описание поисковик часто заменяет куском текста со страницы. Лучше ${range}.`,
    }
  }
  if (length <= SEO_DESCRIPTION_RANGE.max) {
    return { id: 'description', level: 'good', title: `Описание ${chars(length)} — в самый раз` }
  }
  return {
    id: 'description',
    level: 'warning',
    title: `Описание ${chars(length)}: в поиске обрежется`,
    advice: `Поисковик покажет около ${SEO_DESCRIPTION_RANGE.max} символов — главное поставьте в начало.`,
  }
}

const textProp = (props: unknown, key: string) => {
  const value = (props as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function headingCheck(blocks: readonly SeoBlock[]): SeoCheck {
  const main = mainHeadingBlock(blocks)
  if (!main) {
    return {
      id: 'h1',
      level: 'problem',
      title: 'На странице нет главного заголовка (h1)',
      advice:
        'Его даёт блок «Первый экран». Поставьте его в начало: по h1 поисковик и экранный диктор понимают, о чём страница.',
    }
  }
  if (blocks[0] !== main) {
    return {
      id: 'h1',
      level: 'warning',
      title: 'Главный заголовок (h1) не в начале страницы',
      advice:
        'h1 получает первый «Первый экран», а перед ним стоят другие блоки. Поставьте «Первый экран» первым.',
    }
  }
  const text = textProp(main.props, 'title')
  return {
    id: 'h1',
    level: 'good',
    title: text ? `Главный заголовок (h1) один: «${text}»` : 'Главный заголовок (h1) один',
  }
}

/**
 * Картинки блоков: объекты с mediaId — где угодно в полях блока. Картинка, у которой по схеме поля
 * нет alt (Logo в «Клиентах»: его описание — название рядом, оно обязательно), не проверяется.
 * Схему узнаём по типу блока; незнакомый тип — проверяем всё, что похоже на картинку
 */
function blockImages(blocks: readonly SeoBlock[]) {
  const found: { block: SeoBlock; alt: string }[] = []
  const walk = (block: SeoBlock, value: unknown, node: BlockSchemaNode | undefined) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(block, item, schemaStep(node, 0))
      return
    }
    if (typeof value !== 'object' || value === null) return
    const record = value as Record<string, unknown>
    if (typeof record.mediaId === 'string') {
      if (node?.properties && !('alt' in node.properties)) return
      found.push({ block, alt: typeof record.alt === 'string' ? record.alt.trim() : '' })
      return
    }
    for (const [key, child] of Object.entries(record)) walk(block, child, schemaStep(node, key))
  }
  for (const block of blocks) walk(block, block.props, blockPropsSchema(block.type))
  return found
}

/**
 * Описание, которое ничего не говорит: имя файла (IMG_2041.jpg, DSC0001, photo-3) или одно слово
 * «фото», «картинка», «image». Его прочтёт диктор вместо картинки — и ничего не поймёт
 */
export function isWeakAlt(alt: string) {
  const text = alt.trim().toLowerCase()
  if (/\.(jpe?g|png|webp|avif|gif|heic)$/.test(text)) return true
  if (/^(img|dsc|dscn|image|photo|pic|screenshot|снимок)[\s_-]*\d+$/.test(text)) return true
  return /^(фото|фотография|картинка|изображение|рисунок|иллюстрация|баннер|image|photo|picture|img|banner|pic)$/.test(
    text,
  )
}

const blockTitle = (type: string) =>
  blockCatalog.find((block) => block.type === type)?.title ?? type

function altCheck(blocks: readonly SeoBlock[]): SeoCheck | undefined {
  const images = blockImages(blocks)
  if (images.length === 0) return undefined
  const empty = images.filter((image) => image.alt === '')
  if (empty.length > 0) {
    const where = [...new Set(empty.map((image) => `«${blockTitle(image.block.type)}»`))].join(', ')
    return {
      id: 'alt',
      level: 'problem',
      title: `Картинка без описания (alt): ${where}`,
      advice:
        'Опишите, что на картинке: это прочтёт экранный диктор и увидит поисковик. Без описания страницу не сохранить.',
    }
  }
  const weak = images.find((image) => isWeakAlt(image.alt))
  if (weak) {
    return {
      id: 'alt',
      level: 'warning',
      title: `Описание картинки ничего не говорит: «${weak.alt}»`,
      advice:
        'Напишите, что на картинке, например «Кухня после ремонта, белые фасады». Имя файла и слово «фото» диктору не помогут.',
    }
  }
  return {
    id: 'alt',
    level: 'good',
    title:
      images.length === 1
        ? 'У картинки есть описание (alt)'
        : 'У всех картинок есть описание (alt)',
  }
}

function slugCheck(slug: string): SeoCheck {
  const length = lengthOf(slug)
  if (length > SLUG_RECOMMENDED_MAX) {
    return {
      id: 'slug',
      level: 'warning',
      title: `Адрес длинный: ${chars(length)}`,
      advice:
        'Короткий адрес легче прочитать в выдаче и переслать: хватит 2–4 слов, например /remont-kuhni. У опубликованной страницы адрес лучше не менять — сломаются ссылки на неё.',
    }
  }
  // Адрес — как его пишет админка (/ceny): в панели «SEO» он стоит рядом
  return { id: 'slug', level: 'good', title: `Адрес короткий: /${slug}` }
}

/**
 * Советы по SEO страницы — «как у Yoast», но по делу: длина заголовка и описания, h1, alt у
 * картинок, длина адреса, случайно скрытая страница, canonical и картинка для соцсетей. Порядок —
 * по темам; что показать первым, решает экран. Страница 404 не индексируется: у неё только
 * заголовок, h1 и картинки
 */
export function pageSeoChecks(page: SeoCheckPage, site: SiteSeo): SeoCheck[] {
  const seo = page.seo ?? {}
  const notFound = page.slug === NOT_FOUND_PAGE_SLUG
  const documentTitle = pageDocumentTitle(page, site.titleTemplate)
  const checks: SeoCheck[] = [
    // 404 в поиск не попадает: длина заголовка ей не важна, а совет висел бы на кнопке «SEO»
    // всегда. Заголовок во вкладке всё равно показываем — его видит посетитель
    notFound
      ? { id: 'title', level: 'good', title: `Заголовок во вкладке: «${documentTitle}»` }
      : titleCheck(documentTitle, Boolean(seo.title?.trim())),
  ]
  if (!notFound) checks.push(descriptionCheck(seo.description?.trim() ?? '', site.description))
  checks.push(headingCheck(page.blocks))
  const alt = altCheck(page.blocks)
  if (alt) checks.push(alt)
  if (notFound) return checks

  const contacts = site.organization && contactsCheck(page.blocks, site.organization)
  if (contacts) checks.push(contacts)

  if (page.slug !== MAIN_PAGE_SLUG) checks.push(slugCheck(page.slug))

  if (site.hideFromSearch) {
    checks.push({
      id: 'site-hidden',
      level: 'warning',
      title: 'Весь сайт скрыт от поисковиков',
      advice:
        'Так и задумано, пока сайт делают. При запуске владелец снимает флажок «Скрыть сайт от поисковиков» в разделе «SEO».',
    })
  }
  if (seo.noindex) {
    checks.push({
      id: 'noindex',
      level: 'warning',
      title: 'Страница скрыта от поисковиков (noindex)',
      advice:
        'Для «Спасибо», политики и черновых акций так и надо. Если страницу должны находить в поиске — снимите флажок.',
    })
  } else if (!site.hideFromSearch) {
    checks.push({ id: 'noindex', level: 'good', title: 'Страница открыта поисковикам' })
  }
  if (!seo.noindex && canonicalElsewhere(page, site.url)) {
    checks.push({
      id: 'canonical',
      level: 'warning',
      title: `Основной адрес — другой: ${seo.canonical?.trim()}`,
      advice:
        'Поисковик покажет в выдаче тот адрес, а эту страницу — нет, и в карте сайта её не будет. Если это копия другой страницы — так и надо.',
    })
  }

  if (!site.url) {
    checks.push({
      id: 'image',
      level: 'warning',
      title: 'Адрес сайта не задан — у ссылки в соцсетях не будет картинки',
      advice:
        'Без адреса сайта нет абсолютных ссылок: картинки для соцсетей, canonical и карты сайта. Адрес задают в разделе «SEO» или при установке (SITE_URL).',
    })
  } else if (seo.image) {
    checks.push({ id: 'image', level: 'good', title: 'Картинка для соцсетей — своя' })
  } else if (site.ogImage) {
    checks.push({
      id: 'image',
      level: 'good',
      title: 'Картинка для соцсетей — общая картинка сайта',
    })
  } else {
    checks.push({
      id: 'image',
      level: 'good',
      title: 'Картинка для соцсетей — карточка из заголовка',
      advice: 'Своя картинка 1200 × 630 обычно смотрится в ленте лучше.',
    })
  }
  return checks
}

/** Сравнение без пробелов, знаков и регистра: «ул. Ленина, 50» и «Ленина 50» — одно и то же */
const plainText = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * «Контакты» с разметкой для поисковиков и «SEO → Организация». Разметка — одна организация, и
 * телефон, почта и адрес в ней из «SEO» главнее блока (рендерер, organizationJsonLd). Разошлись —
 * поисковик покажет одно, а посетитель увидит другое: советуем свести. Нет названия организации —
 * разметки не будет вовсе
 */
function contactsCheck(blocks: readonly SeoBlock[], org: SiteOrganization): SeoCheck | undefined {
  const block = blocks.find(
    (item) =>
      item.type === 'contacts' &&
      (item.props as Record<string, unknown> | undefined)?.markup === true,
  )
  if (!block) return undefined
  if (org.name.trim() === '') {
    return {
      id: 'contacts',
      level: 'warning',
      title: 'Разметки организации не будет: в «SEO → Организация» нет названия',
      advice:
        'Флажок «Разметка для поисковиков» в «Контактах» ставит на страницу организацию из «SEO → Организация». Владелец вписывает там название — или снимите флажок.',
    }
  }
  const phone = textProp(block.props, 'phone')
  const email = textProp(block.props, 'email')
  const address = textProp(block.props, 'address')
  const differs = [
    org.phone && phone && !samePhone(org.phone, phone) ? 'телефон' : '',
    org.email && email && org.email.trim().toLowerCase() !== email.toLowerCase() ? 'почта' : '',
    org.street && address && !plainText(address).includes(plainText(org.street)) ? 'адрес' : '',
  ].filter(Boolean)
  if (differs.length === 0) {
    return { id: 'contacts', level: 'good', title: '«Контакты» и разметка организации совпадают' }
  }
  return {
    id: 'contacts',
    level: 'warning',
    title: `«Контакты» и «SEO → Организация» расходятся: ${differs.join(', ')}`,
    advice:
      'В разметку для поисковиков идут данные из «SEO → Организация», а посетитель видит данные блока. Сведите их: поправьте блок или попросите владельца поправить «SEO».',
  }
}

/** Только советы (warning и problem): их считает кнопка «SEO» и отдаёт MCP */
export const seoAdvice = (checks: readonly SeoCheck[]) =>
  checks.filter((check) => check.level !== 'good')
