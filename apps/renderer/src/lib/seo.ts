import {
  canonicalElsewhere,
  canonicalPath,
  Ga4Id,
  isServicePageSlug,
  MAIN_PAGE_SLUG,
  type MediaFile,
  type MediaMap,
  MetrikaId,
  NOT_FOUND_PAGE_SLUG,
  ogCardOf,
  ogCardVersion,
  type PageContent,
  pageCanonicalUrl,
  pageDocumentTitle,
  type StoredSiteSettings,
  siteLanguages,
  type Theme,
} from '@averra/schema'

// Всё, что сайт говорит поисковикам, соцсетям и аналитике: <head> страницы, robots.txt,
// sitemap.xml, манифест и JSON-LD организации. Чистые функции без astro:* — их проверяют тесты
// рендерера, а page.astro и эндпоинты только подставляют результат. Строки из настроек
// экранируются здесь: в HTML они попадают через set:html

export type SeoSite = {
  name: string
  /** Адрес сайта (https://домен) или null — тогда нет canonical, og:url, og:image и sitemap */
  url: string | null
  theme: Theme
  settings: StoredSiteSettings
}

export type SeoPage = {
  slug: string
  title: string
  content: PageContent
  /** Когда опубликована: lastmod в sitemap.xml */
  publishedAt?: string | null
}

/** Текст и значения атрибутов в HTML */
export function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export { canonicalPath }

/**
 * Заголовок во вкладке: SEO-заголовок целиком или заголовок по шаблону сайта (у главной — как есть)
 */
export const documentTitle = (site: SeoSite, page: SeoPage) =>
  pageDocumentTitle({ ...page, seo: page.content.seo }, site.settings.titleTemplate)

/**
 * Попадает ли страница в индекс: сайт не скрыт, у страницы нет noindex, это не страница 404 (её
 * показывают на чужих адресах, в поиске ей не место) и не страница со служебным адресом из старой
 * базы (/api/ закрыт в robots.txt, /500/ на сервере не открывается — RESERVED_PAGE_SLUGS)
 */
export function isIndexable(site: SeoSite, page: SeoPage) {
  return (
    !site.settings.hideFromSearch &&
    page.content.seo?.noindex !== true &&
    page.slug !== NOT_FOUND_PAGE_SLUG &&
    !isServicePageSlug(page.slug)
  )
}

/** Описание страницы: своё или сайта по умолчанию */
export const pageDescription = (site: SeoSite, page: SeoPage) =>
  page.content.seo?.description || site.settings.description

/** Ширина картинки для соцсетей: столько и больше просят VK, Telegram и Facebook */
const SOCIAL_WIDTH = 1200

/**
 * Вариант картинки для соцсетей: JPEG или PNG (их понимают все), иначе WebP. Самый узкий из тех,
 * что не уже 1200 px, а если таких нет — самый широкий
 */
export function socialImage(file: MediaFile) {
  const universal = file.variants.filter(
    (variant) => variant.format === 'jpeg' || variant.format === 'png',
  )
  const candidates = (
    universal.length > 0 ? universal : file.variants.filter((v) => v.format === 'webp')
  ).toSorted((a, b) => a.width - b.width)
  return candidates.find((variant) => variant.width >= SOCIAL_WIDTH) ?? candidates.at(-1)
}

const absolute = (site: SeoSite, path: string) =>
  site.url ? new URL(path, site.url).href : undefined

/** Размер карточки из заголовка: его рисует API (src/og) */
export const OG_CARD_SIZE = { width: 1200, height: 630 } as const

/** Файл карточки страницы в корне сайта: /og/<адрес>.png (главная — /og/index.png) */
export const ogCardPath = (slug: string) => `/og/${slug}.png`

/**
 * Нужна ли странице карточка из заголовка: своей картинки нет, картинки сайта нет, есть адрес
 * сайта (og:image — только абсолютный адрес), и это не страница 404. Сборка кладёт такие
 * карточки в /og/, а <head> ссылается на них
 */
export function needsOgCard(site: SeoSite, page: SeoPage) {
  return (
    site.url !== null &&
    page.slug !== NOT_FOUND_PAGE_SLUG &&
    !page.content.seo?.image &&
    !site.settings.ogImage
  )
}

/** Что нарисовано на карточке страницы: заголовок страницы, название и домен сайта, цвета темы */
export const pageOgCard = (site: SeoSite, page: SeoPage) =>
  ogCardOf({ title: page.title, siteName: site.name, siteUrl: site.url, theme: site.theme })

/**
 * Картинка страницы для соцсетей: своя, иначе сайта (вариант JPEG/PNG от 1200 px), иначе карточка
 * из заголовка. У карточки в адресе версия (?v=): заголовок поменяли — адрес другой, и соцсеть не
 * покажет закешированную старую
 */
