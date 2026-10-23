import {
  defaultNotFoundContent,
  type MediaMap,
  ogCardVersion,
  PageContent,
  readSiteSettings,
  type StoredSiteSettings,
} from '@averra/schema'
import { defaultTheme } from '@averra/tokens'
import { describe, expect, it } from 'vitest'
import {
  analyticsHead,
  canonicalPath,
  documentTitle,
  faqJsonLd,
  headTags,
  needsOgCard,
  organizationJsonLd,
  pageOgCard,
  robotsTxt,
  type SeoPage,
  type SeoSite,
  sitemapXml,
  socialImage,
  webManifest,
} from './seo'

// Что опубликованный сайт говорит поисковикам, соцсетям и аналитике — по настройкам «SEO»

const ogId = '11111111-1111-4111-8111-111111111111'
const logoId = '22222222-2222-4222-8222-222222222222'

const variant = (format: 'avif' | 'webp' | 'jpeg' | 'png', width: number, id = ogId) => ({
  format,
  width,
  height: Math.round(width / 2),
  url: `/media/${id}/${width}.${format === 'jpeg' ? 'jpg' : format}`,
})

const media: MediaMap = {
  [ogId]: {
    width: 1920,
    height: 960,
    variants: [480, 960, 1440, 1920].flatMap((width) => [
      variant('avif', width),
      variant('webp', width),
      variant('jpeg', width),
    ]),
  },
  [logoId]: { width: 480, height: 240, variants: [variant('webp', 480, logoId)] },
}

function site(
  settings: Record<string, unknown> = {},
  url: string | null = 'https://remont.example',
) {
  return {
    name: 'Ремонт & Ко',
    url,
    theme: defaultTheme,
    settings: readSiteSettings(settings),
  } satisfies SeoSite
}

const page = (slug: string, extra: Partial<SeoPage> = {}): SeoPage => ({
  slug,
  title: slug === 'index' ? 'Ремонт квартир — главная' : 'Цены',
  content: { blocks: [] },
  publishedAt: '2026-10-20T12:00:00.000Z',
  ...extra,
})

const head = (s: SeoSite, p: SeoPage) => headTags({ site: s, page: p, media }).join('\n')

