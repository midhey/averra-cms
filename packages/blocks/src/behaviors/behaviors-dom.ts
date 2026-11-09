// Скрипт поведений Averra: окна сайта и маленькие эффекты по атрибутам поведений (data-av-reveal
// и другие). Улучшение поверх рабочего HTML: без скрипта ссылка в окно — обычный переход на страницу-окно, карточки видны
// сразу, <details> раскрывается как обычно. Прячет что-то только сам скрипт и только то, что ниже
// экрана, и не прячет ничего, если в системе просили уменьшить движение. Модуль без зависимостей и
// внешних загрузок: Astro собирает его в /_astro/… только на страницы, где есть окно или поведение
// (behaviorsNeeded). Решение — «Решения → Окна и поведения»

/** Что скрипту нужно от окна браузера: в тестах — свои наблюдатель, медиазапрос и fetch */
export type BehaviorsEnvironment = {
  IntersectionObserver?: typeof IntersectionObserver | undefined
  matchMedia?: ((query: string) => { matches: boolean }) | undefined
  requestAnimationFrame?: ((callback: () => void) => unknown) | undefined
  fetch?: typeof fetch | undefined
  innerHeight?: number | undefined
  /** Метрика и GA4, если их вставило cookie-уведомление: цель «заявка» из окна */
  ym?: ((...args: unknown[]) => void) | undefined
  gtag?: ((...args: unknown[]) => void) | undefined
}

/** Узкий экран — окно шторкой снизу (SiteWindows.module.css): там фокус не в поле */
const NARROW_WINDOW = '(max-width: 39.99rem)'

// Ловушка для ботов (tabindex="-1") и скрытые поля в список не входят
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map((selector) => `${selector}:not([tabindex="-1"])`)
  .join(', ')

/**
 * Разметка внутри шаблона своего блока — не наша: шаблон мог бы подложить копию окна. Граница —
 * обёртка HTML шаблона [data-custom-block-root], как у скриптов шапки и cookie-уведомления. Своя
 * копия проверки, а не импорт: скрипт остаётся одним маленьким модулем
 */
const insideTemplate = (element: Element) => element.closest('[data-custom-block-root]') !== null

const toggle = (element: Element, name: string, on: boolean) => {
  if (on) element.setAttribute(name, '')
  else element.removeAttribute(name)
}

/**
 * Страница сайта по адресу ссылки: «/» — главная, «/zapis», «/zapis/» — zapis. Копия
 * pageSlugOfHref из @averra/schema (скрипт без зависимостей), совпадение сверяет тест
 */
export function windowSlugOfPath(pathname: string): string | undefined {
  if (pathname === '/') return 'index'
  return /^\/([a-z0-9-]{1,64})\/?$/.exec(pathname)?.[1]
}

/** Запустить поведения на странице. Нечего делать — ничего не делает */
export function startBehaviors(
  doc: Document = document,
  env: BehaviorsEnvironment = typeof window === 'undefined'
    ? {}
    : (window as unknown as BehaviorsEnvironment),
) {
  startWindows(doc, env)
  // «Уменьшить движение» в системе: эффектов нет вовсе — всё видно и раскрывается сразу
  const calm = env.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (calm) return
  startDetails(doc)
  startOnScreen(doc, env)
}

// ── Окна ────────────────────────────────────────────────────────────────────────────────────────

/** <dialog>; в старых браузерах (iOS до 15.4) — элемент без showModal и close */
type DialogElement = HTMLElement & { showModal?: () => void; close?: () => void }

type OpenWindow = {
  dialog: DialogElement
  opener: HTMLElement | null
  shade: HTMLElement | null
  /** Без showModal — что скрыто от диктора и клавиатуры на время окна (вернуть при закрытии) */
  hidden: HTMLElement[]
}

/**
 * Без showModal фон сам не становится недоступным: VoiceOver старого iPhone свайпом ушёл бы за
 * окно. Прячем от диктора (aria-hidden) и, где браузер умеет, от фокуса (inert) всё, что рядом с
 * окном и выше по дереву, кроме ветки самого окна; уже спрятанное не трогаем
 */