function socialImageOf(site: SeoSite, page: SeoPage, media: MediaMap) {
  const mediaId = page.content.seo?.image?.mediaId ?? site.settings.ogImage
  const file = mediaId ? media[mediaId] : undefined
  const variant = file && socialImage(file)
  if (variant) {
    const url = absolute(site, variant.url)
    return url ? { url, width: variant.width, height: variant.height } : undefined
  }
  if (!needsOgCard(site, page)) return undefined
  const path = `${ogCardPath(page.slug)}?v=${ogCardVersion(pageOgCard(site, page))}`
  const url = absolute(site, path)
  return url ? { url, ...OG_CARD_SIZE } : undefined
}

const meta = (attribute: 'name' | 'property', key: string, content: string) =>
  `<meta ${attribute}="${key}" content="${escapeHtml(content)}">`

/** Иконки сайта (файлы в корне сайта, их кладёт сборка) — если иконка выбрана в «SEO» */
export const ICON_LINKS = [
  '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">',
  '<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<link rel="manifest" href="/manifest.webmanifest">',
]

/**
 * Без иконки — пустая иконка в самой странице. Иначе браузер на каждом заходе просит /favicon.ico,
 * которого в релизе нет, и каждый такой запрос идёт мимо статики в API (fallback) за 404
 */
export const NO_ICON_LINK = '<link rel="icon" href="data:,">'

/**
 * Теги <head> страницы после charset и viewport: title, описание, robots, canonical, Open Graph,
 * коды проверки прав, иконки. Пустое не выводится
 */
export function headTags({
  site,
  page,
  media,
}: {
  site: SeoSite
  page: SeoPage
  media: MediaMap
}): string[] {
  const { settings } = site
  const title = documentTitle(site, page)
  const description = pageDescription(site, page)
  const indexable = isIndexable(site, page)
  // Свой адрес или заданный в SEO страницы (путь — на домене сайта)
  const canonical = pageCanonicalUrl({ slug: page.slug, seo: page.content.seo }, site.url)
  const image = socialImageOf(site, page, media)

  const tags = [`<title>${escapeHtml(title)}</title>`]
  if (description) tags.push(meta('name', 'description', description))
  if (!indexable) {
    // Скрытый сайт — ни индексировать, ни ходить по ссылкам. Страница с noindex и 404 — только
    // не индексировать: ссылки с неё на остальной сайт поисковик пусть видит
    tags.push(meta('name', 'robots', settings.hideFromSearch ? 'noindex, nofollow' : 'noindex'))
  }
  // Canonical — у страниц, которые индексируются: у 404 адреса своего нет
  if (canonical && indexable) tags.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`)

  tags.push(
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', site.name),
    // SEO-заголовок, а без него — заголовок страницы: название сайта и так в og:site_name
    meta('property', 'og:title', page.content.seo?.title?.trim() || page.title),
    meta('property', 'og:locale', siteLanguages[settings.language].locale),
  )
  if (description) tags.push(meta('property', 'og:description', description))
  if (canonical && indexable) tags.push(meta('property', 'og:url', canonical))
  if (image) {
    tags.push(
      meta('property', 'og:image', image.url),
      meta('property', 'og:image:width', String(image.width)),
      meta('property', 'og:image:height', String(image.height)),
    )
  }
  tags.push(meta('name', 'twitter:card', image ? 'summary_large_image' : 'summary'))

  if (settings.verification.yandex) {
    tags.push(meta('name', 'yandex-verification', settings.verification.yandex))
  }
  if (settings.verification.google) {
    tags.push(meta('name', 'google-site-verification', settings.verification.google))
  }
  tags.push(...(settings.icon ? ICON_LINKS : [NO_ICON_LINK]))
  tags.push(meta('name', 'theme-color', site.theme.colors.background))
  return tags
}

/**
 * Счётчики аналитики в <head> — только в режиме «только уведомление» (cookie-уведомление).
 * В режиме согласия их здесь нет: их вставляет скрипт уведомления после согласия посетителя
 * (@averra/blocks/cookie-consent), без согласия на странице нет ни одного script счётчика.
 * Номера ещё раз проверяются схемой: в скрипт попадают только цифры (Метрика) и G-… (GA4).
 * Вебвизор Метрики выключен: он записывает, что посетитель вводит в форму. Запасного пикселя
 * в <noscript> нет: без JS посетитель не видит уведомление и не может согласиться
 */
export function analyticsHead(settings: StoredSiteSettings): string[] {
  const scripts: string[] = []
  const metrika = MetrikaId.parse(settings.analytics.metrika)
  const ga4 = Ga4Id.parse(settings.analytics.ga4)
  if (settings.cookies.mode !== 'notice') return scripts
  if (metrika) {
    scripts.push(
      `<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${metrika},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true});</script>`,
    )
  }
  if (ga4) {
    scripts.push(
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga4}"></script>`,
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","${ga4}");</script>`,
    )
  }
  return scripts
}

