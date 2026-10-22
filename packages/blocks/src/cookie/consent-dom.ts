import {
  analyticsStorageKeys,
  type ConsentMode,
  type ConsentPorts,
  createConsent,
  forgetCookies,
} from './consent'

// Браузерная часть cookie-уведомления: находит разметку CookieNotice, вешает кнопки, открывает
// окно и вставляет счётчики. Без фреймворков и внешних загрузок; что делать — решает consent.ts.
// Работает и в старых браузерах: <dialog> без showModal (iOS до 15.4) открывается атрибутом open,
// а фокус внутри держит своя ловушка. Глобального HTMLDialogElement там нет вовсе, поэтому окно
// узнаём по тегу, а методы dialog проверяем перед вызовом

/** Корень уведомления на странице: его ищет скрипт */
export const CONSENT_ROOT_SELECTOR = '[data-cookie-consent]'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

type AnyFunction = (...args: unknown[]) => void
type AnalyticsWindow = Window & {
  ym?: AnyFunction & { a?: IArguments[]; l?: number }
  dataLayer?: unknown[]
  gtag?: AnyFunction
}

function insertScript(doc: Document, src: string) {
  const script = doc.createElement('script')
  script.async = true
  script.src = src
  doc.head.append(script)
}

/**
 * Метрика и GA4 — те же вызовы, что в их официальных кодах, только номер — проверенный.
 * Вебвизор выключен: он записывает, что посетитель вводит в форму
 */
export function loadAnalytics(doc: Document, ids: { metrika: string; ga4: string }) {
  const win = doc.defaultView as AnalyticsWindow | null
  if (!win) return
  if (ids.metrika !== '') {
    let ym = win.ym
    if (!ym) {
      // Как в официальном коде Метрики: очередь вызовов — объекты arguments, их разбирает tag.js
      const stub = function ym() {
        stub.a = stub.a ?? []
        // biome-ignore lint/complexity/noArguments: формат очереди ym.a — объект arguments
        stub.a.push(arguments)
      } as NonNullable<AnalyticsWindow['ym']>
      stub.l = Date.now()
      ym = stub
      win.ym = stub
    }
    insertScript(doc, 'https://mc.yandex.ru/metrika/tag.js')
    ym(Number(ids.metrika), 'init', {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
    })
  }
  if (ids.ga4 !== '') {
    const dataLayer = win.dataLayer ?? []
    win.dataLayer = dataLayer
    // gtag ждёт в dataLayer объект arguments, а не массив: так его код отличает вызовы от данных
    const gtag: AnyFunction = function gtag() {
      // biome-ignore lint/complexity/noArguments: формат dataLayer у gtag — объект arguments
      dataLayer.push(arguments)
    }
    win.gtag = gtag
    gtag('js', new Date())
    gtag('config', ids.ga4)
    insertScript(doc, `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids.ga4)}`)
  }
}

/** <dialog>; в старых браузерах — элемент без showModal и close */
type DialogElement = HTMLElement & { showModal?: () => void; close?: () => void }

type Modal = {
  open: (opener: Element | null) => void
  close: () => void
  isOpen: () => boolean
}

/**
 * Модальное окно на <dialog>: showModal, где он есть (фон недоступен, окно поверх всего), иначе
 * атрибут open. Фокус переходит внутрь и не выходит по Tab, Esc закрывает, после закрытия фокус
 * возвращается туда, откуда окно открыли
 */
function modal(
  root: HTMLElement,
  dialog: DialogElement,
  onEscape: () => void,
  onToggle: (open: boolean) => void = () => {},
): Modal {
  let opener: HTMLElement | null = null
  const focusables = () =>
    Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => !element.closest('[hidden]'),
    )
  const isOpen = () => dialog.hasAttribute('open')

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onEscape()
      return
    }
    if (event.key !== 'Tab') return
    const items = focusables()
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    const active = dialog.ownerDocument.activeElement
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  })
  // Закрытие средствами браузера (кнопка «назад» на Android) — тем же путём, что Esc
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    onEscape()
  })

  return {
    isOpen,
    open(from) {
      if (isOpen()) return
      opener = from instanceof HTMLElement ? from : null
      root.setAttribute('data-modal-open', '')
      onToggle(true)
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      focusables()[0]?.focus()
    },
    close() {
      if (!isOpen()) return
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      onToggle(false)
      if (!root.querySelector('dialog[open]')) root.removeAttribute('data-modal-open')
      // Кнопка, которая открыла окно, могла пропасть (уведомление скрыто) — тогда фокус на body
      if (opener?.isConnected && !opener.closest('[hidden]')) opener.focus()
      opener = null
    },
  }
}

