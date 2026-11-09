// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PageContent, pageSlugOfHref } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SiteWindows } from '../window/SiteWindows'
import { siteWindowView } from '../window/view'
import { type BehaviorsEnvironment, startBehaviors, windowSlugOfPath } from './behaviors-dom'

// Скрипт поведений: окно открывается по ссылке, закрывается Esc, фоном и кнопкой, фокус
// возвращается; форма в окне отправляется fetch-запросом с итогом в окне; появление, плавный
// details и подсказка — только с JS и без «уменьшить движение»

const formPage = PageContent.parse({
  blocks: [
    {
      id: 'form',
      type: 'form',
      props: {
        title: 'Запись',
        fields: [
          { name: 'name', type: 'name', label: 'Имя', required: true },
          { name: 'contact', type: 'text', label: 'Контакт', required: true },
        ],
        policyUrl: '/privacy',
      },
    },
  ],
  window: { title: 'Запись на урок', closeOnBackdrop: true },
})

type MountOptions = { closeOnBackdrop?: boolean; extra?: string }

function mount({ closeOnBackdrop = true, extra = '' }: MountOptions = {}) {
  if (!formPage.window) throw new Error('страница не окно')
  const content = { ...formPage, window: { ...formPage.window, closeOnBackdrop } }
  const view = siteWindowView(
    { slug: 'zapis', title: 'Запись', content },
    (slug) => (id) => `http://localhost/api/forms/site/${slug}/${id}`,
  )
  if (!view) throw new Error('нет окна')
  document.body.innerHTML = `<main><a id="open" href="/zapis/" data-av-window>Записаться</a><a id="plain" href="/zapis/">Страница</a><a id="other" href="/ceny/" data-av-window>Цены</a><a id="blank" href="/zapis/" data-av-window target="_blank">Вкладка</a>${extra}</main>${renderToStaticMarkup(
    <SiteWindows windows={[view]} metrika="12345" />,
  )}`
  return {
    dialog: document.querySelector('dialog[data-site-window]') as HTMLDialogElement,
    link: document.getElementById('open') as HTMLAnchorElement,
  }
}

/**
 * Клик и то, отменил ли его скрипт. Слушатель окна стоит после слушателей документа: он видит итог
 * скрипта и сам отменяет переход — иначе happy-dom пошёл бы по ссылке на несуществующий сервер
 */
let prevented = false
window.addEventListener('click', (event) => {
  prevented = event.defaultPrevented
  event.preventDefault()
})
const click = (element: Element, init: MouseEventInit = {}) => {
  prevented = false
  element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }),
  )
  return { defaultPrevented: prevented }
}

const motion = (reduce: boolean) => (query: string) => ({
  matches: reduce && query === '(prefers-reduced-motion: reduce)',
})

beforeEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-window-open')
})

afterEach(() => vi.restoreAllMocks())