describe('<head> страницы', () => {
  it('шаблон заголовка — у всех, кроме главной; спецсимволы экранируются', () => {
    const s = site({ titleTemplate: '%s — Ремонт & Ко' })
    expect(documentTitle(s, page('ceny'))).toBe('Цены — Ремонт & Ко')
    expect(documentTitle(s, page('index'))).toBe('Ремонт квартир — главная')
    expect(head(s, page('ceny'))).toContain('<title>Цены — Ремонт &amp; Ко</title>')
  })

  it('знак доллара в заголовке страницы не ломает шаблон: $& и $$ — как есть', () => {
    const s = site({ titleTemplate: '%s — Ремонт у Ивана' })
    const dollar = page('kurs', { title: 'Курс $& доллара и $$' })
    expect(documentTitle(s, dollar)).toBe('Курс $& доллара и $$ — Ремонт у Ивана')
    expect(head(s, dollar)).toContain('<title>Курс $&amp; доллара и $$ — Ремонт у Ивана</title>')
  })

  it('описание страницы главнее описания сайта; пустого нет вовсе', () => {
    const s = site({ description: 'Ремонт квартир в Твери' })
    expect(head(s, page('ceny'))).toContain(
      '<meta name="description" content="Ремонт квартир в Твери">',
    )
    const own = page('ceny', { content: { blocks: [], seo: { description: 'Цены "под ключ"' } } })
    expect(head(s, own)).toContain('<meta name="description" content="Цены &quot;под ключ&quot;">')
    expect(head(site(), page('ceny'))).not.toContain('name="description"')
  })

  it('canonical и og:url — адрес с косой чертой, как отдаёт сервер', () => {
    const html = head(site(), page('ceny'))
    expect(canonicalPath('index')).toBe('/')
    expect(html).toContain('<link rel="canonical" href="https://remont.example/ceny/">')
    expect(html).toContain('<meta property="og:url" content="https://remont.example/ceny/">')
    expect(head(site(), page('index'))).toContain('href="https://remont.example/"')
  })

  it('без адреса сайта нет canonical, og:url и og:image', () => {
    const html = head(site({ ogImage: ogId }, null), page('ceny'))
    expect(html).not.toContain('canonical')
    expect(html).not.toContain('og:url')
    expect(html).not.toContain('og:image')
  })

  it('Open Graph: язык, название, картинка JPEG около 1200 px абсолютным адресом', () => {
    const html = head(site({ ogImage: ogId, language: 'kk' }), page('ceny'))
    expect(html).toContain('<meta property="og:site_name" content="Ремонт &amp; Ко">')
    expect(html).toContain('<meta property="og:locale" content="kk_KZ">')
    expect(html).toContain(
      `<meta property="og:image" content="https://remont.example/media/${ogId}/1440.jpg">`,
    )
    expect(html).toContain('<meta property="og:image:width" content="1440">')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
  })

  it('картинка соцсетей без JPEG и PNG — WebP', () => {
    expect(socialImage(media[logoId] ?? { width: 1, height: 1, variants: [] })?.format).toBe('webp')
  })

  it('robots: скрытый сайт — noindex, nofollow; noindex страницы и 404 — noindex без canonical', () => {
    const hidden = head(site({ hideFromSearch: true }), page('ceny'))
    expect(hidden).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(hidden).not.toContain('canonical')
    expect(hidden).not.toContain('og:url')

    // Скрытой странице не нужен ни canonical, ни og:url — даже заданный руками
    const noindex = page('ceny', {
      content: { blocks: [], seo: { noindex: true, canonical: '/uslugi/' } },
    })
    expect(head(site(), noindex)).toContain('<meta name="robots" content="noindex">')
    expect(head(site(), noindex)).not.toContain('canonical')
    expect(head(site(), noindex)).not.toContain('og:url')
    const notFound = page('404', { content: defaultNotFoundContent() })
    expect(head(site(), notFound)).toContain('<meta name="robots" content="noindex">')
    expect(head(site(), notFound)).not.toContain('canonical')
    expect(head(site(), notFound)).not.toContain('og:url')

    expect(head(site(), page('ceny'))).not.toContain('name="robots"')
  })

  it('SEO-заголовок страницы — в title и og:title целиком, без шаблона сайта', () => {
    const s = site({ titleTemplate: '%s — Ремонт & Ко' })
    const own = page('ceny', {
      content: { blocks: [], seo: { title: 'Цены на ремонт квартир в Твери за м²' } },
    })
    const html = head(s, own)
    expect(html).toContain('<title>Цены на ремонт квартир в Твери за м²</title>')
    expect(html).toContain(
      '<meta property="og:title" content="Цены на ремонт квартир в Твери за м²">',
    )
    // Без SEO-заголовка og:title — заголовок страницы: название сайта и так в og:site_name
    expect(head(s, page('ceny'))).toContain('<meta property="og:title" content="Цены">')
  })

  it('картинка страницы главнее картинки сайта', () => {
    const own = page('ceny', { content: { blocks: [], seo: { image: { mediaId: logoId } } } })
    const html = head(site({ ogImage: ogId }), own)
    expect(html).toContain(
      `<meta property="og:image" content="https://remont.example/media/${logoId}/480.webp">`,
    )
    expect(html).not.toContain(ogId)
  })

  it('ни своей картинки, ни картинки сайта — карточка из заголовка с версией в адресе', () => {
    const s = site()
    expect(needsOgCard(s, page('ceny'))).toBe(true)
    const version = ogCardVersion(pageOgCard(s, page('ceny')))
    const html = head(s, page('ceny'))
    expect(html).toContain(
      `<meta property="og:image" content="https://remont.example/og/ceny.png?v=${version}">`,
    )
    expect(html).toContain('<meta property="og:image:width" content="1200">')
    expect(html).toContain('<meta property="og:image:height" content="630">')
    // Заголовок поменяли — адрес другой
    expect(head(s, page('ceny', { title: 'Прайс' }))).not.toContain(version)
    // Карточки нет у 404, при картинке сайта и без адреса сайта
    expect(needsOgCard(s, page('404', { content: defaultNotFoundContent() }))).toBe(false)
    expect(needsOgCard(site({ ogImage: ogId }), page('ceny'))).toBe(false)
    expect(needsOgCard(site({}, null), page('ceny'))).toBe(false)
  })

  it('canonical страницы: путь — на домене сайта, https — как есть, og:url тот же', () => {
    const path = page('akciya-2', { content: { blocks: [], seo: { canonical: '/akciya/' } } })
    expect(head(site(), path)).toContain(
      '<link rel="canonical" href="https://remont.example/akciya/">',
    )
    expect(head(site(), path)).toContain(
      '<meta property="og:url" content="https://remont.example/akciya/">',
    )
    const other = page('ceny', {
      content: { blocks: [], seo: { canonical: 'https://partner.example/ceny?a=1&b=2' } },
    })
    expect(head(site(), other)).toContain(
      '<link rel="canonical" href="https://partner.example/ceny?a=1&amp;b=2">',
    )
    // noindex главнее: у скрытой страницы canonical нет
    const hidden = page('ceny', {
      content: { blocks: [], seo: { canonical: '/a/', noindex: true } },
    })
    expect(head(site(), hidden)).not.toContain('canonical')
  })

  it('коды проверки прав и иконки — только когда заданы', () => {
    const html = head(
      site({ verification: { yandex: '0a1b2c3d4e5f6a7b', google: 'abc_DEF-123' }, icon: ogId }),
      page('index'),
    )
    expect(html).toContain('<meta name="yandex-verification" content="0a1b2c3d4e5f6a7b">')
    expect(html).toContain('<meta name="google-site-verification" content="abc_DEF-123">')
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">')

    const plain = head(site(), page('index'))
    expect(plain).not.toContain('verification')
    expect(plain).not.toContain('favicon')
    // Без иконки браузер не просит /favicon.ico: его нет в релизе, запрос ушёл бы в API
    expect(plain).toContain('<link rel="icon" href="data:,">')
    expect(html).not.toContain('data:,')
  })
})

