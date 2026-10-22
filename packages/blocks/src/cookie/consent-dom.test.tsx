// @vitest-environment happy-dom
import { type CookieLook, type CookieMode, CookieSettings } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CookieNotice, LegalFooter } from './CookieNotice'
import { startCookieConsent } from './consent-dom'
import { cookieNoticeView } from './view'

// Браузерная часть уведомления на настоящей разметке CookieNotice. Главное — старые браузеры
// (iOS до 15.4): там нет ни глобального HTMLDialogElement, ни showModal и close у <dialog>, и
// уведомление обязано работать атрибутом open и своей ловушкой фокуса

/** Страница сайта: содержимое, подвал и уведомление — как их собирает рендерер */
function mount(
  look: CookieLook,
  mode: CookieMode = 'consent',
  policyPage = 'privacy',
  analytics = { metrika: '98765432', ga4: '' },
) {
  const { notice, footer } = cookieNoticeView(
    {
      cookies: CookieSettings.parse({ look, mode, policyPage }),
      analytics,
    },
    ['index', 'privacy'],
  )
  document.body.innerHTML = renderToStaticMarkup(
    <>
      <main>
        <a href="/">Главная</a>
      </main>
      <LegalFooter {...footer} />
      {notice && <CookieNotice {...notice} />}
    </>,
  )
  startCookieConsent(document)
  return {
    root: required(document.querySelector<HTMLElement>('[data-cookie-consent]')),
    notice: required(document.querySelector<HTMLElement>('[data-consent-notice]')),
    /** Окно настроек: только в режиме согласия */
    settings: () => required(document.querySelector<HTMLElement>('[data-consent-settings]')),
  }
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('нет элемента')
  return value
}

const button = (scope: ParentNode, action: string) =>
  required(scope.querySelector<HTMLElement>(`[data-consent-action="${action}"]`))

const key = (target: Element, name: string, shiftKey = false) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true }))

const counters = () =>
  Array.from(document.head.querySelectorAll('script')).map((script) => script.src)

/** Cookie страницы — так же, как их пишет скрипт сайта */
const setCookie = (cookie: string) => {
  // biome-ignore lint/suspicious/noDocumentCookie: скрипт сайта пишет document.cookie (Cookie Store API в старых Safari нет) — тест делает то же
  document.cookie = cookie
}

const isOpen = (element: Element) => element.hasAttribute('open')

type DialogGlobal = { HTMLDialogElement?: typeof HTMLDialogElement }

/**
 * Браузер без <dialog>: убрать глобальный HTMLDialogElement и его showModal и close. Возвращает
 * функцию, которая всё вернёт
 */
function withoutDialogApi() {
  const global = globalThis as DialogGlobal
  const Dialog = global.HTMLDialogElement
  if (!Dialog) throw new Error('в happy-dom должен быть HTMLDialogElement')
  const proto = Dialog.prototype
  const showModal = Object.getOwnPropertyDescriptor(proto, 'showModal')
  const close = Object.getOwnPropertyDescriptor(proto, 'close')
  Reflect.deleteProperty(proto, 'showModal')
  Reflect.deleteProperty(proto, 'close')
  Reflect.deleteProperty(global, 'HTMLDialogElement')
  expect('HTMLDialogElement' in globalThis).toBe(false)
  return () => {
    if (showModal) Object.defineProperty(proto, 'showModal', showModal)
    if (close) Object.defineProperty(proto, 'close', close)
    global.HTMLDialogElement = Dialog
  }
}

/**
 * Настройки поверх «окна по центру»: Tab и Esc — только у верхнего окна. Иначе Esc закрыл бы и
 * уведомление под настройками, и посетитель ушёл бы без выбора
 */
function stackedWindows() {
  const { notice, settings: settingsOf } = mount('modal')
  const settings = settingsOf()
  const opener = button(notice, 'settings')
  opener.focus()
  opener.click()
  expect(isOpen(settings)).toBe(true)
  expect(isOpen(notice)).toBe(true)

  const focusables = Array.from(
    settings.querySelectorAll<HTMLElement>('a[href], button, input'),
  ).filter((element) => !element.closest('[hidden]'))
  const first = required(focusables[0])
  const last = required(focusables.at(-1))
  expect(document.activeElement).toBe(first)
  last.focus()
  key(last, 'Tab')
  expect(document.activeElement).toBe(first)
  key(first, 'Tab', true)
  expect(document.activeElement).toBe(last)

  key(settings, 'Escape')
  expect(isOpen(settings)).toBe(false)
  expect(isOpen(notice)).toBe(true)
  expect(document.activeElement).toBe(opener)
  expect(document.cookie).not.toContain('averra_consent')

  // Теперь верхнее — уведомление: следующий Esc закрывает его
  key(notice, 'Escape')
  expect(isOpen(notice)).toBe(false)
}

let restore: (() => void) | undefined

type HappyDomWindow = { happyDOM?: { settings: { handleDisabledFileLoadingAsSuccess: boolean } } }

