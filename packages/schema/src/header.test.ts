import { describe, expect, it } from 'vitest'
import {
  defaultHeader,
  HEADER_MENU_MAX,
  Header,
  HeaderLayout,
  type HeaderTargetPage,
  headerContacts,
  headerLayoutTitles,
  headerLinkIssues,
  headerMediaIds,
  headerPageUses,
  isCurrentLink,
  overlayFits,
  readHeader,
  resolveSiteLink,
  sameHeader,
  siteLinkHref,
} from './header'
import { PageContent } from './page'

const item = (label: string, page = 'index', block?: string) => ({
  label,
  page,
  ...(block ? { block } : {}),
})

describe('Header', () => {
  it('по умолчанию — классика, липкая, без меню, кнопки и логотипа', () => {
    expect(defaultHeader).toEqual({
      layout: 'classic',
      sticky: true,
      condense: false,
      overlay: false,
      phone: false,
      button: null,
      logo: null,
      menu: [],
    })
  })

  it('четыре раскладки, у каждой подпись для людей', () => {
    expect(HeaderLayout.options).toEqual(['classic', 'center', 'double', 'minimal'])
    for (const layout of HeaderLayout.options) {
      expect(Header.safeParse({ layout }).success).toBe(true)
      expect(headerLayoutTitles[layout]).not.toBe('')
    }
    expect(Header.safeParse({ layout: 'mega' }).success).toBe(false)
  })

  it('пункт меню — своя страница и, по желанию, блок на ней', () => {
    const header = Header.parse({
      menu: [item('Цены', 'index', 'pricing-1'), item('Работы', 'raboty')],
    })
    expect(header.menu).toEqual([
      { label: 'Цены', page: 'index', block: 'pricing-1' },
      { label: 'Работы', page: 'raboty' },
    ])
  })

  it.each([
    ['внешняя ссылка вместо страницы', { label: 'Вк', page: 'https://vk.com' }],
    ['ссылка строкой', { label: 'Цены', href: '/#ceny' }],
    ['лишнее поле', { label: 'Цены', page: 'index', href: '/#ceny' }],
    ['якорь с #', { label: 'Цены', page: 'index', block: '#ceny' }],
    ['пустая подпись', { label: '  ', page: 'index' }],
    ['длинная подпись', { label: 'М'.repeat(41), page: 'index' }],
  ])('не пускает в меню: %s', (_, menuItem) => {
    expect(Header.safeParse({ menu: [menuItem] }).success).toBe(false)
  })

  it(`не больше ${HEADER_MENU_MAX} пунктов`, () => {
    const menu = Array.from({ length: HEADER_MENU_MAX }, (_, index) => item(`Пункт ${index}`))
    expect(Header.safeParse({ menu }).success).toBe(true)
    expect(Header.safeParse({ menu: [...menu, item('Лишний')] }).success).toBe(false)
  })

  it('кнопка — тоже своя страница или блок', () => {
    const button = { label: 'Рассчитать', page: 'index', block: 'form-1' }
    expect(Header.parse({ button }).button).toEqual(button)
    expect(Header.safeParse({ button: { label: 'Рассчитать', href: '#form' } }).success).toBe(false)
  })

  it('собирается при прокрутке только липкая шапка — ошибка у поля', () => {
    const result = Header.safeParse({ sticky: false, condense: true })
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['condense'], message: expect.stringMatching(/липкая/) }),
    ])
    expect(Header.safeParse({ sticky: true, condense: true }).success).toBe(true)
  })

  it('логотип — id из медиатеки', () => {
    const logo = 'b0000000-0000-4000-8000-000000000001'
    expect(Header.parse({ logo }).logo).toBe(logo)
    expect(headerMediaIds(Header.parse({ logo }))).toEqual([logo])
    expect(headerMediaIds(null)).toEqual([])
    expect(Header.safeParse({ logo: 'logo.svg' }).success).toBe(false)
  })

  it('sameHeader сравнивает по смыслу', () => {
    expect(sameHeader(defaultHeader, Header.parse({}))).toBe(true)
    expect(sameHeader(defaultHeader, Header.parse({ phone: true }))).toBe(false)
  })
})