describe('аналитика', () => {
  const counters = { metrika: '98765432', ga4: 'G-ABC123DEF4' }
  const notice = { mode: 'notice', look: 'bar', text: '', policyPage: '' } as const

  it('без счётчиков на сайте нет ни одного скрипта', () => {
    const s = site().settings
    expect(analyticsHead(s)).toEqual([])
    expect(head(site(), page('index'))).not.toContain('<script')
  })

  it('режим согласия (по умолчанию): в HTML нет скриптов счётчиков — их грузит уведомление', () => {
    const s = site({ analytics: counters }).settings
    expect(s.cookies.mode).toBe('consent')
    expect(analyticsHead(s)).toEqual([])
  })

  it('режим уведомления: Метрика и GA4 — только с проверенными номерами', () => {
    const s = site({ analytics: counters, cookies: notice }).settings
    const scripts = analyticsHead(s).join('\n')
    expect(scripts).toContain('ym(98765432,"init"')
    expect(scripts).toContain('https://mc.yandex.ru/metrika/tag.js')
    expect(scripts).not.toContain('webvisor')
    expect(scripts).toContain('https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4')
    expect(scripts).toContain('gtag("config","G-ABC123DEF4")')
    expect(scripts).not.toContain('noscript')
  })

  it('подложенный в обход схемы номер не попадает в скрипт', () => {
    const forged = {
      ...site().settings,
      analytics: { metrika: '1);alert(1);(', ga4: '' },
    } satisfies StoredSiteSettings
    expect(() => analyticsHead(forged)).toThrow()
  })
})

describe('JSON-LD организации', () => {
  it('нет названия — нет разметки', () => {
    expect(organizationJsonLd(site(), media)).toBeUndefined()
  })

  it('только заполненное, логотип абсолютным адресом, реквизиты', () => {
    const tag = organizationJsonLd(
      site({
        organization: {
          type: 'LocalBusiness',
          name: 'ООО «Ремонт»',
          logo: logoId,
          phone: '+7 900 123-45-67',
          address: { city: 'Тверь' },
          socials: ['https://vk.com/remont'],
          inn: '6950000000',
          ogrn: '1026900000000',
        },
      }),
      media,
    )
    const json = JSON.parse(
      tag?.replace('<script type="application/ld+json">', '').replace('</script>', '') ?? '',
    )
    expect(json).toEqual({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: 'ООО «Ремонт»',
      url: 'https://remont.example',
      logo: `https://remont.example/media/${logoId}/480.webp`,
      telephone: '+7 900 123-45-67',
      address: { '@type': 'PostalAddress', addressLocality: 'Тверь' },
      sameAs: ['https://vk.com/remont'],
      taxID: '6950000000',
      identifier: { '@type': 'PropertyValue', propertyID: 'ОГРН', value: '1026900000000' },
    })
  })

  it('SVG-логотип — файлом image.svg', () => {
    const svgId = '33333333-3333-4333-8333-333333333333'
    const svgMedia: MediaMap = {
      [svgId]: {
        width: 120,
        height: 40,
        variants: [{ format: 'svg', width: 120, height: 40, url: `/media/${svgId}/image.svg` }],
      },
    }
    const tag = organizationJsonLd(
      site({ organization: { name: 'ООО «Ремонт»', logo: svgId } }),
      svgMedia,
    )
    expect(tag).toContain(`"logo":"https://remont.example/media/${svgId}/image.svg"`)
  })

  it('название с </script> не закрывает тег раньше времени', () => {
    const tag = organizationJsonLd(site({ organization: { name: 'Ремонт</script><b>' } }), media)
    expect(tag?.match(/<\/script>/g)).toHaveLength(1)
    expect(tag).toContain('\\u003c/script\\u003e')
  })
})

