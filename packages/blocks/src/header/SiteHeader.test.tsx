// @vitest-environment happy-dom
import { Header, type HeaderInput, type MediaMap } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SiteHeader } from './SiteHeader'
import { headerMenuRow, headerRowButton, headerScriptNeeded, siteHeaderView } from './view'

// Шапка сайта: каждая раскладка, меню без JS (<details>), текущий пункт, «К содержимому»,
// прозрачная — только над «Первым экраном» на фото, скрипт — только когда он что-то делает

const logoId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const media: MediaMap = {
  [logoId]: {
    width: 120,
    height: 40,
    variants: [{ format: 'svg', width: 120, height: 40, url: `/media/${logoId}/image.svg` }],
  },
}
const pages = [
  { slug: 'index', blockIds: ['hero', 'pricing', 'contact'] },
  { slug: 'raboty', blockIds: [] },
]
const menu = [
  { label: 'Цены', page: 'index', block: 'pricing' },
  { label: 'Работы', page: 'raboty' },
  { label: 'Акции', page: 'akcii' },
]
const contacts = { phone: '+7 (342) 000-00-00', address: 'Пермь, ул. Ленина, 1' }
const plainHero = { type: 'hero', props: { title: 'Ремонт' } }
const photoHero = {
  type: 'hero',
  props: { variant: 'cover', title: 'Ремонт', image: { mediaId: logoId, alt: 'Кухня' } },
}
const splitHero = { ...photoHero, props: { ...photoHero.props, variant: 'split' } }

type Options = {
  slug?: string
  blocks?: { type: string; props: unknown }[]
  hideHeader?: boolean
  shortHeader?: boolean
  phone?: string
}

function viewOf(header: HeaderInput | null, options: Options = {}) {
  return siteHeaderView({
    header: header && Header.parse(header),
    siteName: 'Ремонт у Ивана',
    page: {
      slug: options.slug ?? 'raboty',
      content: {
        blocks: options.blocks ?? [plainHero],
        hideHeader: options.hideHeader,
        shortHeader: options.shortHeader,
      },
    },
    pages,
    contacts: { ...contacts, phone: options.phone ?? contacts.phone },
  })
}

function render(header: HeaderInput, options: Options = {}) {
  const view = viewOf(header, options)
  if (!view) throw new Error('Шапки нет')
  document.body.innerHTML = renderToStaticMarkup(<SiteHeader view={view} media={media} />)
  return document.body
}

const desktopNav = (body: HTMLElement) => body.querySelector('header > div > nav')
const menuLinks = (nav: Element | null) =>
  [...(nav?.querySelectorAll('a') ?? [])].map((link) => [
    link.textContent,
    link.getAttribute('href'),
  ])

