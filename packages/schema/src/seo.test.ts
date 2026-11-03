import { describe, expect, it } from 'vitest'
import { blocks } from './blocks'
import { type BlockSchemaNode, blockPropsSchema } from './media-svg'
import { PageContent, PageSeo } from './page'
import {
  canonicalElsewhere,
  customH1Types,
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
  templateHasH1,
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

const check = (
  id: string,
  p: SeoCheckPage = page(),
  s: SiteSeo = site,
  options: { ownH1?: ReadonlySet<string> } = {},
) => pageSeoChecks(p, s, options).find((item) => item.id === id)

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

describe('h1 в своих блоках', () => {
  const mine = { id: 'top', type: 'custom:le-hero', props: { title: 'Привет, я *Лера*' } }
  const ownH1 = customH1Types([
    { key: 'le-hero', template: '<section><h1>{{ title }}</h1></section>' },
    { key: 'plain', template: '<h2>{{ title }}</h2>' },
  ])

  it('h1 в шаблоне: литеральный <h1 вне комментариев', () => {
    expect(templateHasH1('<h1 class="a">{{ t }}</h1>')).toBe(true)
    expect(templateHasH1('<H1>x</H1>')).toBe(true)
    expect(templateHasH1('<h2>x</h2><h10>')).toBe(false)
    expect(templateHasH1('{% comment %}<h1>x</h1>{% endcomment %}<h2>x</h2>')).toBe(false)
    expect(templateHasH1('<!-- <h1> --><p>x</p>')).toBe(false)
    expect([...ownH1]).toEqual(['custom:le-hero'])
  })

  it('свой блок с h1 — главный заголовок: не «нет h1», а хорошо, текст без звёздочек', () => {
    expect(mainHeadingBlock([cta, mine], ownH1)?.id).toBe('top')
    expect(check('h1', page({ blocks: [mine] }), site, { ownH1 })).toEqual({
      id: 'h1',
      level: 'good',
      title: 'Главный заголовок (h1) один: «Привет, я Лера»',
    })
    expect(check('h1', page({ blocks: [cta, mine] }), site, { ownH1 })?.level).toBe('warning')
  })

  it('без определений (MCP не получил блоки) совет прежний — нет h1', () => {
    expect(check('h1', page({ blocks: [mine] }))?.level).toBe('problem')
  })

  it('два h1 — «Первый экран» и свой блок, или два своих — предупреждение', () => {
    const second = { id: 'second', type: 'custom:le-hero', props: { title: 'Ещё' } }
    expect(check('h1', page({ blocks: [mine, hero()] }), site, { ownH1 })?.level).toBe('good')
    expect(check('h1', page({ blocks: [hero(), mine] }), site, { ownH1 })).toMatchObject({
      level: 'warning',
      title: 'На странице несколько главных заголовков (h1): 2',
    })
    expect(check('h1', page({ blocks: [mine, second] }), site, { ownH1 })?.level).toBe('warning')
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

  it('логотип «Клиентов» без своего alt — не беда: его alt — название клиента', () => {
    const clients = {
      id: 'clients',
      type: 'clients',
      props: { items: [{ name: 'ООО «Стройка»', logo: { mediaId } }, { name: 'Бюро' }] },
    }
    expect(check('alt', page({ blocks: [clients] }))).toBeUndefined()
    const photo = {
      id: 'team',
      type: 'team',
      props: { members: [{ name: 'Иван', photo: { mediaId } }] },
    }
    expect(check('alt', page({ blocks: [photo] }))?.level).toBe('problem')
  })

  it('без alt по схеме — только картинки, у которых в схеме поля нет alt: в каталоге это логотипы', () => {
    // Обходим JSON Schema всех блоков: объект-картинка (x-widget image) без свойства alt
    const withoutAlt: string[] = []
    const walk = (node: BlockSchemaNode | undefined, path: string) => {
      if (!node) return
      const record = node as BlockSchemaNode & { 'x-widget'?: string }
      if (record['x-widget'] === 'image' && !('alt' in (node.properties ?? {}))) {
        withoutAlt.push(path)
        expect(node['x-allow-svg']).toBe(true)
      }
      if (node.items) walk(node.items, `${path}[]`)
      for (const [key, child] of Object.entries(node.properties ?? {}))
        walk(child, `${path}.${key}`)
    }
    for (const entry of blocks) walk(blockPropsSchema(entry.type), entry.type)
    expect(withoutAlt).toEqual(['clients.items[].logo'])
  })

  it('логотип в незнакомом блоке (черновик после отката версии) — проверяется как картинка', () => {
    const unknown = { id: 'x', type: 'header', props: { logo: { mediaId } } }
    expect(check('alt', page({ blocks: [unknown] }))?.level).toBe('problem')
  })
})

describe('проверка: «Контакты» и «SEO → Организация»', () => {
  const org = {
    name: 'ИП Иванов',
    phone: '+7 900 000-00-00',
    email: 'ivan@example.ru',
    street: 'ул. Ленина, 50',
  }
  const contacts = (props: Record<string, unknown>) => ({
    id: 'contacts',
    type: 'contacts',
    props: { markup: true, ...props },
  })
  const withOrg = (organization = org) => ({ ...site, organization })

  it('совпадают (номер в другой записи, адрес короче) — хорошо', () => {
    const block = contacts({ phone: '+7(900)0000000', address: 'Пермь, ул Ленина 50' })
    expect(check('contacts', page({ blocks: [block] }), withOrg())?.level).toBe('good')
  })

  it('«8 …» в «SEO» и «+7 …» в блоке — один номер, расхождения нет', () => {
    const block = contacts({ phone: '+7 (900) 000-00-00' })
    const eight = { ...org, phone: '8 (900) 000-00-00' }
    expect(check('contacts', page({ blocks: [block] }), withOrg(eight))?.level).toBe('good')
  })

  it('телефон, почта и адрес разошлись — предупреждение со списком', () => {
    const block = contacts({
      phone: '+7 900 111-11-11',
      email: 'office@example.ru',
      address: 'Пермь, Мира, 1',
    })
    const found = check('contacts', page({ blocks: [block] }), withOrg())
    expect(found?.level).toBe('warning')
    expect(found?.title).toBe('«Контакты» и «SEO → Организация» расходятся: телефон, почта, адрес')
  })

  it('пустое в «SEO» — блок дополняет разметку, расхождения нет', () => {
    const block = contacts({ phone: '+7 900 111-11-11' })
    const empty = { ...org, phone: '', email: '', street: '' }
    expect(check('contacts', page({ blocks: [block] }), withOrg(empty))?.level).toBe('good')
  })

  it('без названия организации — разметки не будет: предупреждение', () => {
    const block = contacts({ phone: '+7 900 000-00-00' })
    expect(check('contacts', page({ blocks: [block] }), withOrg({ ...org, name: '' }))?.title).toBe(
      'Разметки организации не будет: в «SEO → Организация» нет названия',
    )
  })

  it('без флажка разметки и без организации (токен API) — проверки нет', () => {
    const block = contacts({ markup: false, phone: '+7 900 111-11-11' })
    expect(check('contacts', page({ blocks: [block] }), withOrg())).toBeUndefined()
    expect(
      check('contacts', page({ blocks: [contacts({ phone: '+7 900 111-11-11' })] })),
    ).toBeUndefined()
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
      border: '#e5e5e5',
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
