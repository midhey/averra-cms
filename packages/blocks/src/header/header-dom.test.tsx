// @vitest-environment happy-dom
import { Header, type HeaderInput } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { type HeaderEnvironment, startSiteHeader } from './header-dom'
import { SiteHeader } from './SiteHeader'
import { siteHeaderView } from './view'

// Скрипт шапки: по наблюдателю метки прокрутки ставит data-condensed и data-stuck, анимацию —
// только без «уменьшить движение», Esc и выбор пункта закрывают меню телефона

type Callback = (entries: { target: Element; isIntersecting: boolean }[]) => void

const far = () => document.querySelector('[data-header-sentinel="far"]') as Element
const top = () => document.querySelector('[data-header-sentinel="top"]') as Element

/**
 * Наблюдатель-заглушка: тест сам говорит, сколько прокручено. Метки — 0.5rem и 7rem: до 8 px
 * видны обе, до 112 — только дальняя, дальше — ни одной
 */
function fakeObserver() {
  const state: { callback?: Callback; observed: Element[] } = { observed: [] }
  class Observer {
    constructor(callback: Callback) {
      state.callback = callback
    }
    observe(element: Element) {
      state.observed.push(element)
    }
    disconnect() {}
  }
  return {
    IntersectionObserver: Observer as unknown as typeof IntersectionObserver,
    scroll: (scrolled: boolean) =>
      state.callback?.([
        { target: top(), isIntersecting: !scrolled },
        { target: far(), isIntersecting: !scrolled },
      ]),
    /** Прокрутка y px: браузер присылает только метки, чья видимость поменялась */
    at: (y: number, before: number) => {
      const entries = [
        { target: top(), was: before < 8, now: y < 8 },
        { target: far(), was: before < 112, now: y < 112 },
      ]
        .filter((entry) => entry.was !== entry.now)
        .map((entry) => ({ target: entry.target, isIntersecting: entry.now }))
      if (entries.length > 0) state.callback?.(entries)
    },
    state,
  }
}

const motion = (reduce: boolean) => (query: string) => ({
  matches: reduce && query === '(prefers-reduced-motion: reduce)',
})

function mount(header: HeaderInput, blocks: { type: string; props: unknown }[] = []) {
  const view = siteHeaderView({
    header: Header.parse(header),
    siteName: 'Ремонт у Ивана',
    page: { slug: 'index', content: { blocks } },
    pages: [{ slug: 'index', blockIds: ['pricing'] }],
    contacts: { phone: '', address: '' },
  })
  if (!view) throw new Error('Шапки нет')
  document.body.innerHTML = renderToStaticMarkup(<SiteHeader view={view} media={{}} />)
  const element = document.querySelector('header')
  if (!element) throw new Error('Нет header')
  return element
}

const env = (observer: ReturnType<typeof fakeObserver>, reduce = false): HeaderEnvironment => ({
  IntersectionObserver: observer.IntersectionObserver,
  matchMedia: motion(reduce),
})

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('сборка при прокрутке', () => {
  it('метка ушла из окна — data-condensed, вернулась — снят', () => {
    const header = mount({ condense: true })
    const observer = fakeObserver()
    startSiteHeader(document, env(observer))
    expect(observer.state.observed).toEqual([far(), top()])
    observer.scroll(false)
    expect(header.hasAttribute('data-condensed')).toBe(false)
    observer.scroll(true)
    expect(header.hasAttribute('data-condensed')).toBe(true)
    // Липкая не прозрачная — data-stuck ей не нужен
    expect(header.hasAttribute('data-stuck')).toBe(false)
    observer.scroll(false)
    expect(header.hasAttribute('data-condensed')).toBe(false)
  })

  it('собранная шапка не разворачивается, пока не вернулись к самому верху (гистерезис)', () => {
    const header = mount({ condense: true, layout: 'double' })
    const observer = fakeObserver()
    startSiteHeader(document, env(observer))
    observer.scroll(false)
    // Прокрутили за дальнюю метку — собралась; шапка стала ниже на ~50 px, браузер вернул
    // прокрутку на эту разницу (scroll anchoring) — шапка остаётся собранной, а не мигает
    observer.at(120, 0)
    expect(header.hasAttribute('data-condensed')).toBe(true)
    observer.at(70, 120)
    expect(header.hasAttribute('data-condensed')).toBe(true)
    observer.at(110, 70)
    observer.at(60, 110)
    expect(header.hasAttribute('data-condensed')).toBe(true)
    // У самого верха — полная; развернулась, прокрутка сдвинулась вниз — но не за дальнюю метку
    observer.at(4, 60)
    expect(header.hasAttribute('data-condensed')).toBe(false)
    observer.at(54, 4)
    expect(header.hasAttribute('data-condensed')).toBe(false)
  })

  it('анимация включается после первого состояния; с «уменьшить движение» — никогда', () => {
    const header = mount({ condense: true })
    const observer = fakeObserver()
    startSiteHeader(document, env(observer))
    expect(header.hasAttribute('data-animate')).toBe(false)
    observer.scroll(true)
    expect(header.hasAttribute('data-animate')).toBe(true)

    const calm = mount({ condense: true })
    const calmObserver = fakeObserver()
    startSiteHeader(document, env(calmObserver, true))
    calmObserver.scroll(true)
    expect(calm.hasAttribute('data-condensed')).toBe(true)
    expect(calm.hasAttribute('data-animate')).toBe(false)
  })

  it('прозрачная липкая, как только страницу прокрутили, — data-stuck', () => {
    const image = { mediaId: '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b', alt: 'Кухня' }
    const header = mount({ overlay: true }, [
      { type: 'hero', props: { variant: 'cover', title: 'Ремонт', image } },
    ])
    const observer = fakeObserver()
    startSiteHeader(document, env(observer))
    observer.scroll(true)
    expect(header.hasAttribute('data-stuck')).toBe(true)
    expect(header.hasAttribute('data-condensed')).toBe(false)
  })

  it('без IntersectionObserver шапка остаётся полной и липкой', () => {
    const header = mount({ condense: true })
    startSiteHeader(document, { matchMedia: motion(false) })
    expect(header.hasAttribute('data-condensed')).toBe(false)
    expect(header.hasAttribute('data-sticky')).toBe(true)
  })
})

describe('меню телефона', () => {
  const menu = [{ label: 'Цены', page: 'index', block: 'pricing' }]

  it('Esc закрывает открытое меню и возвращает фокус на «Меню»', () => {
    mount({ menu })
    startSiteHeader(document, env(fakeObserver()))
    const details = document.querySelector('details') as HTMLDetailsElement
    details.setAttribute('open', '')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(details.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(details.querySelector('summary'))
  })

  it('другие клавиши и закрытое меню Esc не трогает', () => {
    mount({ menu })
    startSiteHeader(document, env(fakeObserver()))
    const details = document.querySelector('details') as HTMLDetailsElement
    details.setAttribute('open', '')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(details.hasAttribute('open')).toBe(true)
  })

  it('выбор пункта закрывает меню: якорь на этой странице не прячется под ним', () => {
    mount({ menu })
    startSiteHeader(document, env(fakeObserver()))
    const details = document.querySelector('details') as HTMLDetailsElement
    details.setAttribute('open', '')
    const link = details.querySelector('a[href="/#pricing"]') as HTMLAnchorElement
    link.addEventListener('click', (event) => event.preventDefault())
    link.click()
    expect(details.hasAttribute('open')).toBe(false)
  })
})
