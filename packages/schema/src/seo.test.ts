import { describe, expect, it } from 'vitest'
import { PageContent, PageSeo } from './page'
import {
  canonicalElsewhere,
  isWeakAlt,
  mainHeadingBlock,
  ogCardOf,
  ogCardVersion,
  pageCanonicalUrl,
  pageDocumentTitle,
  pageSeoChecks,
  type SeoBlock,
  type SeoCheckPage,
  type SiteSeo,
  seoAdvice,
} from './seo'
import { Theme } from './theme'

const mediaId = '11111111-1111-4111-8111-111111111111'

const site: SiteSeo = {
  titleTemplate: '%s — Ремонт у Ивана',
  description: '',
  ogImage: null,
  url: 'https://remont.example',
  hideFromSearch: false,
}

const hero = (title = 'Ремонт квартир под ключ', image?: { mediaId: string; alt: string }) => ({
  id: 'hero',
  type: 'hero',
  props: { title, ...(image ? { variant: 'split', image } : {}) },
})
const cta = { id: 'cta', type: 'cta', props: { title: 'Готовы начать?' } }

const page = (patch: Partial<SeoCheckPage> = {}): SeoCheckPage => ({
  slug: 'ceny',
  title: 'Цены',
  blocks: [hero()],
  ...patch,
})

const check = (id: string, p: SeoCheckPage = page(), s: SiteSeo = site) =>
  pageSeoChecks(p, s).find((item) => item.id === id)

describe('PageSeo', () => {
  it('принимает все поля и не требует ни одного', () => {
    const seo = {
      title: 'Цены на ремонт квартир в Твери — Ремонт у Ивана',
      description: 'Цены',
      image: { mediaId },
      canonical: '/uslugi/',
      noindex: true,
    }
    expect(PageSeo.parse(seo)).toEqual(seo)
    expect(PageSeo.parse({})).toEqual({})
    expect(PageContent.parse({ blocks: [], seo: { image: { mediaId } } }).seo).toEqual({
      image: { mediaId },
    })
  })

  it.each([
    '/uslugi/',
    '/цены',
    '/a?utm=1',
    'https://remont.example/ceny/',
    'https://пример.рф/цены',
    '',
  ])('canonical «%s» — можно', (canonical) => {
    expect(PageSeo.safeParse({ canonical }).success).toBe(true)
  })

  it.each([
    ['http', 'http://remont.example/'],
    ['протокол-относительный', '//evil.example/'],
    ['обратная черта', '/\\evil.example'],
    ['javascript', 'javascript:alert(1)'],
    ['без косой черты', 'ceny'],
    ['пробел', '/ce ny/'],
    ['якорь', '/ceny/#top'],
    ['кавычка в пути', '/ceny"/'],
    ['угловые скобки', '/ceny/<b>'],
    ['кавычка в ссылке', 'https://remont.example/a"b'],
    ['угловые скобки в ссылке', 'https://remont.example/</title>'],
    ['управляющий символ в ссылке', 'https://remont.example/\u0000'],
    ['обратная черта в ссылке', 'https://remont.example/a\\b'],
  ])('canonical: %s — нельзя', (_, canonical) => {
    const result = PageSeo.safeParse({ canonical })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/Путь на этом сайте/)
  })

  it('SEO-заголовок не длиннее 120, картинка — только id из медиатеки, лишнего нет', () => {
    expect(PageSeo.safeParse({ title: 'а'.repeat(120) }).success).toBe(true)
    expect(PageSeo.safeParse({ title: 'а'.repeat(121) }).success).toBe(false)
    expect(PageSeo.safeParse({ image: { mediaId: 'logo.png' } }).success).toBe(false)
    expect(PageSeo.safeParse({ image: { mediaId, alt: 'Кухня' } }).success).toBe(false)
    expect(PageSeo.safeParse({ robots: 'none' }).success).toBe(false)
  })
})