describe('robots.txt и sitemap.xml', () => {
  it('открытый сайт: закрыт только /api/, Яндексу — Clean-param, ссылка на sitemap', () => {
    expect(robotsTxt(site())).toBe(
      [
        'User-agent: *',
        'Disallow: /api/',
        '',
        'User-agent: Yandex',
        'Disallow: /api/',
        'Clean-param: sent',
        '',
        'Sitemap: https://remont.example/sitemap.xml',
        '',
      ].join('\n'),
    )
    expect(robotsTxt(site({}, null))).not.toContain('Sitemap')
  })

  it('скрытый сайт закрыт целиком и без sitemap', () => {
    expect(robotsTxt(site({ hideFromSearch: true }))).toBe('User-agent: *\nDisallow: /\n')
    expect(sitemapXml(site({ hideFromSearch: true }), [page('index')])).not.toContain('<url>')
  })

  it('sitemap — главная первой, без noindex и 404, с датой публикации', () => {
    const xml = sitemapXml(site(), [
      page('ceny'),
      page('index'),
      page('404'),
      page('skryta', { content: { blocks: [], seo: { noindex: true } } }),
      // canonical на другую страницу — в карте только канонические адреса
      page('kopiya', { content: { blocks: [], seo: { canonical: '/ceny/' } } }),
      page('svoya', {
        content: { blocks: [], seo: { canonical: 'https://remont.example/svoya/' } },
      }),
      // Служебные адреса из старой базы: /api/ закрыт в robots.txt, /500/ на сервере нет
      page('api'),
      page('500'),
    ])
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url><loc>https://remont.example/</loc><lastmod>2026-10-20</lastmod></url>',
        '  <url><loc>https://remont.example/ceny/</loc><lastmod>2026-10-20</lastmod></url>',
        '  <url><loc>https://remont.example/svoya/</loc><lastmod>2026-10-20</lastmod></url>',
        '</urlset>',
        '',
      ].join('\n'),
    )
  })

  it('без адреса сайта sitemap пустой: относительных адресов в нём не бывает', () => {
    expect(sitemapXml(site({}, null), [page('index')])).not.toContain('<url>')
  })
})

describe('манифест', () => {
  it('название, язык, цвета темы и PNG-иконки', () => {
    expect(JSON.parse(webManifest(site({ language: 'en' })))).toMatchObject({
      name: 'Ремонт & Ко',
      lang: 'en',
      start_url: '/',
      background_color: defaultTheme.colors.background,
      icons: [
        { src: '/icon-192.png', sizes: '192x192' },
        { src: '/icon-512.png', sizes: '512x512' },
      ],
    })
  })
})

describe('JSON-LD вопросов и ответов', () => {
  const faq = (id: string, items: { question: string; answer: string }[]) => ({
    id,
    type: 'faq',
    props: { items },
  })
  const withFaq = (slug = 'ceny', seo?: { noindex: boolean }) =>
    page(slug, {
      content: PageContent.parse({
        blocks: [
          faq('faq-1', [
            { question: 'Сколько стоит замер?', answer: 'Бесплатно.\n\nВ удобное время.' },
          ]),
          { id: 'cta', type: 'cta', props: { title: 'Ну?', button: { label: 'Да', href: '#a' } } },
          faq('faq-2', [{ question: 'Есть гарантия?', answer: 'Три <года> & больше' }]),
        ],
        ...(seo && { seo }),
      }),
    })
  const parse = (tag: string | undefined) =>
    JSON.parse(
      tag?.replace('<script type="application/ld+json">', '').replace('</script>', '') ?? '',
    )

  it('одна разметка FAQPage на страницу: вопросы всех блоков по порядку', () => {
    const tag = faqJsonLd(site(), withFaq())
    expect(parse(tag)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Сколько стоит замер?',
          acceptedAnswer: { '@type': 'Answer', text: 'Бесплатно.\n\nВ удобное время.' },
        },
        {
          '@type': 'Question',
          name: 'Есть гарантия?',
          acceptedAnswer: { '@type': 'Answer', text: 'Три <года> & больше' },
        },
      ],
    })
    // Текст из блока не выходит из тега script
    expect(tag).not.toContain('<года>')
    expect(tag?.match(/<script/g)).toHaveLength(1)
  })

  it('без вопросов, вне индекса и на странице 404 разметки нет', () => {
    expect(faqJsonLd(site(), page('ceny'))).toBeUndefined()
    expect(faqJsonLd(site(), withFaq('ceny', { noindex: true }))).toBeUndefined()
    expect(faqJsonLd(site({ hideFromSearch: true }), withFaq())).toBeUndefined()
    expect(faqJsonLd(site(), withFaq('404'))).toBeUndefined()
  })
})
