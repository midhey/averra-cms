import { describe, expect, it } from 'vitest'
import { defaultNotFoundContent, PageContent } from './page'
import {
  applyTitleTemplate,
  findRedirect,
  Ga4Id,
  MetrikaId,
  newSiteSettings,
  normalizeRedirectPath,
  Organization,
  Redirects,
  readSiteSettings,
  redirectLocation,
  redirectTableIssues,
  SITE_ROOT_FILES,
  SiteSettingsPatch,
  SiteUrl,
  settingsMediaIds,
  TitleTemplate,
  VerificationCode,
} from './site-settings'

const mediaId = '11111111-1111-4111-8111-111111111111'

const issuesOf = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }))

describe('настройки по умолчанию', () => {
  it('пустые настройки из базы — открытый сайт без аналитики и редиректов', () => {
    const settings = readSiteSettings({})
    expect(settings).toMatchObject({
      titleTemplate: '',
      description: '',
      language: 'ru',
      url: '',
      ogImage: null,
      icon: null,
      hideFromSearch: false,
      verification: { yandex: '', google: '' },
      analytics: { metrika: '', ga4: '' },
      organization: { type: 'Organization', name: '', socials: [] },
      redirects: [],
    })
  })

  it('новый сайт установки скрыт от поисковиков, пока его делают', () => {
    expect(newSiteSettings().hideFromSearch).toBe(true)
  })

  it('лишние ключи из базы (их записала более новая версия) отбрасываются, а не роняют чтение', () => {
    const settings = readSiteSettings({
      description: 'Ремонт',
      future: true,
      analytics: { metrika: '12345678', yandexAds: 'x' },
      organization: { name: 'ООО «Ремонт»', address: { city: 'Тверь', floor: 3 } },
    })
    expect(settings.description).toBe('Ремонт')
    expect(settings.analytics).toEqual({ metrika: '12345678', ga4: '' })
    expect(settings.organization.address).toEqual({
      street: '',
      city: 'Тверь',
      region: '',
      postalCode: '',
    })
    expect(settings).not.toHaveProperty('future')
  })

  it('непонятное значение поля (его записала более новая версия) — значение по умолчанию', () => {
    const invalid: string[] = []
    const stored = {
      description: 'Ремонт',
      language: 'pl',
      analytics: { metrika: 'alert(1)', ga4: 'G-ABCDEF' },
      redirects: [{ from: '/a', to: '/a' }],
    }
    const settings = readSiteSettings(stored, (field) => invalid.push(field))
    expect(settings).toMatchObject({
      description: 'Ремонт',
      language: 'ru',
      // Группа целиком: в скрипт не попадёт ни одно значение из непонятной группы
      analytics: { metrika: '', ga4: '' },
      redirects: [],
    })
    expect(invalid.toSorted()).toEqual(['analytics', 'language', 'redirects'])
    // Переданное не меняется: в базе поле останется для версии, которая его понимает
    expect(stored.language).toBe('pl')
  })

  it('картинки настроек — OG, иконка и логотип', () => {
    const other = '22222222-2222-4222-8222-222222222222'
    const settings = readSiteSettings({
      ogImage: mediaId,
      icon: other,
      organization: { name: 'Ремонт', logo: mediaId },
    })
    expect(settingsMediaIds(settings)).toEqual([mediaId, other, mediaId])
  })
})

describe('SiteSettingsPatch', () => {
  it('принимает часть полей и не подставляет остальные', () => {
    const patch = SiteSettingsPatch.parse({ description: 'Ремонт квартир' })
    expect(patch).toEqual({ description: 'Ремонт квартир' })
  })

  it('не принимает лишние поля: опечатка не пройдёт молча', () => {
    expect(SiteSettingsPatch.safeParse({ descriptoin: 'x' }).success).toBe(false)
  })

  it('группа заменяется целиком: недостающее в ней — по умолчанию', () => {
    expect(SiteSettingsPatch.parse({ analytics: { metrika: '98765432' } })).toEqual({
      analytics: { metrika: '98765432', ga4: '' },
    })
  })
})

describe('шаблон заголовка', () => {
  it.each(['', '%s — Ремонт', 'Ремонт | %s'])('принимает «%s»', (template) => {
    expect(TitleTemplate.safeParse(template).success).toBe(true)
  })

  it.each(['Ремонт', '%s — %s'])('отклоняет «%s»: %s должен быть ровно один', (template) => {
    expect(TitleTemplate.safeParse(template).error?.issues[0]?.message).toMatch(/ровно один раз/)
  })

  it('подставляет заголовок страницы, а пустой шаблон оставляет его как есть', () => {
    expect(applyTitleTemplate('%s — Ремонт', 'Цены')).toBe('Цены — Ремонт')
    expect(applyTitleTemplate('', 'Цены')).toBe('Цены')
  })
})