function hideOutside(dialog: HTMLElement, keep: HTMLElement | null) {
  const hidden: HTMLElement[] = []
  let node: HTMLElement | null = dialog
  while (node?.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling === keep || !(sibling instanceof HTMLElement)) continue
      if (sibling.getAttribute('aria-hidden') === 'true' || sibling.hasAttribute('inert')) continue
      if (/^(SCRIPT|STYLE|LINK|META|TEMPLATE)$/.test(sibling.tagName)) continue
      sibling.setAttribute('aria-hidden', 'true')
      sibling.setAttribute('inert', '')
      hidden.push(sibling)
    }
    node = node.parentElement
    if (node.tagName === 'BODY') break
  }
  return hidden
}

/**
 * Окна сайта: ссылка с data-av-window открывает <dialog data-site-window="адрес"> той страницы, на
 * которую ведёт. Окна на странице нет (сборка его не положила, страница не окно) — обычный переход.
 * Ctrl/⌘/Shift/Alt-клик, средняя кнопка и ссылка в новой вкладке — тоже обычный переход: человек
 * хотел страницу
 */
export function startWindows(doc: Document, env: BehaviorsEnvironment) {
  const dialogs = new Map<string, DialogElement>()
  for (const dialog of Array.from(doc.querySelectorAll<DialogElement>('[data-site-window]'))) {
    const slug = dialog.getAttribute('data-site-window') ?? ''
    if (insideTemplate(dialog) || dialog.tagName !== 'DIALOG' || dialogs.has(slug)) continue
    dialogs.set(slug, dialog)
  }
  if (dialogs.size === 0) return
  let current: OpenWindow | null = null
  const root = doc.documentElement

  const focusables = (dialog: HTMLElement) =>
    Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      // Скрытое и форма, которую сменил текст успеха, — не в счёт
      (element) => !element.closest('[hidden], [data-sent] form, [aria-hidden="true"]'),
    )

  function onKeydown(event: KeyboardEvent) {
    if (!current) return
    const { dialog } = current
    if (event.key === 'Escape') {
      // У showModal Esc приходит событием cancel — его ловит слушатель окна
      if (typeof dialog.showModal === 'function') return
      event.preventDefault()
      close()
      return
    }
    // Ловушка фокуса — только без showModal: у него фон и так недоступен
    if (event.key !== 'Tab' || typeof dialog.showModal === 'function') return
    const items = focusables(dialog)
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    const active = doc.activeElement
    const inside = active !== null && dialog.contains(active)
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault()
      first.focus()
    }
  }

  function open(dialog: DialogElement, opener: HTMLElement | null) {
    // Окно из окна: прежнее закрывается, фокус потом вернётся на самую первую кнопку
    const from = current ? current.opener : opener
    if (current) close({ restoreFocus: false })
    let shade: HTMLElement | null = null
    // Полоса прокрутки занимает место (Windows) — CSS оставит его пустым, страница не сдвинется
    const bar = (doc.defaultView?.innerWidth ?? 0) - root.clientWidth > 0
    root.setAttribute('data-window-open', bar ? 'gutter' : '')
    if (typeof dialog.showModal === 'function') {
      dialog.showModal()
    } else {
      // Без showModal: затемнение — свой элемент (клик по нему — как по фону), окно — атрибутом
      shade = doc.createElement('div')
      shade.setAttribute('data-site-window-shade', '')
      shade.addEventListener('click', () => {
        if (dialog.hasAttribute('data-site-window-backdrop')) close()
      })
      dialog.before(shade)
      dialog.setAttribute('open', '')
      dialog.setAttribute('data-site-window-fallback', '')
      // Неизвестный старому браузеру <dialog> — без роли, а aria-modal без role=dialog диктор
      // не замечает
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
    }
    const hidden = shade ? hideOutside(dialog, shade) : []
    current = { dialog, opener: from, shade, hidden }
    doc.addEventListener('keydown', onKeydown)
    // Фокус — на первое поле содержимого (форма), без него — на «Закрыть». На телефоне — на
    // заголовок окна (без него — на «Закрыть»): фокус в поле сразу поднял бы клавиатуру и увёл из
    // виду заголовок и описание формы
    const closeButton = dialog.querySelector<HTMLElement>('[data-site-window-close]')
    const narrow = env.matchMedia?.(NARROW_WINDOW).matches === true
    const content = dialog.querySelector<HTMLElement>('[data-site-window-content]') ?? dialog
    const target = narrow
      ? (dialog.querySelector<HTMLElement>('[data-site-window-title]') ?? closeButton)
      : (focusables(content)[0] ?? closeButton)
    target?.focus()
  }

  function close({ restoreFocus = true } = {}) {
    if (!current) return
    const { dialog, opener, shade, hidden } = current
    current = null
    doc.removeEventListener('keydown', onKeydown)
    if (typeof dialog.close === 'function' && dialog.hasAttribute('open')) dialog.close()
    else dialog.removeAttribute('open')
    dialog.removeAttribute('data-site-window-fallback')
    if (shade) {
      shade.remove()
      dialog.removeAttribute('aria-modal')
      dialog.removeAttribute('role')
    }
    for (const element of hidden) {
      element.removeAttribute('aria-hidden')
      element.removeAttribute('inert')
    }
    root.removeAttribute('data-window-open')
    resetForms(dialog)
    if (restoreFocus && opener?.isConnected) returnFocus(opener)
  }

  doc.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const target = event.target as Element | null
    if (!target || typeof target.closest !== 'function') return
    const link = target.closest<HTMLAnchorElement>('a[data-av-window]')
    if (!link || link.hasAttribute('download')) return
    if (link.target !== '' && link.target !== '_self') return
    let url: URL
    try {
      url = new URL(link.href, doc.baseURI)
    } catch {
      return
    }
    if (url.origin !== doc.location?.origin) return
    const slug = windowSlugOfPath(url.pathname)
    const dialog = slug === undefined ? undefined : dialogs.get(slug)
    if (!dialog?.isConnected) return
    event.preventDefault()
    open(dialog, link)
  })

  for (const dialog of dialogs.values()) {
    // Esc и «назад» на Android закрывают окно — нашим путём: с возвратом фокуса и сбросом формы
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      close()
    })
    // Клик по фону: у showModal это клик по самому <dialog> (содержимое — внутри рамки). Нажатие
    // тоже должно начаться на фоне: выделение текста в форме, отпущенное за окном, его не закроет
    let downOnBackdrop = false
    dialog.addEventListener('pointerdown', (event) => {
      downOnBackdrop = event.target === dialog
    })
    dialog.addEventListener('click', (event) => {
      const target = event.target as Element | null
      if (target?.closest?.('[data-site-window-close]')) {
        close()
        return
      }
      const onBackdrop = target === dialog && downOnBackdrop
      downOnBackdrop = false
      if (onBackdrop && dialog.hasAttribute('data-site-window-backdrop')) close()
    })
    dialog.addEventListener('submit', (event) => {
      const form = event.target as HTMLFormElement | null
      if (form?.tagName !== 'FORM' || !form.action) return
      event.preventDefault()
      void send(form, dialog, env, doc)
    })
  }
}

