import {
  applyTitleTemplate,
  Ga4Id,
  MAIN_PAGE_SLUG,
  type MediaFile,
  type MediaMap,
  MetrikaId,
  NOT_FOUND_PAGE_SLUG,
  type PageContent,
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

/**
 * Адрес страницы на собранном сайте: главная — /, остальные — /адрес/ с косой чертой. Так их
 * отдаёт Caddy (папка с index.html), и такой адрес — канонический
 */
export const canonicalPath = (slug: string) => (slug === MAIN_PAGE_SLUG ? '/' : `/${slug}/`)

/** Заголовок во вкладке: по шаблону сайта, а у главной — как есть (его пишут целиком) */
export function documentTitle(site: SeoSite, page: SeoPage) {
  return page.slug === MAIN_PAGE_SLUG
    ? page.title
    : applyTitleTemplate(site.settings.titleTemplate, page.title)
}

/**
 * Попадает ли страница в индекс: сайт не скрыт, у страницы нет noindex, и это не страница 404
 * (её показывают на чужих адресах, в поиске ей не место)
 */
export function isIndexable(site: SeoSite, page: SeoPage) {
  return (
    !site.settings.hideFromSearch &&
    page.content.seo?.noindex !== true &&
    page.slug !== NOT_FOUND_PAGE_SLUG
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
  const canonical = absolute(site, canonicalPath(page.slug))
  const ogFile = settings.ogImage ? media[settings.ogImage] : undefined
  const ogVariant = ogFile && socialImage(ogFile)
  const ogImage = ogVariant && absolute(site, ogVariant.url)

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
    meta('property', 'og:title', page.title),
    meta('property', 'og:locale', siteLanguages[settings.language].locale),
  )
  if (description) tags.push(meta('property', 'og:description', description))
  if (canonical && indexable) tags.push(meta('property', 'og:url', canonical))
  if (ogImage && ogVariant) {
    tags.push(
      meta('property', 'og:image', ogImage),
      meta('property', 'og:image:width', String(ogVariant.width)),
      meta('property', 'og:image:height', String(ogVariant.height)),
    )
  }
  tags.push(meta('name', 'twitter:card', ogImage ? 'summary_large_image' : 'summary'))

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
 * Счётчики аналитики в <head>: единственный JS на сайте, и только если владелец задал номер.
 * Номера ещё раз проверяются схемой: в скрипт попадают только цифры (Метрика) и G-… (GA4).
 * Вебвизор Метрики выключен: он записывает, что посетитель вводит в форму
 */
export function analyticsHead(settings: StoredSiteSettings): string[] {
  const scripts: string[] = []
  const metrika = MetrikaId.parse(settings.analytics.metrika)
  if (metrika) {
    scripts.push(
      `<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${metrika},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true});</script>`,
    )
  }
  const ga4 = Ga4Id.parse(settings.analytics.ga4)
  if (ga4) {
    scripts.push(
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga4}"></script>`,
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","${ga4}");</script>`,
    )
  }
  return scripts
}

/** Запасной пиксель Метрики для браузеров без JS — в начале <body> */
export function analyticsBody(settings: StoredSiteSettings): string[] {
  const metrika = MetrikaId.parse(settings.analytics.metrika)
  return metrika
    ? [
        `<noscript><div><img src="https://mc.yandex.ru/watch/${metrika}" style="position:absolute;left:-9999px" alt=""></div></noscript>`,
      ]
    : []
}

/** JSON внутри <script>: «<» и разделители строк — escape-последовательностями, без выхода из тега */
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
  const logoVariant = logoFile && socialImage(logoFile)
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
 * sitemap.xml: индексируемые опубликованные страницы с датой публикации. Скрытый сайт или сайт
 * без адреса — пустой список (абсолютных адресов без домена не бывает)
 */
export function sitemapXml(site: SeoSite, pages: readonly SeoPage[]) {
  const entries = site.url
    ? pages
        .filter((page) => isIndexable(site, page))
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