/** Стереть ключи счётчиков из localStorage и sessionStorage. Хранилище бывает недоступно */
function forgetStorage(win: Window) {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = win[name]
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '')
      for (const key of analyticsStorageKeys(keys)) storage.removeItem(key)
    } catch {
      // Хранилище запрещено настройками браузера: счётчик туда тоже ничего не записал
    }
  }
}

/** Запустить уведомление на странице. Нет разметки — ничего не делает */
export function startCookieConsent(doc: Document = document) {
  const root = doc.querySelector<HTMLElement>(CONSENT_ROOT_SELECTOR)
  const win = doc.defaultView
  if (!root || !win) return undefined
  const mode: ConsentMode = root.dataset.mode === 'notice' ? 'notice' : 'consent'
  const notice = root.querySelector<HTMLElement>('[data-consent-notice]')
  const settings = root.querySelector<DialogElement>('dialog[data-consent-settings]')
  const analyticsSwitch = settings?.querySelector<HTMLInputElement>('input[name="analytics"]')
  if (!notice) return undefined

  // Корень без JS скрыт целиком: уведомление показывает только скрипт
  root.hidden = false
  let lastFocus: Element | null = null
  // Вид «окно по центру» — <dialog>. По тегу, а не instanceof: в iOS до 15.4 HTMLDialogElement нет
  const noticeModal =
    notice.tagName === 'DIALOG' ? modal(root, notice, () => noticeModal?.close()) : null
  // Пока открыто окно настроек, уведомление под ним приглушено (CSS по data-settings-open)
  const settingsModal = settings
    ? modal(
        root,
        settings,
        () => settingsModal?.close(),
        (open) => root.toggleAttribute('data-settings-open', open),
      )
    : null

  const ports: ConsentPorts = {
    readCookies: () => doc.cookie,
    writeCookie: (cookie) => {
      doc.cookie = cookie
    },
    loadAnalytics: (ids) => loadAnalytics(doc, ids),
    forgetAnalytics: () => {
      for (const cookie of forgetCookies(doc.cookie, win.location.hostname)) doc.cookie = cookie
      forgetStorage(win)
      win.location.reload()
    },
    showNotice: () => {
      if (noticeModal) noticeModal.open(doc.activeElement)
      else notice.hidden = false
    },
    hideNotice: () => {
      if (noticeModal) noticeModal.close()
      else notice.hidden = true
    },
    openSettings: (analytics) => {
      if (!settingsModal || !analyticsSwitch) return
      analyticsSwitch.checked = analytics
      settingsModal.open(lastFocus)
    },
    closeSettings: () => settingsModal?.close(),
  }
  const consent = createConsent(
    {
      mode,
      metrika: root.dataset.metrika ?? '',
      ga4: root.dataset.ga4 ?? '',
      secure: win.location.protocol === 'https:',
    },
    ports,
  )

  const actions: Record<string, () => void> = {
    all: consent.acceptAll,
    necessary: consent.necessaryOnly,
    ok: consent.acknowledge,
    settings: consent.openSettings,
    save: () => consent.saveSettings(analyticsSwitch?.checked ?? false),
    close: () => settingsModal?.close(),
  }
  root.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-consent-action]')
    const action = button && actions[button.dataset.consentAction ?? '']
    if (!action) return
    lastFocus = button
    action()
  })
  // «Настройки cookie» внизу страницы: без JS и в режиме уведомления их нет
  if (mode === 'consent' && settingsModal) {
    for (const link of doc.querySelectorAll<HTMLElement>('[data-consent-open]')) {
      link.hidden = false
      link.addEventListener('click', () => {
        lastFocus = link
        consent.openSettings()
      })
    }
  }
  consent.start()
  return consent
}