beforeAll(() => {
  // Счётчики не скачиваются (happy-dom не грузит скрипты), и без ошибки в выводе: важен <script>
  const happyDOM = (window as unknown as HappyDomWindow).happyDOM
  if (happyDOM) happyDOM.settings.handleDisabledFileLoadingAsSuccess = true
})

afterEach(() => {
  restore?.()
  restore = undefined
  vi.restoreAllMocks()
  setCookie('averra_consent=; Max-Age=0; Path=/')
  setCookie('_ym_uid=; Max-Age=0; Path=/')
  localStorage.clear()
  sessionStorage.clear()
  for (const script of document.head.querySelectorAll('script')) script.remove()
  Reflect.deleteProperty(window, 'ym')
  document.body.innerHTML = ''
})

describe('старый браузер без <dialog> (iOS до 15.4)', () => {
  it('карточка: уведомление видно, «Принять все» грузит Метрику и запоминает выбор', () => {
    restore = withoutDialogApi()
    const { root, notice } = mount('card')
    expect(root.hidden).toBe(false)
    expect(notice.hidden).toBe(false)
    expect(counters()).toEqual([])

    button(notice, 'all').click()
    expect(notice.hidden).toBe(true)
    expect(document.cookie).toContain('averra_consent=analytics')
    expect(counters()).toEqual(['https://mc.yandex.ru/metrika/tag.js'])
    // Очередь Метрики — объекты arguments, как в её официальном коде
    const ym = (window as Window & { ym?: { a?: unknown[] } }).ym
    expect(Object.prototype.toString.call(ym?.a?.[0])).toBe('[object Arguments]')
    expect(Array.from(ym?.a?.[0] as ArrayLike<unknown>).slice(0, 2)).toEqual([98765432, 'init'])
  })

  it('окно настроек открывается атрибутом open: фокус внутри, Tab по кругу, Esc и возврат фокуса', () => {
    restore = withoutDialogApi()
    const { root, notice, settings: settingsOf } = mount('card')
    const settings = settingsOf()
    const opener = button(notice, 'settings')
    opener.focus()
    opener.click()
    expect(isOpen(settings)).toBe(true)
    expect(root.hasAttribute('data-modal-open')).toBe(true)
    expect(root.hasAttribute('data-settings-open')).toBe(true)

    const focusables = Array.from(
      settings.querySelectorAll<HTMLElement>('a[href], button, input'),
    ).filter((element) => !element.closest('[hidden]'))
    const first = required(focusables[0])
    const last = required(focusables.at(-1))
    expect(document.activeElement).toBe(first)
    last.focus()
    key(last, 'Tab')
    expect(document.activeElement).toBe(first)
    key(first, 'Tab', true)
    expect(document.activeElement).toBe(last)

    key(settings, 'Escape')
    expect(isOpen(settings)).toBe(false)
    expect(root.hasAttribute('data-modal-open')).toBe(false)
    expect(root.hasAttribute('data-settings-open')).toBe(false)
    expect(document.activeElement).toBe(opener)
    expect(counters()).toEqual([])
  })

  it('окно по центру: открыто атрибутом open, «Только необходимые» — без счётчика', () => {
    restore = withoutDialogApi()
    const { root, notice } = mount('modal')
    expect(notice.tagName).toBe('DIALOG')
    expect(isOpen(notice)).toBe(true)
    expect(root.hasAttribute('data-modal-open')).toBe(true)
    // Фокус — на самом окне, а не на ссылке политики: первое Enter не уводит со страницы
    expect(document.activeElement).toBe(notice)
    key(notice, 'Tab')
    expect(document.activeElement).toBe(notice.querySelector('a[href]'))

    button(notice, 'necessary').click()
    expect(isOpen(notice)).toBe(false)
    expect(root.hasAttribute('data-modal-open')).toBe(false)
    expect(document.cookie).toContain('averra_consent=necessary')
    expect(counters()).toEqual([])
  })

  it('«Настройки cookie» внизу страницы снова открывают окно, включённая аналитика грузит счётчик', () => {
    restore = withoutDialogApi()
    setCookie('averra_consent=necessary; Path=/')
    const { notice, settings: settingsOf } = mount('bar')
    const settings = settingsOf()
    expect(notice.hidden).toBe(true)
    const link = required(document.querySelector<HTMLElement>('[data-consent-open]'))
    expect(link.hidden).toBe(false)

    link.click()
    expect(isOpen(settings)).toBe(true)
    const analytics = required(settings.querySelector<HTMLInputElement>('input[name="analytics"]'))
    expect(analytics.checked).toBe(false)
    analytics.checked = true
    button(settings, 'save').click()
    expect(isOpen(settings)).toBe(false)
    expect(document.cookie).toContain('averra_consent=analytics')
    expect(counters()).toEqual(['https://mc.yandex.ru/metrika/tag.js'])
  })
  it('фокус ушёл за окно (клик по затемнению — на body): Tab возвращает его, Esc закрывает', () => {
    restore = withoutDialogApi()
    const { notice, settings: settingsOf } = mount('card')
    const settings = settingsOf()
    button(notice, 'settings').click()
    expect(settings.getAttribute('aria-modal')).toBe('true')
    const focusables = Array.from(
      settings.querySelectorAll<HTMLElement>('a[href], button, input'),
    ).filter((element) => !element.closest('[hidden]'))

    // Без showModal фон не инертен: фокус на body, клавиши жмут уже не в окне
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    key(document.body, 'Tab')
    expect(document.activeElement).toBe(focusables[0])
    ;(document.activeElement as HTMLElement | null)?.blur()
    key(document.body, 'Tab', true)
    expect(document.activeElement).toBe(focusables.at(-1))

    // Фокус на ссылку уведомления за окном (диктор, скрипт) — возвращается в окно
    required(notice.querySelector<HTMLElement>('a[href]')).focus()
    expect(settings.contains(document.activeElement)).toBe(true)

    ;(document.activeElement as HTMLElement | null)?.blur()
    key(document.body, 'Escape')
    expect(isOpen(settings)).toBe(false)
    expect(settings.hasAttribute('aria-modal')).toBe(false)
    // Окно закрыто — ловушки нет: Tab по странице не перехватывается
    const outside = required(document.querySelector<HTMLElement>('main a'))
    outside.focus()
    expect(document.activeElement).toBe(outside)
  })

  it('отзыв согласия стирает следы счётчика в cookie и хранилище и перезагружает страницу', () => {
    restore = withoutDialogApi()
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    setCookie('averra_consent=analytics.ym; Path=/')
    setCookie('_ym_uid=1700000000123; Path=/')
    localStorage.setItem('_ym_uid', '"1700000000123"')
    localStorage.setItem('averra_draft', 'чужое')
    sessionStorage.setItem('_ym98765432_lsid', '1')
    const { settings: settingsOf } = mount('bar')
    expect(counters()).toEqual(['https://mc.yandex.ru/metrika/tag.js'])

    required(document.querySelector<HTMLElement>('[data-consent-open]')).click()
    const settings = settingsOf()
    const analytics = required(settings.querySelector<HTMLInputElement>('input[name="analytics"]'))
    expect(analytics.checked).toBe(true)
    analytics.checked = false
    button(settings, 'save').click()

    expect(document.cookie).toContain('averra_consent=necessary')
    expect(document.cookie).not.toContain('_ym_uid')
    expect(localStorage.getItem('_ym_uid')).toBeNull()
    expect(sessionStorage.getItem('_ym98765432_lsid')).toBeNull()
    expect(localStorage.getItem('averra_draft')).toBe('чужое')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('настройки поверх окна по центру: Esc и Tab — только у настроек', () => {
    restore = withoutDialogApi()
    stackedWindows()
  })

  it('политика не опубликована: подвал с одной «Настройки cookie» показывает скрипт', () => {
    restore = withoutDialogApi()
    mount('card', 'consent', '')
    const footer = required(document.querySelector<HTMLElement>('[data-legal-footer]'))
    expect(footer.hidden).toBe(false)
    expect(required(footer.querySelector<HTMLElement>('[data-consent-open]')).hidden).toBe(false)
  })
})

describe('современный браузер', () => {
  it('настройки поверх окна по центру: Esc и Tab — только у настроек', () => {
    stackedWindows()
  })

  it('окно по центру — showModal, Esc закрывает без выбора', () => {
    const { notice } = mount('modal')
    expect(isOpen(notice)).toBe(true)
    key(notice, 'Escape')
    expect(isOpen(notice)).toBe(false)
    expect(document.cookie).not.toContain('averra_consent')
  })

  it('режим уведомления: «Понятно», без «Настроек cookie» и без счётчиков от скрипта', () => {
    const { notice } = mount('card', 'notice')
    expect(notice.hidden).toBe(false)
    expect(document.querySelector('[data-consent-settings]')).toBeNull()
    expect(document.querySelector('[data-consent-open]')).toBeNull()
    button(notice, 'ok').click()
    expect(notice.hidden).toBe(true)
    expect(document.cookie).toContain('averra_consent=notice.ym')
    expect(counters()).toEqual([])
  })

  it('режим уведомления: «Понятно» помнит Метрику, добавили GA4 — уведомление снова', () => {
    button(mount('card', 'notice').notice, 'ok').click()
    expect(document.cookie).toContain('averra_consent=notice.ym')
    expect(mount('card', 'notice').notice.hidden).toBe(true)
    const withGa4 = mount('card', 'notice', 'privacy', { metrika: '98765432', ga4: 'G-ABCD1234' })
    expect(withGa4.notice.hidden).toBe(false)
    button(withGa4.notice, 'ok').click()
    expect(document.cookie).toContain('averra_consent=notice.ym.ga')
    expect(counters()).toEqual([])
  })
})