/**
 * JSON внутри <script>: «<» и разделители строк — escape-последовательностями, без выхода из тега
 */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029')

/**
 * Убирает пустые строки, пустые списки и вложенные объекты, где нет ничего, кроме @type:
 * в разметке только то, что заполнено
 */
function compact(value: Record<string, unknown>): Record<string, unknown> {
  const empty = (item: unknown) =>
    item === '' ||
    item === undefined ||
    (Array.isArray(item)
      ? item.length === 0
      : typeof item === 'object' &&
        item !== null &&
        Object.keys(item).every((key) => key === '@type'))
  return Object.fromEntries(Object.entries(value).filter(([, item]) => !empty(item)))
}

/**
 * Разметка организации (schema.org) на главной: <script type="application/ld+json"> — данные,
 * а не JS. Нет названия — разметки нет
 */
export function organizationJsonLd(site: SeoSite, media: MediaMap) {
  const org = site.settings.organization
  if (!org.name) return undefined
  const logoFile = org.logo ? media[org.logo] : undefined
  // SVG-логотип — как есть: формат логотипа Google берёт любой из тех, что понимает Google Картинки
  const logoVariant =
    logoFile &&
    (logoFile.variants.find((variant) => variant.format === 'svg') ?? socialImage(logoFile))
  const data = compact({
    '@context': 'https://schema.org',
    '@type': org.type,
    name: org.name,
    url: site.url ?? '',
    logo: (logoVariant && absolute(site, logoVariant.url)) ?? '',
    telephone: org.phone,
    email: org.email,
    address: compact({
      '@type': 'PostalAddress',
      streetAddress: org.address.street,
      addressLocality: org.address.city,
      addressRegion: org.address.region,
      postalCode: org.address.postalCode,
    }),
    sameAs: org.socials,
    taxID: org.inn,
    identifier: org.ogrn ? { '@type': 'PropertyValue', propertyID: 'ОГРН', value: org.ogrn } : '',
  })
  return `<script type="application/ld+json">${scriptJson(data)}</script>`
}

/**
 * robots.txt. Скрытый сайт закрыт целиком. Иначе закрыт только /api/ (приём форм), а Яндексу
 * сказано не различать адреса по параметру sent (адрес «спасибо» после формы)
 */
export function robotsTxt(site: SeoSite) {
  if (site.settings.hideFromSearch) return 'User-agent: *\nDisallow: /\n'
  const lines = [
    'User-agent: *',
    'Disallow: /api/',
    '',
    'User-agent: Yandex',
    'Disallow: /api/',
    'Clean-param: sent',
  ]
  const sitemap = absolute(site, '/sitemap.xml')
  if (sitemap) lines.push('', `Sitemap: ${sitemap}`)
  return `${lines.join('\n')}\n`
}

/**
 * sitemap.xml: индексируемые опубликованные страницы со своим каноническим адресом и датой
 * публикации. Скрытый сайт или сайт без адреса — пустой список (абсолютных адресов без домена нет)
 */
export function sitemapXml(site: SeoSite, pages: readonly SeoPage[]) {
  const entries = site.url
    ? pages
        // Только канонические адреса: страница, чей canonical указывает на другой, — не в карте
        .filter(
          (page) =>
            isIndexable(site, page) &&
            !canonicalElsewhere({ slug: page.slug, seo: page.content.seo }, site.url),
        )
        .toSorted((a, b) => (a.slug === MAIN_PAGE_SLUG ? -1 : b.slug === MAIN_PAGE_SLUG ? 1 : 0))
        .map((page) => {
          const loc = `<loc>${escapeHtml(absolute(site, canonicalPath(page.slug)) ?? '')}</loc>`
          const lastmod = page.publishedAt
            ? `<lastmod>${new Date(page.publishedAt).toISOString().slice(0, 10)}</lastmod>`
            : ''
          return `  <url>${loc}${lastmod}</url>`
        })
    : []
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')
}

/** Манифест сайта: название, цвета темы и PNG-иконки (их делает API из иконки сайта) */
export function webManifest(site: SeoSite) {
  return `${JSON.stringify(
    {
      name: site.name,
      short_name: site.name.length > 12 ? site.name.slice(0, 12).trim() : site.name,
      lang: site.settings.language,
      start_url: '/',
      display: 'browser',
      background_color: site.theme.colors.background,
      theme_color: site.theme.colors.background,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    null,
    2,
  )}\n`
}