describe('адрес сайта', () => {
  it('хранится одним видом: https, домен строчными, без косой черты', () => {
    expect(SiteUrl.parse('https://Example.RU/')).toBe('https://example.ru')
    expect(SiteUrl.parse('  ')).toBe('')
  })

  it.each([
    'http://example.ru',
    'https://example.ru/catalog',
    'https://example.ru/?a=1',
    'https://user:pass@example.ru',
    'https://example.ru:8443',
    'https://localhost',
    'example.ru',
  ])('отклоняет %s', (url) => {
    expect(SiteUrl.safeParse(url).error?.issues[0]?.message).toMatch(/https:\/\/ и домен/)
  })
})

describe('коды и счётчики', () => {
  it('код подтверждения вынимается из вставленного мета-тега', () => {
    expect(
      VerificationCode.parse('<meta name="yandex-verification" content="0a1b2c3d4e5f6a7b" />'),
    ).toBe('0a1b2c3d4e5f6a7b')
    expect(VerificationCode.parse(' abc_DEF-123 ')).toBe('abc_DEF-123')
  })

  it('код с кавычками и скобками не пройдёт: он уходит в атрибут', () => {
    expect(VerificationCode.safeParse('abc"><script>').success).toBe(false)
    expect(VerificationCode.safeParse('<meta content="a"b">').success).toBe(false)
  })

  it('счётчик Метрики — только цифры, GA4 — G- и латиница', () => {
    expect(MetrikaId.safeParse('98765432').success).toBe(true)
    expect(MetrikaId.safeParse('9876543x').success).toBe(false)
    expect(MetrikaId.safeParse("1);alert('x")).toEqual(expect.objectContaining({ success: false }))
    expect(Ga4Id.parse('g-abc123def4')).toBe('G-ABC123DEF4')
    expect(Ga4Id.safeParse('UA-12345-1').success).toBe(false)
    expect(Ga4Id.safeParse("G-1');alert('").success).toBe(false)
  })
})

describe('организация', () => {
  it('без названия, но с телефоном — ошибка у названия', () => {
    const result = Organization.safeParse({ phone: '+7 900 123-45-67' })
    expect(issuesOf(result)).toEqual([{ path: 'name', message: expect.stringMatching(/название/) }])
  })

  it('проверяет реквизиты и ссылки на соцсети', () => {
    const result = Organization.safeParse({
      name: 'ООО «Ремонт»',
      inn: '123',
      ogrn: '12345',
      socials: ['http://vk.com/remont', 'javascript:alert(1)'],
      address: { postalCode: '1700' },
    })
    expect(issuesOf(result).map((issue) => issue.path)).toEqual([
      'address.postalCode',
      'socials.0',
      'socials.1',
      'inn',
      'ogrn',
    ])
  })

  it('пустая организация — разметки нет, ошибок нет', () => {
    expect(Organization.parse({}).name).toBe('')
  })
})

