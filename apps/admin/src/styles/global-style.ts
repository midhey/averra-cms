/** Пометка глобального стиля админки: предпросмотр по ней понимает, что его копировать не надо */
export const GLOBAL_STYLE_ATTRIBUTE = 'data-admin-global'

/**
 * Ставит глобальный слой первым в <head>: стили компонентов идут после него и при равной
 * специфичности побеждают сброс. Повторный вызов (горячая перезагрузка) заменяет текст
 */
export function installGlobalStyle(owner: Document, css: string) {
  const existing = owner.head.querySelector<HTMLStyleElement>(`style[${GLOBAL_STYLE_ATTRIBUTE}]`)
  const style = existing ?? owner.createElement('style')
  style.setAttribute(GLOBAL_STYLE_ATTRIBUTE, '')
  style.textContent = css
  owner.head.prepend(style)
}

/**
 * Что копировать в iframe предпросмотра: стили блоков (CSS-модули) и ссылки на стили, но не
 * глобальный слой админки — его сброс и токены :root изменили бы вид лендинга
 */
export function previewStyleNodes(owner: Document): Element[] {
  return [
    ...owner.querySelectorAll(`style:not([${GLOBAL_STYLE_ATTRIBUTE}]), link[rel="stylesheet"]`),
  ]
}