describe('заголовок во вкладке', () => {
  it('SEO-заголовок — целиком, без шаблона сайта', () => {
    const seo = { title: '  Цены на ремонт в Твери ' }
    expect(pageDocumentTitle({ slug: 'ceny', title: 'Цены', seo }, site.titleTemplate)).toBe(
      'Цены на ремонт в Твери',
    )
  })

  it('без него — заголовок по шаблону, у главной — как есть', () => {
    expect(
      pageDocumentTitle({ slug: 'ceny', title: 'Цены', seo: { title: ' ' } }, '%s — Ива'),
    ).toBe('Цены — Ива')
    expect(pageDocumentTitle({ slug: 'index', title: 'Ремонт у Ивана' }, '%s — Ива')).toBe(
      'Ремонт у Ивана',
    )
    expect(pageDocumentTitle({ slug: 'ceny', title: 'Цены' }, '')).toBe('Цены')
  })
})

describe('canonical', () => {
  it('свой адрес по умолчанию, путь — на домене сайта, https — как есть', () => {
    expect(pageCanonicalUrl({ slug: 'ceny' }, site.url)).toBe('https://remont.example/ceny/')
    expect(pageCanonicalUrl({ slug: 'index' }, site.url)).toBe('https://remont.example/')
    expect(pageCanonicalUrl({ slug: 'ceny', seo: { canonical: '/uslugi/' } }, site.url)).toBe(
      'https://remont.example/uslugi/',
    )
    expect(
      pageCanonicalUrl({ slug: 'ceny', seo: { canonical: 'https://other.example/a' } }, null),
    ).toBe('https://other.example/a')
    expect(pageCanonicalUrl({ slug: 'ceny', seo: { canonical: '/uslugi/' } }, null)).toBeUndefined()
  })

  it.each([
    '/ceny',
    '/ceny/?utm=1',
    'https://REMONT.example/ceny?utm=1',
    'https://remont.example/ceny',
  ])('«%s» — эта же страница: выводится её канонический адрес, как в карте сайта', (canonical) => {
    expect(pageCanonicalUrl({ slug: 'ceny', seo: { canonical } }, site.url)).toBe(
      'https://remont.example/ceny/',
    )
  })

  it.each([
    ['/uslugi', 'https://remont.example/uslugi/'],
    ['/uslugi?utm=1#tseny', 'https://remont.example/uslugi/?utm=1#tseny'],
    ['https://remont.example/uslugi', 'https://remont.example/uslugi/'],
    ['https://Remont.example/uslugi/', 'https://remont.example/uslugi/'],
    ['/uslugi/', 'https://remont.example/uslugi/'],
    ['/ceny-i-uslugi/price.pdf', 'https://remont.example/ceny-i-uslugi/price.pdf'],
    ['/цены', 'https://remont.example/%D1%86%D0%B5%D0%BD%D1%8B/'],
    ['https://other.example/uslugi', 'https://other.example/uslugi'],
  ])('другая страница своего сайта «%s» — как в карте сайта: %s', (canonical, url) => {
    expect(pageCanonicalUrl({ slug: 'ceny', seo: { canonical } }, site.url)).toBe(url)
  })

  it.each([
    [undefined, false],
    ['/ceny/', false],
    ['/ceny', false],
    ['https://remont.example/ceny/', false],
    ['https://REMONT.example/ceny?utm=1', false],
    ['/uslugi/', true],
    ['https://remont.example/', true],
    ['https://remont.example.evil/ceny/', true],
    ['https://other.example/ceny/', true],
  ])('«%s» указывает на другой адрес: %s', (canonical, elsewhere) => {
    expect(canonicalElsewhere({ slug: 'ceny', seo: { canonical } }, site.url)).toBe(elsewhere)
  })
})