describe('readHeader', () => {
  it('нет шапки в базе — по умолчанию', () => {
    expect(readHeader(null)).toEqual(defaultHeader)
    expect(readHeader('строка')).toEqual(defaultHeader)
  })

  it('незнакомое поле от более новой версии отбрасывает, непонятное значение — по умолчанию', () => {
    const invalid: string[] = []
    const header = readHeader(
      { layout: 'mega', sticky: false, banner: { text: 'Акция' }, menu: [item('Цены')] },
      (field) => invalid.push(field),
    )
    expect(header).toEqual({ ...defaultHeader, sticky: false, menu: [item('Цены')] })
    expect(invalid).toEqual(['layout'])
  })

  it('сборка без липкости — выключена, а не ошибка', () => {
    expect(readHeader({ sticky: false, condense: true })).toMatchObject({ condense: false })
  })

  it('новое поле в пункте меню и кнопке — отбрасывает его, а не всё меню', () => {
    const invalid: string[] = []
    const header = readHeader(
      {
        menu: [
          { ...item('Цены'), icon: 'star' },
          { label: '', page: 'index' },
          item('Работы', 'raboty', 'gallery-1'),
        ],
        button: { ...item('Рассчитать'), style: 'outline' },
      },
      (field) => invalid.push(field),
    )
    expect(header.menu).toEqual([item('Цены'), item('Работы', 'raboty', 'gallery-1')])
    expect(header.button).toEqual(item('Рассчитать'))
    // Непонятный пункт пропадает один, о нём — с номером
    expect(invalid).toEqual(['menu.1'])
  })

  it('пунктов больше предела — лишние не читаются', () => {
    const menu = Array.from({ length: HEADER_MENU_MAX + 2 }, (_, index) => item(`Пункт ${index}`))
    expect(readHeader({ menu }).menu).toHaveLength(HEADER_MENU_MAX)
  })
})

describe('headerPageUses', () => {
  it('называет пункты меню и кнопку, которые ведут на страницу', () => {
    const header = Header.parse({
      menu: [
        item('Услуги', 'uslugi'),
        item('Цены', 'index', 'pricing-1'),
        item('Наверх', 'uslugi'),
      ],
      button: item('Заказать', 'uslugi', 'form-1'),
    })
    expect(headerPageUses(header, 'uslugi')).toEqual([
      'пункт меню «Услуги»',
      'пункт меню «Наверх»',
      'кнопка «Заказать»',
    ])
    expect(headerPageUses(header, 'raboty')).toEqual([])
  })
})

describe('ссылки шапки', () => {
  const pages = [
    { slug: 'index', blockIds: ['hero', 'pricing-1'] },
    { slug: 'raboty', blockIds: [] },
  ]

  it('адрес — путь страницы, как в карте сайта, и якорь блока', () => {
    expect(siteLinkHref({ page: 'index' })).toBe('/')
    expect(siteLinkHref({ page: 'index', block: 'pricing-1' })).toBe('/#pricing-1')
    expect(siteLinkHref({ page: 'raboty' })).toBe('/raboty/')
  })

  it('цель на месте — ссылка как есть', () => {
    expect(resolveSiteLink({ page: 'index', block: 'pricing-1' }, pages)).toEqual({
      href: '/#pricing-1',
      missing: undefined,
    })
  })

  it('страницы нет на сайте — ссылки нет', () => {
    expect(resolveSiteLink({ page: 'akcii' }, pages)).toEqual({ href: undefined, missing: 'page' })
  })

  it('блока нет — на страницу без якоря', () => {
    expect(resolveSiteLink({ page: 'raboty', block: 'gallery-1' }, pages)).toEqual({
      href: '/raboty/',
      missing: 'block',
    })
  })

  it('текущий — пункт на саму страницу, а не на её блок', () => {
    expect(isCurrentLink({ page: 'raboty' }, 'raboty')).toBe(true)
    expect(isCurrentLink({ page: 'index', block: 'hero' }, 'index')).toBe(false)
    expect(isCurrentLink({ page: 'index' }, 'raboty')).toBe(false)
  })
})