describe('окно сайта', () => {
  it('ссылка с data-av-window открывает окно: переход отменён, фокус на первом поле, прокрутка заблокирована', () => {
    const { dialog, link } = mount()
    startBehaviors(document, { matchMedia: motion(false) })
    link.focus()
    const event = click(link)
    expect(event.defaultPrevented).toBe(true)
    expect(dialog.open).toBe(true)
    expect(document.documentElement.hasAttribute('data-window-open')).toBe(true)
    expect(document.activeElement?.getAttribute('name')).toBe('name')
    // У окна есть имя — его заголовок
    expect(dialog.getAttribute('aria-labelledby')).toBe('w-zapis~title')
  })

  it('узкий экран: фокус при открытии — на заголовке окна, а не в поле (клавиатура не поднимается)', () => {
    const { dialog, link } = mount()
    startBehaviors(document, {
      matchMedia: (query) => ({ matches: query === '(max-width: 39.99rem)' }),
    })
    click(link)
    expect(dialog.open).toBe(true)
    expect(document.activeElement?.id).toBe('w-zapis~title')
    // Заголовок — не в обходе Tab: tabindex -1
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
  })

  it('Esc (cancel) закрывает окно и возвращает фокус на ссылку', () => {
    const { dialog, link } = mount()
    startBehaviors(document, {})
    link.focus()
    click(link)
    const cancel = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(link)
    expect(document.documentElement.hasAttribute('data-window-open')).toBe(false)
  })

  it('кнопка «Закрыть» закрывает окно', () => {
    const { dialog, link } = mount()
    startBehaviors(document, {})
    click(link)
    click(dialog.querySelector('[data-site-window-close]') as Element)
    expect(dialog.open).toBe(false)
  })

  it('клик по фону закрывает окно; с выключенной настройкой — нет; выделение, отпущенное на фоне, — нет', () => {
    const { dialog, link } = mount()
    startBehaviors(document, {})
    click(link)
    // Нажали в поле, отпустили на фоне
    dialog.querySelector('input')?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    click(dialog)
    expect(dialog.open).toBe(true)
    dialog.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    click(dialog)
    expect(dialog.open).toBe(false)

    const strict = mount({ closeOnBackdrop: false })
    startBehaviors(document, {})
    click(strict.link)
    strict.dialog.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    click(strict.dialog)
    expect(strict.dialog.open).toBe(true)
  })

  it.each([
    ['Ctrl-клик', 'open', { ctrlKey: true }],
    ['Shift-клик', 'open', { shiftKey: true }],
    ['средняя кнопка', 'open', { button: 1 }],
    ['ссылка без data-av-window', 'plain', {}],
    ['страница не окно', 'other', {}],
    ['ссылка в новой вкладке', 'blank', {}],
  ] as const)('%s — обычный переход', (_name, id, init) => {
    const { dialog } = mount()
    startBehaviors(document, {})
    const event = click(document.getElementById(id) as Element, init)
    expect(event.defaultPrevented).toBe(false)
    expect(dialog.open).toBe(false)
  })

  it('окно внутри шаблона своего блока скрипт не открывает', () => {
    mount({
      extra:
        '<div data-custom-block-root><dialog data-site-window="ceny"><p>подделка</p></dialog></div>',
    })
    startBehaviors(document, {})
    const event = click(document.getElementById('other') as Element)
    expect(event.defaultPrevented).toBe(false)
  })

  it('отправка формы в окне: заявка fetch-запросом, успех в окне, цель Метрики и событие averra:lead', async () => {
    const { dialog, link } = mount()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'accepted' })))
    const ym = vi.fn()
    const lead = vi.fn()
    document.addEventListener('averra:lead', lead)
    startBehaviors(document, { fetch: fetch as unknown as typeof globalThis.fetch, ym })
    click(link)
    const form = dialog.querySelector('form') as HTMLFormElement
    ;(form.elements.namedItem('name') as HTMLInputElement).value = 'Лера'
    ;(form.elements.namedItem('contact') as HTMLInputElement).value = '@lera'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(dialog.querySelector('[data-sent]')).not.toBeNull())
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    // Адрес приёма — страницы-окна и исходный id блока, не id в окне
    expect(url).toBe('http://localhost/api/forms/site/zapis/form')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
    expect(String(init.body)).toContain('name=%D0%9B%D0%B5%D1%80%D0%B0')
    expect(dialog.open).toBe(true)
    expect(document.activeElement?.getAttribute('role')).toBe('status')
    expect(ym).toHaveBeenCalledWith(12345, 'reachGoal', 'lead')
    expect(lead).toHaveBeenCalledTimes(1)
    // Закрыли и открыли снова — опять форма
    click(dialog.querySelector('[data-site-window-close]') as Element)
    expect(dialog.querySelector('[data-sent]')).toBeNull()
  })

  it('ошибка API — сообщение и поля в окне, поле отмечено и в фокусе, окно не закрылось', async () => {
    const { dialog, link } = mount()
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'validation',
              message: 'Поправьте поля. Кнопка «Назад» в браузере вернёт к форме',
              issues: [{ path: 'contact', message: 'Контакт — напишите ник вроде @nickname' }],
            },
          }),
          { status: 400 },
        ),
    )
    startBehaviors(document, { fetch: fetch as unknown as typeof globalThis.fetch })
    click(link)
    const form = dialog.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    const error = dialog.querySelector('[data-form-error]') as HTMLElement
    await vi.waitFor(() => expect(error.hidden).toBe(false))
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.textContent).toContain('Поправьте поля формы и отправьте её снова')
    expect(error.textContent).not.toContain('Назад')
    // Общая ошибка — над кнопкой отправки: её только что нажали, сообщение в экране
    expect(error.nextElementSibling?.getAttribute('type')).toBe('submit')
    const contact = form.elements.namedItem('contact') as HTMLElement
    expect(contact.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(contact)
    // Текст ошибки — у самого поля и связан с ним: на телефоне его видно рядом с полем в фокусе
    const fieldError = document.getElementById(`${contact.id}-error`) as HTMLElement
    expect(fieldError.hidden).toBe(false)
    expect(fieldError.textContent).toBe('Контакт — напишите ник вроде @nickname')
    expect(contact.getAttribute('aria-describedby')?.split(' ')).toContain(fieldError.id)
    expect(error.textContent).not.toContain('напишите ник')
    expect(dialog.querySelector('[data-sent]')).toBeNull()
    expect(dialog.open).toBe(true)
    expect((form.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('нет связи — понятная ошибка в окне', async () => {
    const { dialog, link } = mount()
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    startBehaviors(document, { fetch: fetch as unknown as typeof globalThis.fetch })
    click(link)
    dialog
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    const error = dialog.querySelector('[data-form-error]') as HTMLElement
    await vi.waitFor(() => expect(error.hidden).toBe(false))
    expect(error.textContent).toMatch(/нет связи/)
  })

  it('ошибка поля, которого нет в форме, — списком в общей ошибке', async () => {
    const { dialog, link } = mount()
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'validation',
              message: 'Поправьте поля',
              issues: [{ path: 'promo', message: 'Промокод не подошёл' }],
            },
          }),
          { status: 400 },
        ),
    )
    startBehaviors(document, { fetch: fetch as unknown as typeof globalThis.fetch })
    click(link)
    dialog
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    const error = dialog.querySelector('[data-form-error]') as HTMLElement
    await vi.waitFor(() => expect(error.hidden).toBe(false))
    expect(error.querySelector('li')?.textContent).toBe('Промокод не подошёл')
  })

  it('браузер без showModal: окно атрибутом open, затемнение своим элементом, клик по нему закрывает', () => {
    const { dialog, link } = mount()
    Object.defineProperty(dialog, 'showModal', { value: undefined, configurable: true })
    Object.defineProperty(dialog, 'close', { value: undefined, configurable: true })
    startBehaviors(document, {})
    const main = document.querySelector('main') as HTMLElement
    main.insertAdjacentHTML('afterend', '<footer id="hidden-before" aria-hidden="true"></footer>')
    click(link)
    expect(dialog.hasAttribute('open')).toBe(true)
    // Неизвестный старому браузеру <dialog> — с ролью, иначе aria-modal диктор не заметит;
    // остальная страница скрыта от диктора и фокуса
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(main.getAttribute('aria-hidden')).toBe('true')
    expect(main.hasAttribute('inert')).toBe(true)
    expect(dialog.hasAttribute('aria-hidden')).toBe(false)
    const shade = document.querySelector('[data-site-window-shade]') as Element
    expect(shade).not.toBeNull()
    expect(shade.hasAttribute('inert')).toBe(false)
    click(shade)
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(dialog.hasAttribute('role')).toBe(false)
    expect(main.hasAttribute('aria-hidden')).toBe(false)
    expect(main.hasAttribute('inert')).toBe(false)
    // Уже скрытое до окна скрытым и осталось
    expect(document.getElementById('hidden-before')?.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('[data-site-window-shade]')).toBeNull()
    expect(document.activeElement).toBe(link)
  })

  it('браузер без showModal: Tab и Shift+Tab на краях не выпускают фокус, Esc закрывает без cancel', () => {
    const { dialog, link } = mount()
    Object.defineProperty(dialog, 'showModal', { value: undefined, configurable: true })
    Object.defineProperty(dialog, 'close', { value: undefined, configurable: true })
    const cancel = vi.fn()
    dialog.addEventListener('cancel', cancel)
    startBehaviors(document, {})
    link.focus()
    click(link)
    const press = (key: string, shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
      ;(document.activeElement ?? document).dispatchEvent(event)
      return event
    }
    const items = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([type="hidden"]):not([tabindex="-1"]), select, textarea',
      ),
    ).filter((element) => !element.closest('[hidden]'))
    const first = items[0] as HTMLElement
    const last = items[items.length - 1] as HTMLElement
    // С последнего вперёд — на первый; с первого назад — на последний
    last.focus()
    expect(press('Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
    expect(press('Tab', true).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
    // Фокус ушёл за окно (клик мимо) — Tab возвращает внутрь
    link.focus()
    press('Tab')
    expect(dialog.contains(document.activeElement)).toBe(true)
    // В середине Tab браузерный
    if (items.length > 2) {
      ;(items[1] as HTMLElement).focus()
      expect(press('Tab').defaultPrevented).toBe(false)
    }
    expect(press('Escape').defaultPrevented).toBe(true)
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(link)
    // Закрытое окно клавиши больше не ловит
    expect(press('Tab').defaultPrevented).toBe(false)
  })

  it('ошибка, закрыли окно, открыли снова — без старой ошибки и отметок, введённое на месте', async () => {
    const { dialog, link } = mount()
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'validation',
              message: 'Поправьте поля',
              issues: [{ path: 'contact', message: 'Контакт — напишите ник' }],
            },
          }),
          { status: 400 },
        ),
    )
    startBehaviors(document, { fetch: fetch as unknown as typeof globalThis.fetch })
    click(link)
    const form = dialog.querySelector('form') as HTMLFormElement
    const contact = form.elements.namedItem('contact') as HTMLInputElement
    contact.value = 'abcdefgh'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    const error = dialog.querySelector('[data-form-error]') as HTMLElement
    await vi.waitFor(() => expect(error.hidden).toBe(false))
    const cancel = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancel)
    click(link)
    expect(error.hidden).toBe(true)
    expect(error.textContent).toBe('')
    expect(contact.hasAttribute('aria-invalid')).toBe(false)
    const fieldError = document.getElementById(`${contact.id}-error`) as HTMLElement
    expect(fieldError.hidden).toBe(true)
    expect(fieldError.textContent).toBe('')
    expect(contact.hasAttribute('aria-describedby')).toBe(false)
    expect(contact.value).toBe('abcdefgh')
  })

  it('пункт меню телефона в закрытом details: фокус после окна — на «Меню», а не на body', () => {
    const { dialog } = mount({
      extra:
        '<details id="menu" open><summary id="burger">Меню</summary><a id="item" href="/zapis/" data-av-window>Запись</a></details>',
    })
    startBehaviors(document, {})
    const item = document.getElementById('item') as HTMLElement
    item.focus()
    click(item)
    // Скрипт шапки закрывает меню по клику на пункт
    document.getElementById('menu')?.removeAttribute('open')
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(document.activeElement?.id).toBe('burger')
  })

  it('адрес ссылки → страница так же, как в схеме', () => {
    for (const path of ['/', '/zapis', '/zapis/', '/a-b-1/', '/a/b/', '/Zapis/', '']) {
      expect(windowSlugOfPath(path), path).toBe(pageSlugOfHref(path))
    }
  })
})