describe('h1', () => {
  it('получает первый «Первый экран», даже если он не первый блок', () => {
    const blocks: SeoBlock[] = [cta, hero('Первый'), { ...hero('Второй'), id: 'hero-2' }]
    expect(mainHeadingBlock(blocks)?.id).toBe('hero')
    expect(mainHeadingBlock([cta])).toBeUndefined()
  })

  it('нет «Первого экрана» — важно, он не первый — стоит поправить, первый — хорошо', () => {
    expect(check('h1', page({ blocks: [cta] }))?.level).toBe('problem')
    expect(check('h1', page({ blocks: [cta, hero()] }))?.level).toBe('warning')
    expect(check('h1')).toEqual({
      id: 'h1',
      level: 'good',
      title: 'Главный заголовок (h1) один: «Ремонт квартир под ключ»',
    })
  })
})

describe('проверки: длина заголовка', () => {
  // Заголовок страницы без шаблона: длина — ровно его
  const titled = (length: number) =>
    check('title', page({ title: 'а'.repeat(length) }), { ...site, titleTemplate: '' })

  it.each([
    [29, 'warning', /короткий: 29 символов/],
    [30, 'good', /30 символов — в самый раз/],
    [60, 'good', /60 символов — в самый раз/],
    [61, 'warning', /61 символ: Google может обрезать/],
    [70, 'warning', /Google может обрезать/],
    [71, 'warning', /71 символ: в поиске обрежется/],
  ] as const)('%i символов — %s', (length, level, title) => {
    const result = titled(length)
    expect(result?.level).toBe(level)
    expect(result?.title).toMatch(title)
  })

  it('считается заголовок с шаблоном сайта, а SEO-заголовок — как есть', () => {
    // «Цены — Ремонт у Ивана» — 21 символ
    expect(check('title')?.title).toMatch(/: 21 символ$/)
    const own = check('title', page({ seo: { title: 'Цены на ремонт квартир в Твери за м²' } }))
    expect(own?.level).toBe('good')
    expect(check('title', page({ title: 'а' }))?.advice).toMatch(/задайте SEO-заголовок/)
  })
})

describe('проверки: описание', () => {
  const described = (length: number) =>
    check('description', page({ seo: { description: 'а'.repeat(length) } }))

  it.each([
    [69, 'warning', /короткое: 69 символов/],
    [70, 'good', /70 символов — в самый раз/],
    [160, 'good', /160 символов/],
    [161, 'warning', /161 символ: в поиске обрежется/],
  ] as const)('%i символов — %s', (length, level, title) => {
    const result = described(length)
    expect(result?.level).toBe(level)
    expect(result?.title).toMatch(title)
  })

  it('нет ни своего, ни сайта — важно; только сайта — стоит поправить', () => {
    expect(check('description')?.level).toBe('problem')
    const fromSite = check('description', page(), { ...site, description: 'Ремонт в Твери' })
    expect(fromSite?.level).toBe('warning')
    expect(fromSite?.title).toBe('Своего описания нет — берётся описание сайта')
    expect(check('description', page({ seo: { description: '   ' } }))?.level).toBe('problem')
  })
})

describe('проверки: картинки', () => {
  const withAlt = (alt: string) =>
    check('alt', page({ blocks: [hero('Ремонт', { mediaId, alt })] }))

  it('нет картинок — нет и проверки', () => {
    expect(check('alt')).toBeUndefined()
  })

  it('пустой alt — важно, с названием блока', () => {
    const result = withAlt('  ')
    expect(result?.level).toBe('problem')
    expect(result?.title).toBe('Картинка без описания (alt): «Первый экран»')
  })

  it.each(['IMG_2041.jpg', 'DSC0001', 'фото', 'Картинка', 'image', 'photo-3', 'logo.PNG'])(
    'alt «%s» ничего не говорит',
    (alt) => {
      expect(isWeakAlt(alt)).toBe(true)
      expect(withAlt(alt)?.level).toBe('warning')
    },
  )

  it('осмысленный alt — хорошо', () => {
    expect(isWeakAlt('Кухня после ремонта, белые фасады')).toBe(false)
    expect(isWeakAlt('Фото кухни после ремонта')).toBe(false)
    expect(withAlt('Кухня после ремонта')?.level).toBe('good')
  })
})