describe('шапка на странице', () => {
  it('не опубликована или скрыта страницей — шапки нет', () => {
    expect(viewOf(null)).toBeNull()
    expect(viewOf({ menu }, { hideHeader: true })).toBeNull()
  })

  it('«К содержимому» — первой, ведёт к main страницы', () => {
    const body = render({})
    const skip = body.firstElementChild
    expect(skip?.tagName).toBe('A')
    expect(skip?.textContent).toBe('К содержимому')
    expect(skip?.getAttribute('href')).toBe('#content')
  })

  it('классика: название сайта ссылкой на главную, меню строкой, телефон и кнопка', () => {
    const body = render({
      phone: true,
      menu,
      button: { label: 'Рассчитать', page: 'index', block: 'contact' },
    })
    const header = body.querySelector('header')
    expect(header?.getAttribute('data-layout')).toBe('classic')
    expect(header?.hasAttribute('data-sticky')).toBe(true)
    const brand = header?.querySelector('a[href="/"]')
    expect(brand?.textContent).toBe('Ремонт у Ивана')
    const nav = desktopNav(body)
    expect(nav?.getAttribute('aria-label')).toBe('Меню сайта')
    // Пункт на неопубликованную страницу не выводится
    expect(menuLinks(nav)).toEqual([
      ['Цены', '/#pricing'],
      ['Работы', '/raboty/'],
    ])
    expect(header?.querySelector('a[href="tel:+73420000000"]')?.textContent).toBe(
      '+7 (342) 000-00-00',
    )
    expect(header?.querySelector('a[href="/#contact"]')?.textContent).toBe('Рассчитать')
  })

  it('текущий пункт — aria-current="page", пункт с блоком — нет', () => {
    const body = render({ menu }, { slug: 'raboty' })
    const current = [...body.querySelectorAll('[aria-current="page"]')].map((a) => a.textContent)
    // Два списка — строкой и в меню телефона: в обоих
    expect(current).toEqual(['Работы', 'Работы'])
    expect(render({ menu }, { slug: 'index' }).querySelector('[aria-current]')).toBeNull()
  })

  it('меню телефона — <details> с подписью «Меню», в нём пункты, кнопка и телефон', () => {
    const body = render({
      phone: true,
      menu,
      button: { label: 'Рассчитать', page: 'index' },
    })
    const details = body.querySelector('details[data-header-menu]')
    expect(details?.hasAttribute('open')).toBe(false)
    expect(details?.querySelector('summary')?.textContent).toBe('Меню')
    expect(details?.querySelector('summary svg')?.getAttribute('aria-hidden')).toBe('true')
    const panel = details?.querySelector('nav')
    expect(panel?.getAttribute('aria-label')).toBe('Меню сайта')
    expect(menuLinks(panel ?? null)).toEqual([
      ['Цены', '/#pricing'],
      ['Работы', '/raboty/'],
    ])
    expect(details?.querySelector('a[href="/"]')?.textContent).toBe('Рассчитать')
    expect(details?.querySelector('a[href^="tel:"]')?.textContent).toBe('+7 (342) 000-00-00')
  })

  it('без меню — ни <details>, ни второго списка', () => {
    const body = render({ button: { label: 'Рассчитать', page: 'index' } })
    expect(body.querySelector('details')).toBeNull()
    expect(body.querySelector('nav')).toBeNull()
    expect(body.querySelector('header')?.hasAttribute('data-panel')).toBe(false)
    // Кнопке на телефоне — своя строка: в меню её не спрятать
    expect(body.querySelector('header')?.hasAttribute('data-row-button')).toBe(true)
  })

  it('своя строка кнопке — только без меню и с кнопкой', () => {
    const button = { label: 'Рассчитать', page: 'index' }
    const rowButton = (header: HeaderInput) =>
      render(header).querySelector('header')?.hasAttribute('data-row-button')
    expect(rowButton({ menu, button })).toBe(false)
    expect(rowButton({ layout: 'minimal', menu, button })).toBe(true)
    expect(rowButton({ layout: 'minimal' })).toBe(false)
    // Меню есть, но все пункты — на страницы, которых нет на сайте: на сайте меню пустое
    expect(rowButton({ menu: [{ label: 'Акции', page: 'akcii' }], button })).toBe(true)
  })

  it('сборке сайта признак строки кнопки — тот же, что у шапки', () => {
    const button = { label: 'Рассчитать', page: 'index' }
    const view = (header: HeaderInput) => {
      const result = viewOf(header)
      if (!result) throw new Error('Шапки нет')
      return result
    }
    expect(headerRowButton(view({ layout: 'minimal', menu, button }))).toBe(true)
    expect(headerRowButton(view({ menu: [{ label: 'Акции', page: 'akcii' }], button }))).toBe(true)
    expect(headerRowButton(view({ menu, button }))).toBe(false)
    expect(headerRowButton(view({ layout: 'minimal' }))).toBe(false)
  })

  it('длинное меню — своей строкой на широком экране; у «Минимума» признака нет', () => {
    const page = (label: string) => ({ label, page: 'index' })
    const view = (header: HeaderInput, siteName?: string) => {
      const result = viewOf(header)
      if (!result) throw new Error('Шапки нет')
      // Подпись логотипа без своей — название сайта: подменяем и её
      return siteName === undefined
        ? result
        : { ...result, siteName, brand: { ...result.brand, text: siteName } }
    }
    const short = Array.from({ length: 6 }, (_, index) => page(`Раздел ${index + 1}`))
    expect(headerMenuRow(view({ menu: short }))).toBe(false)
    // Один пункт длиннее 24 знаков
    expect(headerMenuRow(view({ menu: [page('Ремонт ванных комнат под ключ')] }))).toBe(true)
    // Пункты короткие, но вместе с подписью кнопки — больше 100 знаков
    const many = Array.from({ length: 8 }, (_, index) => page(`Пункт меню ${index + 1}`))
    expect(headerMenuRow(view({ logo: logoId, menu: many }))).toBe(false)
    const button = { label: 'Записаться на бесплатный замер и расчёт!', page: 'index' }
    expect(headerMenuRow(view({ logo: logoId, menu: many, button }))).toBe(true)
    expect(headerMenuRow(view({ layout: 'double', logo: logoId, menu: many, button }))).toBe(true)
    // «По центру»: меню и так своей строкой, но длинное переносится — признак ради отступов
    expect(headerMenuRow(view({ layout: 'center', logo: logoId, menu: many, button }))).toBe(true)
    expect(headerMenuRow(view({ layout: 'center', logo: logoId, menu: short }))).toBe(false)
    expect(headerMenuRow(view({ layout: 'minimal', menu: many, button }))).toBe(false)
    // Без логотипа в строке с меню — название сайта: длинное считается вместе с пунктами
    const four = Array.from({ length: 4 }, (_, index) => page(`${index + 1}. Ремонт под ключ`))
    expect(headerMenuRow(view({ logo: logoId, menu: four }))).toBe(false)
    expect(
      headerMenuRow(view({ menu: four }, 'Ремонт квартир и ванных под ключ в Перми и крае')),
    ).toBe(true)
    const header = render({ menu: many, button }).querySelector('header')
    expect(header?.hasAttribute('data-menu-row')).toBe(true)
    expect(render({ menu: short }).querySelector('header')?.hasAttribute('data-menu-row')).toBe(
      false,
    )
  })

  it('меню по центру — та же разметка, раскладку решает CSS', () => {
    const body = render({ layout: 'center', menu, phone: true })
    expect(body.querySelector('header')?.getAttribute('data-layout')).toBe('center')
    expect(menuLinks(desktopNav(body))).toHaveLength(2)
  })

  it('двухэтажная: сверху адрес и телефон', () => {
    const body = render({ layout: 'double', menu, phone: true })
    const header = body.querySelector('header')
    expect(header?.firstElementChild?.textContent).toBe('Пермь, ул. Ленина, 1+7 (342) 000-00-00')
    // В строке логотипа телефон тоже есть — его показывает собранная шапка и телефон
    expect(header?.querySelector('a[data-in-topbar]')).not.toBeNull()
  })

  it('минимум: логотип и кнопка, без меню', () => {
    const body = render({
      layout: 'minimal',
      menu,
      logo: logoId,
      button: { label: 'Рассчитать стоимость', page: 'index' },
    })
    expect(body.querySelector('nav')).toBeNull()
    expect(body.querySelector('details')).toBeNull()
    const logo = body.querySelector('a[href="/"] img')
    expect(logo?.getAttribute('src')).toBe(`/media/${logoId}/image.svg`)
    expect(logo?.getAttribute('alt')).toBe('Ремонт у Ивана')
  })

  it('логотип грузится сразу, но не в первую очередь: первым — фото первого экрана', () => {
    const raster: MediaMap = {
      [logoId]: {
        width: 240,
        height: 80,
        variants: [{ format: 'png', width: 240, height: 80, url: `/media/${logoId}/240.png` }],
      },
    }
    const view = viewOf({ logo: logoId })
    if (!view) throw new Error('Шапки нет')
    document.body.innerHTML = renderToStaticMarkup(<SiteHeader view={view} media={raster} />)
    const logo = document.querySelector('a[href="/"] img')
    expect(logo?.getAttribute('loading')).toBe('eager')
    expect(logo?.hasAttribute('fetchpriority')).toBe(false)
  })

  it('адрес в открытом меню под телефоном — как в концепте телефона', () => {
    for (const layout of ['double', 'classic', 'center'] as const) {
      const panel = render({ layout, phone: true, menu }).querySelector('details > div')
      expect(panel?.textContent, layout).toContain(contacts.address)
    }
    // Без телефона адрес — только у двухэтажной (в её верхней строке)
    expect(render({ layout: 'classic', phone: false, menu }).textContent).not.toContain(
      contacts.address,
    )
    expect(render({ layout: 'double', phone: false, menu }).textContent).toContain(contacts.address)
  })

  it('телефон включён, но в «Организации» его нет — телефона в шапке нет', () => {
    const body = render({ phone: true }, { phone: '' })
    expect(body.querySelector('a[href^="tel:"]')).toBeNull()
  })

  it('прозрачная — только над «Первым экраном» на фото', () => {
    expect(viewOf({ overlay: true }, { blocks: [photoHero] })?.overlay).toBe(true)
    expect(viewOf({ overlay: true }, { blocks: [plainHero] })?.overlay).toBe(false)
    // Картинка сбоку: шапка легла бы на фон темы — прозрачной в ней нет смысла
    expect(viewOf({ overlay: true }, { blocks: [splitHero] })?.overlay).toBe(false)
    const body = render({ overlay: true }, { blocks: [photoHero] })
    expect(body.querySelector('header')?.hasAttribute('data-overlay')).toBe(true)
  })
})