describe('поведения', () => {
  /** Наблюдатель-заглушка: тест сам говорит, какой элемент стал виден */
  function fakeObserver() {
    const observers: { callback: IntersectionObserverCallback; observed: Element[] }[] = []
    class Observer {
      observed: Element[] = []
      constructor(callback: IntersectionObserverCallback) {
        observers.push({ callback, observed: this.observed })
      }
      observe(element: Element) {
        this.observed.push(element)
      }
      unobserve() {}
      disconnect() {}
    }
    return {
      IntersectionObserver: Observer as unknown as typeof IntersectionObserver,
      show(element: Element) {
        for (const observer of observers) {
          if (!observer.observed.includes(element)) continue
          observer.callback(
            [{ target: element, isIntersecting: true } as unknown as IntersectionObserverEntry],
            { unobserve() {} } as unknown as IntersectionObserver,
          )
        }
      },
    }
  }

  /** Элементы с «местом» на странице: top задаёт getBoundingClientRect */
  function place(html: string, tops: Record<string, number>) {
    document.body.innerHTML = html
    for (const [id, top] of Object.entries(tops)) {
      const element = document.getElementById(id) as Element
      element.getBoundingClientRect = () => ({ top }) as DOMRect
    }
  }

  const env = (
    observer: ReturnType<typeof fakeObserver>,
    reduce = false,
  ): BehaviorsEnvironment => ({
    IntersectionObserver: observer.IntersectionObserver,
    matchMedia: motion(reduce),
    innerHeight: 800,
  })

  it('появление: прячется только то, что ниже экрана, и появляется, когда его стало видно', () => {
    place('<p id="top" data-av-reveal>1</p><p id="low" data-av-reveal="fade">2</p>', {
      top: 100,
      low: 1500,
    })
    const observer = fakeObserver()
    startBehaviors(document, env(observer))
    const top = document.getElementById('top') as Element
    const low = document.getElementById('low') as Element
    expect(top.hasAttribute('data-av-pending')).toBe(false)
    expect(low.hasAttribute('data-av-pending')).toBe(true)
    // Видимое сразу не анимируется; дождавшееся прокрутки — анимацией (data-av-shown)
    expect(top.hasAttribute('data-av-shown')).toBe(false)
    observer.show(low)
    expect(low.hasAttribute('data-av-pending')).toBe(false)
    expect(low.hasAttribute('data-av-shown')).toBe(true)
  })

  it('строка у самого низа: не пересеклась с суженной областью, но докрутили до упора — видна', () => {
    place(
      '<footer><p id="copy" data-av-reveal>©</p><span id="line" data-av-draw>т</span></footer>',
      {
        copy: 1500,
        line: 1500,
      },
    )
    const root = document.scrollingElement ?? document.documentElement
    Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 2300 })
    Object.defineProperty(root, 'scrollTop', { configurable: true, writable: true, value: 0 })
    const observer = fakeObserver()
    startBehaviors(document, env(observer))
    const copy = document.getElementById('copy') as Element
    const line = document.getElementById('line') as Element
    expect(copy.hasAttribute('data-av-pending')).toBe(true)
    // Прокрутили не до конца — строка ниже экрана и ждёт дальше
    root.scrollTop = 1000
    copy.getBoundingClientRect = () => ({ top: 500 + 800 }) as DOMRect
    document.dispatchEvent(new Event('scroll'))
    expect(copy.hasAttribute('data-av-pending')).toBe(true)
    // До упора: верх строки в нижних 10% экрана (наблюдатель молчит), а она всё равно видна
    root.scrollTop = 1500
    for (const element of [copy, line]) {
      element.getBoundingClientRect = () => ({ top: 770 }) as DOMRect
    }
    document.dispatchEvent(new Event('scroll'))
    expect(copy.hasAttribute('data-av-pending')).toBe(false)
    expect(copy.hasAttribute('data-av-shown')).toBe(true)
    expect(line.hasAttribute('data-av-pending')).toBe(false)
    Reflect.deleteProperty(root, 'scrollHeight')
    Reflect.deleteProperty(root, 'scrollTop')
  })

  it('«уменьшить движение» и браузер без IntersectionObserver — ничего не прячется', () => {
    place('<p id="low" data-av-reveal>2</p><span id="line" data-av-draw>т</span>', {
      low: 1500,
      line: 1500,
    })
    startBehaviors(document, env(fakeObserver(), true))
    expect(document.querySelector('[data-av-pending]')).toBeNull()
    startBehaviors(document, { matchMedia: motion(false), innerHeight: 800 })
    expect(document.querySelector('[data-av-pending]')).toBeNull()
  })

  it('рисование SVG: у линий pathLength, рисуется, когда стало видно', () => {
    place('<svg id="draw" data-av-draw="svg"><path d="M0 0L9 9"/></svg>', { draw: 1200 })
    const observer = fakeObserver()
    startBehaviors(document, env(observer))
    const draw = document.getElementById('draw') as Element
    expect(draw.querySelector('path')?.getAttribute('pathLength')).toBe('1')
    expect(draw.hasAttribute('data-av-armed')).toBe(true)
    expect(draw.hasAttribute('data-av-pending')).toBe(true)
    observer.show(draw)
    expect(draw.hasAttribute('data-av-pending')).toBe(false)
  })

  it('рисование видного сразу: сначала «не нарисовано» без перехода, переход — уже от 0 %', () => {
    place('<span id="line" data-av-draw>т</span>', { line: 100 })
    const line = document.getElementById('line') as Element
    // Что стояло на элементе, когда скрипт впервые пересчитал стиль
    const flushed: string[] = []
    line.getBoundingClientRect = () => {
      flushed.push(`${line.hasAttribute('data-av-pending')}/${line.hasAttribute('data-av-armed')}`)
      return { top: 100 } as DOMRect
    }
    const frames: (() => void)[] = []
    startBehaviors(document, {
      ...env(fakeObserver()),
      requestAnimationFrame: (callback) => frames.push(callback),
    })
    // «Не нарисовано» (pending) пересчитано без перехода (armed ещё нет)
    expect(flushed[0]).toBe('true/false')
    expect(line.hasAttribute('data-av-armed')).toBe(true)
    expect(line.hasAttribute('data-av-pending')).toBe(true)
    while (frames.length > 0) frames.shift()?.()
    expect(line.hasAttribute('data-av-pending')).toBe(false)
  })

  it('подсказка — один раз, когда элемент стало видно', () => {
    place('<div id="card" data-av-hint="flip">к</div>', { card: 300 })
    const observer = fakeObserver()
    startBehaviors(document, env(observer))
    const card = document.getElementById('card') as Element
    expect(card.hasAttribute('data-av-hinted')).toBe(false)
    observer.show(card)
    expect(card.hasAttribute('data-av-hinted')).toBe(true)
  })

  it('плавный details: раскрытие анимацией, сворачивание — после неё; без animate — обычный', () => {
    document.body.innerHTML =
      '<details data-av-details><summary>Вопрос</summary><p>Ответ</p></details>'
    const details = document.querySelector('details') as HTMLDetailsElement
    const summary = details.querySelector('summary') as HTMLElement
    const animations: { onfinish: (() => void) | null; oncancel: (() => void) | null }[] = []
    details.animate = vi.fn(() => {
      const animation = { onfinish: null, oncancel: null }
      animations.push(animation)
      return animation as unknown as Animation
    })
    startBehaviors(document, { matchMedia: motion(false) })
    expect(click(summary).defaultPrevented).toBe(true)
    expect(details.open).toBe(true)
    animations[0]?.onfinish?.()
    click(summary)
    // Пока идёт анимация сворачивания, ответ ещё виден
    expect(details.open).toBe(true)
    animations[1]?.onfinish?.()
    expect(details.open).toBe(false)
  })

  it('плавный details: клик посреди анимации пропущен — браузер не переключит details рывком', () => {
    const doc = document.implementation.createHTMLDocument('')
    doc.body.innerHTML = '<details data-av-details><summary>Вопрос</summary><p>Ответ</p></details>'
    const details = doc.querySelector('details') as HTMLDetailsElement
    const summary = doc.querySelector('summary') as HTMLElement
    details.animate = vi.fn(() => ({ onfinish: null, oncancel: null }) as unknown as Animation)
    startBehaviors(doc, { matchMedia: motion(false) })
    summary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(details.open).toBe(true)
    const second = new MouseEvent('click', { bubbles: true, cancelable: true })
    summary.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(true)
    expect(details.animate).toHaveBeenCalledTimes(1)
  })

  it('плавный details при «уменьшить движение» — обычный', () => {
    // Свой документ: слушатели прошлых тестов остались на общем
    const doc = document.implementation.createHTMLDocument('')
    doc.body.innerHTML = '<details data-av-details><summary>Вопрос</summary><p>Ответ</p></details>'
    const details = doc.querySelector('details') as HTMLDetailsElement
    details.animate = vi.fn()
    startBehaviors(doc, { matchMedia: motion(true) })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    doc.querySelector('summary')?.dispatchEvent(event)
    expect(details.animate).not.toHaveBeenCalled()
  })
})

describe('стили поведений', () => {
  // Строкой, а не new URL: в окружении happy-dom URL — его собственный
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../base.css'), 'utf8')
  const keyframes = (name: string) =>
    css.slice(
      css.indexOf(`@keyframes ${name}`),
      css.indexOf('}\n}', css.indexOf(`@keyframes ${name}`)),
    )

  it('подсказка не трогает transform: наклон карточки остаётся, с появлением складывается', () => {
    for (const name of ['av-hint-flip', 'av-hint-wiggle']) {
      expect(keyframes(name), name).toContain('rotate:')
      expect(keyframes(name), name).not.toContain('transform')
    }
  })

  it('появление и подсказка у одного элемента — обе анимации списком, появление не обрывается', () => {
    for (const hint of ['flip', 'wiggle']) {
      const selector = `[data-av-reveal][data-av-shown][data-av-hint="${hint}"][data-av-hinted]`
      const start = css.indexOf(selector)
      expect(start, hint).toBeGreaterThan(-1)
      const rule = css.slice(start, css.indexOf('}', start))
      expect(rule).toContain('av-reveal ')
      expect(rule).toContain(`av-hint-${hint} `)
    }
  })
})