describe('overlayFits', () => {
  const image = { mediaId: 'b0000000-0000-4000-8000-000000000001', alt: 'Кухня' }

  it('первый экран на фото — прозрачная шапка подходит', () => {
    expect(
      overlayFits([{ type: 'hero', props: { variant: 'cover', title: 'Ремонт', image } }]),
    ).toBe(true)
  })

  it.each([
    ['пустая страница', []],
    ['первый экран без картинки', [{ type: 'hero', props: { title: 'Ремонт' } }]],
    // Картинка сбоку: шапка легла бы на фон темы и выглядела бы обычной
    ['картинка сбоку', [{ type: 'hero', props: { variant: 'split', title: 'Ремонт', image } }]],
    ['первый блок не первый экран', [{ type: 'text-image', props: { title: 'О нас', image } }]],
  ])('не подходит: %s', (_, blocks) => {
    expect(overlayFits(blocks)).toBe(false)
  })
})

describe('PageContent.hideHeader', () => {
  it('страница может скрыть шапку, по умолчанию поля нет', () => {
    expect(PageContent.parse({ blocks: [] })).not.toHaveProperty('hideHeader')
    expect(PageContent.parse({ blocks: [], hideHeader: true }).hideHeader).toBe(true)
    expect(PageContent.safeParse({ blocks: [], hideHeader: 'да' }).success).toBe(false)
  })
})

describe('headerLinkIssues', () => {
  const block = (id: string, draft: boolean, published: boolean) => ({
    id,
    type: 'cta',
    label: null,
    draft,
    published,
  })
  const pages: HeaderTargetPage[] = [
    {
      slug: 'index',
      title: 'Ремонт',
      published: true,
      hideHeader: false,
      hideFooter: false,
      overlay: false,
      blocks: [
        block('hero', true, true),
        block('pricing-1', true, false),
        block('old', false, true),
      ],
    },
    {
      slug: 'akcii',
      title: 'Акции',
      published: false,
      hideHeader: false,
      hideFooter: false,
      overlay: false,
      blocks: [],
    },
  ]
  const header = (menu: ReturnType<typeof item>[], button = null) => Header.parse({ menu, button })

  it('всё на месте — замечаний нет', () => {
    const fine = header([item('Главная'), item('Тарифы', 'index', 'hero')])
    expect(headerLinkIssues(fine, pages, 'published')).toEqual([])
  })

  it('чужой или удалённой страницы нет — при сохранении и публикации', () => {
    const issues = headerLinkIssues(header([item('Блог', 'blog')]), pages, 'draft')
    expect(issues).toEqual([
      { path: 'menu.0.page', message: 'Пункт меню «Блог»: страницы /blog/ нет — выберите другую' },
    ])
  })

  it('черновик может вести на неопубликованное, публикация — нет', () => {
    const menu = header([item('Акции', 'akcii'), item('Тарифы', 'index', 'pricing-1')])
    expect(headerLinkIssues(menu, pages, 'draft')).toEqual([])
    expect(headerLinkIssues(menu, pages, 'published')).toEqual([
      {
        path: 'menu.0.page',
        message:
          'Пункт меню «Акции»: страница «Акции» не опубликована — опубликуйте её или выберите другую',
      },
      {
        path: 'menu.1.block',
        message:
          'Пункт меню «Тарифы»: блока #pricing-1 нет на опубликованной странице «Ремонт» — опубликуйте страницу или выберите другой блок',
      },
    ])
  })

  it('блока нет нигде — ошибка и в черновике; остался только на сайте — не ошибка', () => {
    expect(headerLinkIssues(header([item('Цены', 'index', 'nope')]), pages, 'draft')).toEqual([
      {
        path: 'menu.0.block',
        message: 'Пункт меню «Цены»: блока #nope нет на странице «Ремонт» — выберите другой',
      },
    ])
    expect(headerLinkIssues(header([item('Было', 'index', 'old')]), pages, 'draft')).toEqual([])
  })

  it('кнопка проверяется так же', () => {
    const withButton = Header.parse({ button: { label: 'Рассчитать', page: 'akcii' } })
    expect(headerLinkIssues(withButton, pages, 'published')).toEqual([
      expect.objectContaining({ path: 'button.page' }),
    ])
  })
})

describe('headerContacts', () => {
  it('телефон как есть, адрес — город и улица', () => {
    expect(
      headerContacts({
        phone: '+7 342 000-00-00',
        address: { city: 'Пермь', street: 'ул. Ленина, 1' },
      }),
    ).toEqual({ phone: '+7 342 000-00-00', address: 'Пермь, ул. Ленина, 1' })
    expect(headerContacts({ phone: '', address: { city: '', street: '' } }).address).toBe('')
  })
})