describe('скрипт шапки', () => {
  it('без сборки, прозрачности и меню — скрипт и метка прокрутки не нужны', () => {
    const view = viewOf({ condense: false, button: { label: 'Рассчитать', page: 'index' } })
    expect(headerScriptNeeded(view)).toBe(false)
    expect(render({}).querySelector('[data-header-sentinel]')).toBeNull()
  })

  it('сборка при прокрутке — скрипт и метка', () => {
    expect(headerScriptNeeded(viewOf({ condense: true }))).toBe(true)
    const body = render({ condense: true })
    const sentinels = [...body.querySelectorAll('[data-header-sentinel]')]
    expect(sentinels.map((element) => element.getAttribute('data-header-sentinel'))).toEqual([
      'far',
      'top',
    ])
    expect(sentinels.every((element) => element.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(body.querySelector('header')?.hasAttribute('data-condense')).toBe(true)
  })

  it('прозрачная липкая — скрипт; прозрачная нелипкая без меню — нет', () => {
    expect(headerScriptNeeded(viewOf({ overlay: true }, { blocks: [photoHero] }))).toBe(true)
    const loose = viewOf({ overlay: true, sticky: false }, { blocks: [photoHero] })
    expect(headerScriptNeeded(loose)).toBe(false)
  })

  it('меню телефона — скрипт для Esc, даже без сборки при прокрутке', () => {
    expect(headerScriptNeeded(viewOf({ menu, condense: false }))).toBe(true)
    expect(headerScriptNeeded(null)).toBe(false)
  })
})

describe('настройки шапки: ссылки, логотип, вид, короткая шапка', () => {
  const header = (body: HTMLElement) => body.querySelector('header')

  it('шапка прежней версии: разметка без новых признаков вида и без новой вкладки', () => {
    const body = render({
      menu,
      button: { label: 'Рассчитать', page: 'index', block: 'contact' },
      logo: logoId,
    })
    const root = header(body)
    for (const name of [
      'data-line',
      'data-button-shape',
      'data-button-hover',
      'data-link-hover',
      'data-mobile-button',
      'data-mobile-menu',
      'data-mobile-align',
      'data-short',
    ]) {
      expect(root?.hasAttribute(name), name).toBe(false)
    }
    expect(body.querySelector('[target]')).toBeNull()
    // Логотип-картинка: имя ссылки на главную — alt, название сайта
    expect(body.querySelector('a[href="/"] img')?.getAttribute('alt')).toBe('Ремонт у Ивана')
    expect(body.querySelector('[data-part="name"]')).toBeNull()
  })

  it('внешний пункт и кнопка: адрес как есть, https — в новой вкладке с noopener', () => {
    const body = render({
      menu: [
        { label: 'Telegram', url: 'https://t.me/lera' },
        { label: 'Почта', url: 'mailto:lera@example.ru' },
        { label: 'VK', url: 'https://vk.com/lera', newTab: false },
      ],
      button: { label: 'Позвонить', url: 'tel:+79991234567' },
    })
    const nav = desktopNav(body)
    const telegram = nav?.querySelector('a[href="https://t.me/lera"]')
    expect(telegram?.getAttribute('target')).toBe('_blank')
    expect(telegram?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(telegram?.textContent).toBe('Telegram (откроется в новой вкладке)')
    expect(nav?.querySelector('a[href="mailto:lera@example.ru"]')?.hasAttribute('target')).toBe(
      false,
    )
    expect(nav?.querySelector('a[href="https://vk.com/lera"]')?.hasAttribute('target')).toBe(false)
    expect(body.querySelector('a[href="tel:+79991234567"]')?.hasAttribute('target')).toBe(false)
  })

  it('подписи для телефона: в меню телефона и у кнопки на узком экране', () => {
    const body = render({
      menu: [{ label: 'Цели', mobileLabel: 'Цели занятий', page: 'index', block: 'pricing' }],
      button: { label: 'Пробный урок →', mobileLabel: 'Урок →', page: 'raboty' },
    })
    expect(menuLinks(desktopNav(body))).toEqual([['Цели', '/#pricing']])
    expect(menuLinks(body.querySelector('details nav'))).toEqual([['Цели занятий', '/#pricing']])
    const button = body.querySelector('header a[href="/raboty/"]')
    expect(button?.querySelectorAll('span')).toHaveLength(2)
    expect(button?.textContent).toBe('Пробный урок →Урок →')
    // В меню телефона кнопка — подписью для телефона
    expect(body.querySelector('details a[href="/raboty/"]')?.textContent).toBe('Урок →')
  })

  it('кнопка на телефоне «в строке шапки» — признак у шапки, в меню её второй раз нет', () => {
    const button = { label: 'Записаться', page: 'index', block: 'contact' }
    const body = render({ menu, button, look: { mobileButton: 'row' } })
    expect(header(body)?.getAttribute('data-mobile-button')).toBe('row')
    expect(body.querySelector('details a[href="/#contact"]')).toBeNull()
    // Без меню признака нет: кнопке и так место в строке
    const alone = render({ button, look: { mobileButton: 'row' } })
    expect(header(alone)?.hasAttribute('data-mobile-button')).toBe(false)
    // Без кнопки тоже: в строке рядом с «Меню» ничего нет, и слово «Меню» остаётся на месте
    const noButton = render({ menu, look: { mobileButton: 'row' } })
    expect(header(noButton)?.hasAttribute('data-mobile-button')).toBe(false)
  })

  it('вид: линия, форма и наведение кнопки, наведение пунктов, меню телефона — признаками', () => {
    const root = header(
      render({
        menu,
        look: {
          divider: false,
          buttonShape: 'pill',
          buttonHover: 'lift',
          linkHover: 'color',
          mobileMenu: 'fullscreen',
          mobileAlign: 'center',
        },
      }),
    )
    expect(root?.getAttribute('data-line')).toBe('none')
    expect(root?.getAttribute('data-button-shape')).toBe('pill')
    expect(root?.getAttribute('data-button-hover')).toBe('lift')
    expect(root?.getAttribute('data-link-hover')).toBe('color')
    expect(root?.getAttribute('data-mobile-menu')).toBe('fullscreen')
    expect(root?.getAttribute('data-mobile-align')).toBe('center')
  })

  it('логотип «текст»: знак акцентным шрифтом (украшение) и подпись в две строки', () => {
    const body = render({
      brand: 'text',
      logo: logoId,
      logoMark: 'Ve',
      logoText: 'Vallex\nEnglish',
    })
    const link = body.querySelector('header a[href="/"]')
    expect(link?.querySelector('img')).toBeNull()
    expect(link?.querySelector('[data-part="mark"]')?.getAttribute('aria-hidden')).toBe('true')
    const name = link?.querySelector('[data-part="name"]')
    expect(name?.textContent).toBe('Vallex\nEnglish')
    expect(name?.hasAttribute('data-divided')).toBe(true)
  })

  it('логотип «картинка и текст»: картинка без alt, имя ссылки — подпись', () => {
    const body = render({ brand: 'imageText', logo: logoId })
    const link = body.querySelector('header a[href="/"]')
    expect(link?.querySelector('img')?.getAttribute('alt')).toBe('')
    expect(link?.querySelector('[data-part="name"]')?.textContent).toBe('Ремонт у Ивана')
    // Картинки нет в медиатеке — название вместо неё, без черты
    const missing = viewOf({ brand: 'imageText', logo: '00000000-0000-4000-8000-000000000000' })
    if (!missing) throw new Error('Шапки нет')
    document.body.innerHTML = renderToStaticMarkup(<SiteHeader view={missing} media={media} />)
    const name = document.body.querySelector('[data-part="name"]')
    expect(name?.hasAttribute('data-divided')).toBe(false)
  })

  it('«Картинка» без картинки — название сайта, а не знак и подпись от вида «Текст»', () => {
    const leftovers = { logoMark: 'Ve', logoText: 'Vallex\nEnglish' }
    const body = render({ brand: 'image', ...leftovers })
    const link = body.querySelector('header a[href="/"]')
    expect(link?.querySelector('[data-part="mark"]')).toBeNull()
    expect(link?.textContent).toBe('Ремонт у Ивана')
    // «Картинка и текст» без картинки: подпись, знака нет — его вписывают только у «Текста»
    const imageText = render({ brand: 'imageText', ...leftovers })
    expect(imageText.querySelector('[data-part="mark"]')).toBeNull()
    expect(imageText.querySelector('[data-part="name"]')?.textContent).toBe('Vallex\nEnglish')
  })

  it('короткая шапка: логотип и «← На главную», без меню и кнопки; на главной — полная', () => {
    const full = { menu, button: { label: 'Рассчитать', page: 'index' }, phone: true }
    const body = render(full, { shortHeader: true })
    expect(header(body)?.hasAttribute('data-short')).toBe(true)
    expect(body.querySelector('nav')).toBeNull()
    expect(body.querySelector('details')).toBeNull()
    expect(body.querySelector('a[href^="tel:"]')).toBeNull()
    const back = [...body.querySelectorAll('header a[href="/"]')].at(-1)
    expect(back?.textContent).toBe('← На главную')
    expect(back?.querySelector('[aria-hidden="true"]')?.textContent).toBe('←')
    expect(headerScriptNeeded(viewOf(full, { shortHeader: true }))).toBe(false)
    expect(viewOf(full, { shortHeader: true, slug: 'index' })?.short).toBe(false)
    // Скрытая шапка главнее короткой
    expect(viewOf(full, { shortHeader: true, hideHeader: true })).toBeNull()
  })
})

/**
 * Текст CSS-модуля шапки: Vitest отдаёт CSS-модули пустыми, поэтому читаем файл (как в
 * SiteFooter.test.tsx). Модули Node — через process.getBuiltinModule: пакет без типов Node
 */
type NodeModules = {
  'node:fs': { readFileSync: (path: string, encoding: 'utf8') => string }
  'node:url': { fileURLToPath: (url: string) => string }
}
const builtin = <K extends keyof NodeModules>(id: K) =>
  (
    globalThis as unknown as {
      process: { getBuiltinModule: (id: K) => NodeModules[K] }
    }
  ).process.getBuiltinModule(id)
const css = builtin('node:fs').readFileSync(
  builtin('node:url')
    .fileURLToPath(import.meta.url)
    .replace(/[^/\\]+$/, 'SiteHeader.module.css'),
  'utf8',
)

/** Объявления правила с селектором в начале строки */
function rule(selector: string) {
  const start = css.indexOf(`\n${selector} {`)
  if (start < 0) throw new Error(`нет правила ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

describe('стили шапки', () => {
  it('наведение на пункты — по переменным темы, которые гарантируют заметную разницу', () => {
    expect(rule('.header[data-link-hover="background"] .link:hover')).toContain(
      'background: var(--color-background-hover)',
    )
    expect(rule('.header[data-link-hover="color"] .link:hover')).toContain(
      'text-decoration: var(--accent-link-line, underline)',
    )
  })

  it('прозрачная шапка: в раскрытом меню кольцо фокуса — цветом текста, а не фона', () => {
    expect(rule('.header[data-overlay]:not([data-stuck]) .panel :focus-visible')).toContain(
      'outline-color: var(--color-text)',
    )
  })

  it('«Во весь экран»: панель до низа окна при любой высоте шапки, без числа высоты', () => {
    expect(rule('.header[data-mobile-menu="fullscreen"] .panel')).toContain(
      'height: calc(100vh - 100%)',
    )
    expect(css).toContain('height: calc(100dvh - 100%)')
    expect(css).not.toMatch(/100d?vh - 4rem/)
  })
})