describe('редиректы', () => {
  const parse = (redirects: { from: string; to: string }[]) => Redirects.safeParse(redirects)

  it('нормализует «откуда»: без косой черты в конце и раскодированным', () => {
    const result = Redirects.parse([
      { from: '/old/', to: '/new' },
      { from: '/%D1%86%D0%B5%D0%BD%D1%8B', to: 'https://example.ru/price?ref=1' },
    ])
    expect(result.map((redirect) => redirect.from)).toEqual(['/old', '/цены'])
  })

  it.each([
    ['не путь', 'old', /с \/ в начале/],
    ['чужой сайт', '//evil.example/x', /с \/ в начале/],
    ['с параметрами', '/old?id=1', /Без \?/],
    ['главная', '/', /С главной/],
    ['служебный путь', '/media/x', /Служебные/],
    ['служебный путь без хвоста', '/api', /Служебные/],
  ])('отклоняет «откуда»: %s', (_, from, message) => {
    expect(issuesOf(parse([{ from, to: '/new' }]))[0]?.message).toMatch(message)
  })

  it.each([
    'http://example.ru',
    'javascript:alert(1)',
    'new',
    '//evil.example',
    // Браузер читает \ как /: это ссылки на чужой домен под видом пути
    '/\\evil.example',
    '/\\/evil.example',
    '/a\\b',
    '/a\u0000b',
    'https://example.ru\\@evil.example',
  ])('отклоняет «куда» %j', (to) => {
    expect(issuesOf(parse([{ from: '/old', to }]))[0]?.message).toMatch(/Путь на этом сайте/)
  })

  it('отклоняет «откуда» с обратной косой чертой', () => {
    expect(issuesOf(parse([{ from: '/\\old', to: '/new' }]))[0]?.message).toMatch(/с \/ в начале/)
  })

  it('отклоняет «куда» с повреждённым символом', () => {
    expect(issuesOf(parse([{ from: '/old', to: '/a\uD800' }]))[0]?.message).toMatch(
      /повреждённый символ/,
    )
  })

  it.each(SITE_ROOT_FILES)('служебный файл %s не перенаправить', (from) => {
    expect(issuesOf(parse([{ from, to: '/new' }]))[0]?.message).toMatch(/служебный файл/)
  })

  it('ссылка https на свой же домен — тоже петля, если известен адрес сайта', () => {
    const redirects = Redirects.parse([
      { from: '/a', to: 'https://Example.ru/b?x=1' },
      { from: '/b', to: '/a' },
      { from: '/c', to: 'https://example.ru/c/' },
      { from: '/d', to: 'https://example.ru' },
      { from: '/e', to: 'https://example.ruby/e' },
    ])
    // Без адреса сайта такие ссылки внешние: схема их пропускает
    expect(redirectTableIssues(redirects)).toEqual([])
    expect(redirectTableIssues(redirects, 'https://example.ru')).toEqual([
      { index: 0, field: 'to', message: 'Петля: цепочка редиректов от /a возвращается на /a' },
      { index: 1, field: 'to', message: 'Петля: цепочка редиректов от /b возвращается на /b' },
      { index: 2, field: 'to', message: 'Редирект ведёт сам на себя' },
    ])
  })

  it('Location: кириллица кодируется, закодированное и ASCII — как есть', () => {
    expect(redirectLocation('/цены?x=1#т')).toBe('/%D1%86%D0%B5%D0%BD%D1%8B?x=1#%D1%82')
    expect(redirectLocation('https://пример.рф/a')).toBe(
      'https://%D0%BF%D1%80%D0%B8%D0%BC%D0%B5%D1%80.%D1%80%D1%84/a',
    )
    expect(redirectLocation('/%D1%86?a=b')).toBe('/%D1%86?a=b')
  })

  it('Location: строка запроса исходного адреса переходит в «куда», если у него своей нет', () => {
    expect(redirectLocation('/new', '?utm_source=x&utm_medium=cpc')).toBe(
      '/new?utm_source=x&utm_medium=cpc',
    )
    expect(redirectLocation('/цены#прайс', '?utm_source=x')).toBe(
      '/%D1%86%D0%B5%D0%BD%D1%8B?utm_source=x#%D0%BF%D1%80%D0%B0%D0%B9%D1%81',
    )
    expect(redirectLocation('https://example.org/a', 'utm_source=x')).toBe(
      'https://example.org/a?utm_source=x',
    )
    // Своя строка запроса у «куда» — главнее; пустая исходная ничего не меняет
    expect(redirectLocation('/ceny?from=old', '?utm_source=x')).toBe('/ceny?from=old')
    expect(redirectLocation('/new', '?')).toBe('/new')
    expect(redirectLocation('/new', '')).toBe('/new')
  })

  it('дубль «откуда» — ошибка у второго, даже если отличается косой чертой', () => {
    expect(
      issuesOf(
        parse([
          { from: '/old', to: '/a' },
          { from: '/old/', to: '/b' },
        ]),
      ),
    ).toEqual([{ path: '1.from', message: 'Этот адрес уже есть в таблице выше' }])
  })

  it('редирект на себя и петли не проходят, цепочка без петли — проходит', () => {
    expect(issuesOf(parse([{ from: '/a', to: '/a/?x=1' }]))[0]?.message).toBe(
      'Редирект ведёт сам на себя',
    )
    const loop = issuesOf(
      parse([
        { from: '/a', to: '/b' },
        { from: '/b', to: '/c' },
        { from: '/c', to: '/a#top' },
      ]),
    )
    expect(loop.map((issue) => issue.path)).toEqual(['0.to', '1.to', '2.to'])
    expect(loop[0]?.message).toMatch(/Петля/)
    expect(
      parse([
        { from: '/a', to: '/b' },
        { from: '/b', to: 'https://example.ru/a' },
      ]).success,
    ).toBe(true)
  })

  it('находит редирект по пути запроса в любом написании', () => {
    const redirects = Redirects.parse([{ from: '/старый', to: '/new' }])
    expect(findRedirect(redirects, '/%D1%81%D1%82%D0%B0%D1%80%D1%8B%D0%B9/')).toBe('/new')
    expect(findRedirect(redirects, '/другой')).toBeUndefined()
    expect(normalizeRedirectPath('/%E0%A4%A')).toBe('/%E0%A4%A')
  })
})

describe('страница', () => {
  it('описание и noindex страницы необязательны', () => {
    expect(PageContent.parse({ blocks: [] })).toEqual({ blocks: [] })
    expect(PageContent.parse({ blocks: [], seo: { noindex: true } }).seo).toEqual({
      noindex: true,
    })
    expect(PageContent.safeParse({ blocks: [], seo: { robots: 'none' } }).success).toBe(false)
  })

  it('стандартная страница 404 проходит схему и скрыта от поисковиков', () => {
    const content = defaultNotFoundContent()
    expect(content.blocks[0]).toMatchObject({
      type: 'hero',
      props: { title: 'Страница не найдена' },
    })
    expect(content.seo?.noindex).toBe(true)
  })
})
