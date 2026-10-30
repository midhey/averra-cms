// Шапка сайта: маленькое улучшение поверх рабочего HTML. Без скрипта шапка полная и липкая, меню
// на телефоне открывается <details>. Со скриптом шапка собирается в строку, когда страницу
// прокрутили, прозрачная — встаёт сверху с фоном, а меню закрывается по Esc и по выбору пункта.
// Модуль без зависимостей и внешних загрузок: Astro собирает его в /_astro/… только на страницы,
// где ему есть что делать (headerScriptNeeded)

/**
 * Первый элемент вне своих блоков: шаблон блока не подменит шапку и её метки копией. Своя копия
 * проверки, а не импорт: Astro встраивает маленький модуль прямо в страницу
 */
function querySite<T extends Element>(doc: Document, selector: string): T | null {
  for (const element of Array.from(doc.querySelectorAll<T>(selector))) {
    if (!element.closest('[data-custom-block]')) return element
  }
  return null
}

/** Что скрипту нужно от окна: в тестах — свои наблюдатель и медиазапрос */
export type HeaderEnvironment = {
  IntersectionObserver?: typeof IntersectionObserver | undefined
  matchMedia?: ((query: string) => { matches: boolean }) | undefined
  requestAnimationFrame?: ((callback: () => void) => unknown) | undefined
}

const toggle = (element: Element, name: string, on: boolean) => {
  if (on) element.setAttribute(name, '')
  else element.removeAttribute(name)
}

/**
 * Оживляет шапку [data-site-header]. Две метки у верха страницы: [data-header-sentinel="far"]
 * (7rem) ушла из окна — страницу прокрутили, и шапка получает data-condensed (сборка) или
 * data-stuck (прозрачная липкая); вернуть полную шапку может только [data-header-sentinel="top"]
 * (0.5rem), то есть почти самый верх. Зазор между метками — гистерезис: липкая шапка стоит в
 * потоке и при сборке становится ниже (до ~50 px у двухэтажной), браузер сдвигает прокрутку на
 * эту разницу (scroll anchoring), и с одной меткой шапка мигала бы, собираясь и разворачиваясь
 * каждый кадр. Анимация (data-animate) — только если в системе не просили уменьшить движение, и
 * не с первого кадра: открытая посреди страницы шапка встаёт собранной без анимации
 */
export function startSiteHeader(
  doc: Document = document,
  env: HeaderEnvironment = typeof window === 'undefined' ? {} : window,
) {
  const header = querySite<HTMLElement>(doc, '[data-site-header]')
  if (!header) return
  const calm = env.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const far = querySite<Element>(doc, '[data-header-sentinel="far"]')
  const top = querySite<Element>(doc, '[data-header-sentinel="top"]')
  // Где IntersectionObserver нет (iOS до 12.2), шапка остаётся полной и липкой
  if (far && top && env.IntersectionObserver) {
    const condense = header.hasAttribute('data-condense')
    const stick = header.hasAttribute('data-overlay') && header.hasAttribute('data-sticky')
    let scrolled = false
    let first = true
    const observer = new env.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === far && !entry.isIntersecting) scrolled = true
        if (entry.target === top && entry.isIntersecting) scrolled = false
      }
      toggle(header, 'data-condensed', condense && scrolled)
      toggle(header, 'data-stuck', stick && scrolled)
      if (first && !calm) {
        first = false
        const animate = () => header.setAttribute('data-animate', '')
        if (env.requestAnimationFrame) env.requestAnimationFrame(animate)
        else animate()
      }
    })
    observer.observe(far)
    observer.observe(top)
  }

  const menu = header.querySelector<HTMLElement>('details[data-header-menu]')
  if (!menu) return
  const close = () => menu.removeAttribute('open')
  // Esc закрывает меню и возвращает фокус на «Меню»: иначе он остался бы в скрытой панели
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !menu.hasAttribute('open')) return
    close()
    menu.querySelector<HTMLElement>('summary')?.focus()
  })
  // Пункт меню — часто якорь на этой же странице: страница прокрутится, а открытое меню
  // закрывало бы раздел, к которому пришли
  menu.addEventListener('click', (event) => {
    const target = event.target as { closest?: (selector: string) => Element | null } | null
    if (typeof target?.closest === 'function' && target.closest('a')) close()
  })
}
