// @vitest-environment happy-dom
import { Header, type HeaderInput, type MediaMap } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SiteHeader } from './SiteHeader'
import { headerRowButton, headerScriptNeeded, siteHeaderView } from './view'

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
  phone?: string
}

function viewOf(header: HeaderInput | null, options: Options = {}) {
  return siteHeaderView({
    header: header && Header.parse(header),
    siteName: 'Ремонт у Ивана',
    page: {
      slug: options.slug ?? 'raboty',
      content: { blocks: options.blocks ?? [plainHero], hideHeader: options.hideHeader },
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