/**
 * Фокус — обратно на кнопку, открывшую окно. Пункт меню телефона лежит в <details>, который скрипт
 * шапки закрыл по клику: фокус на скрытую ссылку ушёл бы на body, поэтому — на «Меню» (summary)
 */
function returnFocus(opener: HTMLElement) {
  const folded = opener.closest('details:not([open])')
  const summary = folded?.querySelector<HTMLElement>(':scope > summary')
  ;(summary ?? opener).focus()
}

/**
 * Закрытое окно — снова чистая форма: заявку отправили — опять форма; была ошибка — без старого
 * сообщения и отметок полей (введённое остаётся: человек мог закрыть окно случайно)
 */
function resetForms(dialog: HTMLElement) {
  for (const box of Array.from(
    dialog.querySelectorAll<HTMLElement>('[data-form-box][data-sent]'),
  )) {
    box.removeAttribute('data-sent')
    box.querySelector<HTMLFormElement>('form')?.reset()
  }
  for (const error of Array.from(dialog.querySelectorAll<HTMLElement>('[data-form-error]'))) {
    error.hidden = true
    error.textContent = ''
  }
  clearFieldErrors(dialog)
}

/** Ошибки у полей снять: текст, отметку aria-invalid и связь aria-describedby */
function clearFieldErrors(root: ParentNode) {
  for (const error of Array.from(root.querySelectorAll<HTMLElement>('[data-field-error]'))) {
    error.hidden = true
    error.textContent = ''
  }
  for (const field of Array.from(root.querySelectorAll('[aria-invalid="true"]'))) {
    field.removeAttribute('aria-invalid')
    const rest = (field.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id !== '' && id !== `${field.id}-error`)
    if (rest.length > 0) field.setAttribute('aria-describedby', rest.join(' '))
    else field.removeAttribute('aria-describedby')
  }
}