describe('проверки: адрес, индексация, canonical, картинка для соцсетей', () => {
  it('адрес: 40 символов — хорошо, 41 — длинный; у главной не проверяется', () => {
    expect(check('slug', page({ slug: 'a'.repeat(40) }))?.level).toBe('good')
    expect(check('slug', page({ slug: 'ceny' }))?.title).toBe('Адрес короткий: /ceny')
    expect(check('slug', page({ slug: 'a'.repeat(41) }))?.title).toBe('Адрес длинный: 41 символ')
    expect(check('slug', page({ slug: 'index' }))).toBeUndefined()
  })

  it('noindex и скрытый сайт — видны советом, открытая страница — хорошо', () => {
    expect(check('noindex')?.level).toBe('good')
    expect(check('noindex', page({ seo: { noindex: true } }))?.level).toBe('warning')
    const hidden = { ...site, hideFromSearch: true }
    expect(check('site-hidden', page(), hidden)?.level).toBe('warning')
    expect(check('noindex', page(), hidden)).toBeUndefined()
    expect(check('site-hidden')).toBeUndefined()
  })

  it('canonical на другой адрес — совет; свой адрес — ничего', () => {
    const other = check('canonical', page({ seo: { canonical: '/uslugi/' } }))
    expect(other?.level).toBe('warning')
    expect(other?.title).toBe('Основной адрес — другой: /uslugi/')
    expect(check('canonical', page({ seo: { canonical: '/ceny/' } }))).toBeUndefined()
  })

  it('картинка: своя, сайта, карточка из заголовка; без адреса сайта — совет', () => {
    expect(check('image', page({ seo: { image: { mediaId } } }))?.title).toMatch(/своя/)
    expect(check('image', page(), { ...site, ogImage: mediaId })?.title).toMatch(/сайта/)
    expect(check('image')?.title).toMatch(/карточка из заголовка/)
    expect(check('image', page(), { ...site, url: null })?.level).toBe('warning')
  })

  it('у страницы 404 — только заголовок, h1 и картинки', () => {
    const ids = pageSeoChecks(page({ slug: '404', seo: { noindex: true } }), site).map(
      (item) => item.id,
    )
    expect(ids).toEqual(['title', 'h1'])
  })

  it('у страницы 404 длина заголовка не проверяется: в поиск она не попадает', () => {
    const short = page({ slug: '404', title: 'Страница не найдена', seo: { noindex: true } })
    expect(check('title', short, { ...site, titleTemplate: '' })).toEqual({
      id: 'title',
      level: 'good',
      title: 'Заголовок во вкладке: «Страница не найдена»',
    })
  })

  it('советы — только warning и problem, ни одна проверка не про запрет', () => {
    const checks = pageSeoChecks(page({ blocks: [cta], seo: { noindex: true } }), site)
    expect(seoAdvice(checks).map((item) => item.level)).not.toContain('good')
    expect(seoAdvice(checks).length).toBeGreaterThan(0)
  })
})

describe('карточка для соцсетей', () => {
  const theme = Theme.parse({
    colors: {
      background: '#ffffff',
      surface: '#f5f5f5',
      text: '#111111',
      muted: '#666666',
      accent: '#2f5bea',
      onAccent: '#ffffff',
    },
    fonts: { heading: 'system', body: 'system' },
  })
  const card = (title: string) =>
    ogCardOf({ title, siteName: 'Ремонт у Ивана', siteUrl: 'https://remont.example', theme })

  it('домен без https://, только цвета, которые рисуются', () => {
    expect(card(' Цены ')).toEqual({
      title: 'Цены',
      siteName: 'Ремонт у Ивана',
      domain: 'remont.example',
      colors: { background: '#ffffff', text: '#111111', muted: '#666666', accent: '#2f5bea' },
    })
  })

  it('версия стабильна и меняется вместе с заголовком', () => {
    expect(ogCardVersion(card('Цены'))).toBe(ogCardVersion(card('Цены')))
    expect(ogCardVersion(card('Цены'))).toMatch(/^[0-9a-f]{8}$/)
    expect(ogCardVersion(card('Цены'))).not.toBe(ogCardVersion(card('Цены!')))
  })
})
