// Метки своего блока в разметке сайта. Отдельный файл без зависимостей: его берёт и Section, которому
// не нужен разбор CSS и HTML. Скрипты сайта держат свою копию «[data-custom-block]» (они — отдельные
// маленькие модули, встраиваемые в страницу); совпадение сверяет тест

/** Атрибут секции своего блока: по нему CSS блока находит только свой блок (:scope) */
export const CUSTOM_BLOCK_ATTRIBUTE = 'data-custom-block'

/**
 * Атрибут обёртки HTML шаблона внутри секции. «> .x» и «:scope > .x» в CSS блока — дети этой
 * обёртки, то есть верхние элементы шаблона, а не служебные обёртки секции
 */
export const CUSTOM_BLOCK_ROOT_ATTRIBUTE = 'data-custom-block-root'

/**
 * Имена data-атрибутов, которыми сайт помечает свою разметку: по ним её находят скрипты и стили
 * (имя целиком или начало до «-»). В шаблоне своего блока их нет — он не выдаст себя за
 * уведомление о cookie, шапку или плеер. Список сверяет тест с исходниками скриптов и стилей
 */
const RESERVED_DATA = [
  'cookie-consent',
  'consent',
  'modal-open',
  'settings-open',
  'metrika',
  'ga4',
  'legal-footer',
  'site-header',
  'site-footer',
  'header',
  'sticky',
  'sticky-header',
  'condense',
  'condensed',
  'stuck',
  'overlay',
  'animate',
  'video',
  'custom-block',
  'tone',
  'density',
  'backdrop',
  'hero-cover',
  'row-button',
  'menu-row',
]

/** data-атрибут занят разметкой сайта: data-consent-action, data-video-embed, data-custom-block… */
export function isReservedDataAttribute(name: string) {
  const rest = name.toLowerCase().replace(/^data-/, '')
  if (rest === name.toLowerCase()) return false
  return RESERVED_DATA.some((prefix) => rest === prefix || rest.startsWith(`${prefix}-`))
}

/**
 * id разметки сайта: «К содержимому» (content), заголовки окна cookie (cookie-…), форма подвала
 * (~footer…). Свой id блока стал бы первым в документе и перехватил бы ссылки и подписи
 */
export const isReservedId = (id: string) => /^(?:content$|cookie-|~)/i.test(id.trim())