/**
 * Ошибка у самого поля: текст рядом с полем (место от формы, data-field-error) и связь через
 * aria-describedby — поле в фокусе, поэтому сообщение видно и на телефоне, и диктор его прочтёт
 */
function markField(field: HTMLElement, message: string, doc: Document) {
  field.setAttribute('aria-invalid', 'true')
  const error = field.id ? doc.getElementById(`${field.id}-error`) : null
  if (!error?.hasAttribute('data-field-error')) return false
  error.textContent = error.textContent ? `${error.textContent} ${message}` : message
  error.hidden = false
  const ids = (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
  if (!ids.includes(error.id)) field.setAttribute('aria-describedby', [error.id, ...ids].join(' '))
  return true
}

const NETWORK_ERROR =
  'Заявка не отправлена: нет связи с сервером. Проверьте интернет и отправьте ещё раз'

type ApiErrorBody = { error?: { code?: unknown; message?: unknown; issues?: unknown } }

/** Ошибка полей в окне: у API в тексте — про кнопку «Назад», а в окне назад идти не нужно */
const VALIDATION_ERROR = 'Поправьте поля формы и отправьте её снова'

/** Сообщение и ошибки полей из ответа API (ApiError): {error: {message, issues: [{path, message}]}} */
function errorOf(body: unknown) {
  const error = (body as ApiErrorBody | null)?.error
  const message =
    error?.code === 'validation'
      ? VALIDATION_ERROR
      : typeof error?.message === 'string'
        ? error.message
        : undefined
  const issues = Array.isArray(error?.issues)
    ? error.issues.flatMap((issue: unknown) => {
        const { path, message } = (issue ?? {}) as { path?: unknown; message?: unknown }
        return typeof message === 'string' ? [{ path: String(path ?? ''), message }] : []
      })
    : []
  return { message, issues }
}

/**
 * Отправка формы из окна: тот же адрес приёма и то же тело, что у формы без JS, но ответ — JSON
 * (Accept: application/json), и итог показывается в окне. Проверки заявки — те же, на сервере
 */
async function send(
  form: HTMLFormElement,
  dialog: HTMLElement,
  env: BehaviorsEnvironment,
  doc: Document,
) {
  if (form.hasAttribute('data-form-sending')) return
  const doFetch = env.fetch
  if (!doFetch) {
    // Без fetch — обычная отправка: ответ API вернёт на страницу-окно с текстом успеха
    form.submit()
    return
  }
  const box = form.closest<HTMLElement>('[data-form-box]')
  const errorBox = form.querySelector<HTMLElement>('[data-form-error]')
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')
  // Сообщения полей, которые не к чему привязать (поля нет в форме), — списком в общей ошибке
  const showError = (message: string, issues: { path: string; message: string }[] = []) => {
    if (!errorBox) return
    errorBox.textContent = ''
    const text = doc.createElement('p')
    text.textContent = message
    errorBox.append(text)
    if (issues.length > 0) {
      const list = doc.createElement('ul')
      for (const issue of issues) {
        const item = doc.createElement('li')
        item.textContent = issue.message
        list.append(item)
      }
      errorBox.append(list)
    }
    errorBox.hidden = false
  }
  clearFieldErrors(form)
  if (errorBox) errorBox.hidden = true
  form.setAttribute('data-form-sending', '')
  form.setAttribute('aria-busy', 'true')
  if (submit) submit.disabled = true
  try {
    const body = new URLSearchParams()
    for (const [key, value] of new FormData(form)) {
      if (typeof value === 'string') body.append(key, value)
    }
    let response: Response
    try {
      response = await doFetch(form.action, {
        method: 'POST',
        body,
        headers: { Accept: 'application/json' },
        credentials: 'omit',
      })
    } catch {
      showError(NETWORK_ERROR)
      return
    }
    const json: unknown = await response.json().catch(() => null)
    if (response.ok) {
      box?.setAttribute('data-sent', '')
      box?.querySelector<HTMLElement>('[role="status"]')?.focus()
      reachGoal(dialog, form, env, doc)
      return
    }
    const { message, issues } = errorOf(json)
    // Поле с ошибкой — текст у поля, отметка и фокус: на телефоне окно прокрутится к полю, и
    // сообщение рядом с ним в экране. Общая ошибка (role=alert) — над кнопкой
    let first: HTMLElement | null = null
    const loose: typeof issues = []
    for (const issue of issues) {
      const field = Array.from(form.elements).find(
        (element) => element.getAttribute('name') === issue.path,
      ) as HTMLElement | undefined
      if (!field || !markField(field, issue.message, doc)) loose.push(issue)
      if (field) first = first ?? field
    }
    showError(message ?? 'Заявка не отправлена. Попробуйте ещё раз', loose)
    if (first) {
      first.focus()
      // Фокус прокручивает только к полю; текст ошибки под ним — тоже в экран (поле над ним
      // останется видно: прокрутка минимальная)
      doc.getElementById(`${first.id}-error`)?.scrollIntoView?.({ block: 'nearest' })
    } else {
      errorBox?.scrollIntoView?.({ block: 'nearest' })
    }
  } finally {
    form.removeAttribute('data-form-sending')
    form.removeAttribute('aria-busy')
    if (submit) submit.disabled = false
  }
}

/**
 * Цель «заявка» из окна: адрес страницы не меняется, поэтому цель «URL содержит sent=» здесь не
 * сработает. Метрика — reachGoal('lead'), GA4 — событие generate_lead, если счётчики уже загружены
 * (после согласия). Своему скрипту сайта — событие averra:lead на document
 */
function reachGoal(
  dialog: HTMLElement,
  form: HTMLFormElement,
  env: BehaviorsEnvironment,
  doc: Document,
) {
  const slug = dialog.getAttribute('data-site-window') ?? ''
  const counter = Number(dialog.getAttribute('data-site-window-metrika') ?? '')
  try {
    if (typeof env.ym === 'function' && counter > 0) env.ym(counter, 'reachGoal', 'lead')
    if (typeof env.gtag === 'function') env.gtag('event', 'generate_lead', { window: slug })
  } catch {
    // Сбой счётчика — не повод терять показанный успех
  }
  const view = doc.defaultView as (Window & { CustomEvent?: typeof CustomEvent }) | null
  if (view?.CustomEvent) {
    doc.dispatchEvent(
      new view.CustomEvent('averra:lead', { detail: { window: slug, form: form.id } }),
    )
  }
}

// ── Плавный <details> ───────────────────────────────────────────────────────────────────────────

/**
 * <details data-av-details> раскрывается и сворачивается анимацией высоты (Web Animations). Без
 * скрипта, без element.animate и при «уменьшить движение» — обычный <details>
 */
function startDetails(doc: Document) {
  doc.addEventListener('click', (event) => {
    if (event.defaultPrevented) return
    const target = event.target as Element | null
    const summary = target?.closest?.('summary')
    const details = summary?.parentElement
    if (!summary || !details || details.tagName !== 'DETAILS') return
    if (!details.hasAttribute('data-av-details') || typeof details.animate !== 'function') return
    // Второй клик посреди анимации браузер иначе обработал бы сам: рывок, а ответ мог закрыться
    // вопреки клику. Пока анимация идёт, клики пропускаем
    if (details.getAttribute('data-av-busy') !== null) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    // Высоты закрытого и открытого — замером самого details: отступы и рамка его стиля — в них
    const opening = !details.hasAttribute('open')
    details.removeAttribute('open')
    const closed = details.offsetHeight
    details.setAttribute('open', '')
    const full = details.offsetHeight
    const from = opening ? closed : full
    const to = opening ? full : closed
    details.setAttribute('data-av-busy', '')
    details.style.overflow = 'hidden'
    const animation = details.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: 280,
      easing: 'ease-out',
    })
    const done = () => {
      if (!opening) details.removeAttribute('open')
      details.style.overflow = ''
      details.removeAttribute('data-av-busy')
    }
    animation.onfinish = done
    animation.oncancel = done
  })
}

// ── Появление, подсказка, рисование ─────────────────────────────────────────────────────────────

const SVG_SHAPES = 'path, line, polyline, polygon, circle, ellipse, rect'

/**
 * Эффекты «когда элемент показался»: data-av-reveal (появление), data-av-draw (рисование линии),
 * data-av-hint (подсказка-поворот, один раз). Без IntersectionObserver (iOS до 12.2) — ничего: всё
 * уже видно. Прячется только то, что ниже экрана при загрузке: открытая посреди страницы ссылка
 * по якорю не показывает пустое место
 */
function startOnScreen(doc: Document, env: BehaviorsEnvironment) {
  const Observer = env.IntersectionObserver
  if (!Observer) return
  const reveal = Array.from(doc.querySelectorAll<HTMLElement>('[data-av-reveal]'))
  const draw = Array.from(doc.querySelectorAll<Element>('[data-av-draw]'))
  const hint = Array.from(doc.querySelectorAll<HTMLElement>('[data-av-hint]'))
  if (reveal.length + draw.length + hint.length === 0) return
  const height = env.innerHeight ?? doc.documentElement.clientHeight
  const below = (element: Element) => element.getBoundingClientRect().top > height
  const frame = (callback: () => void) => {
    if (env.requestAnimationFrame)
      env.requestAnimationFrame(() => env.requestAnimationFrame?.(callback))
    else callback()
  }

  // Ждут прокрутки: метка data-av-pending снимается только отсюда
  const waiting = new Set<Element>()
  const appear = (element: Element) => {
    // data-av-shown запускает анимацию появления: только у того, что ждало прокрутки
    element.setAttribute('data-av-shown', '')
    element.removeAttribute('data-av-pending')
    waiting.delete(element)
    show.unobserve(element)
  }
  const show = new Observer(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) appear(entry.target)
    },
    { rootMargin: '0px 0px -10% 0px' },
  )
  const wait = (element: Element) => {
    element.setAttribute('data-av-pending', '')
    waiting.add(element)
    show.observe(element)
  }

  for (const element of reveal) {
    if (below(element)) wait(element)
  }

  for (const element of draw) {
    // Линии SVG рисуются по длине: pathLength="1" — длина любой фигуры одна и та же
    if (element.getAttribute('data-av-draw') === 'svg') {
      for (const shape of Array.from(element.querySelectorAll(SVG_SHAPES))) {
        shape.setAttribute('pathLength', '1')
      }
    }
    // Сначала «не нарисовано» без перехода, и стиль пересчитан (getBoundingClientRect): иначе
    // метки в одном кадре запустили бы переход 100 % → 0 %, а снятие метки вернуло бы линию к
    // 100 % без рисования. Переход включается уже от 0 %
    element.setAttribute('data-av-pending', '')
    element.getBoundingClientRect()
    element.setAttribute('data-av-armed', '')
    // Видно сразу — рисуется со следующего кадра; ниже экрана — когда до него докрутят
    if (below(element)) wait(element)
    else frame(() => element.removeAttribute('data-av-pending'))
  }

  // Низ страницы: строка, верх которой и при прокрутке до упора в нижних 10% экрана (копирайт
  // подвала), с суженной областью наблюдателя не пересечётся никогда и осталась бы пустым местом.
  // Докрутили до низа — показываем всё, что ждёт и уже в экране
  if (waiting.size > 0) {
    const scroller = doc.scrollingElement ?? doc.documentElement
    const atBottom = () => scroller.scrollTop + height >= scroller.scrollHeight - 2
    const settle = () => {
      if (!atBottom()) return
      for (const element of Array.from(waiting)) {
        if (element.getBoundingClientRect().top < height) appear(element)
      }
      if (waiting.size === 0) doc.removeEventListener('scroll', settle)
    }
    doc.addEventListener('scroll', settle, { passive: true })
    settle()
  }

  if (hint.length > 0) {
    const nudge = new Observer(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          toggle(entry.target, 'data-av-hinted', true)
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0.6 },
    )
    for (const element of hint) nudge.observe(element)
  }
}
