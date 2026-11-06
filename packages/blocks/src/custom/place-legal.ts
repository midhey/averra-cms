import postcss, { CssSyntaxError } from 'postcss'
import { visibleLinkHrefs } from './html'
import type { CustomBlockProblem } from './problems'

/** Обязательные документы сайта для своего подвала: адрес — только у опубликованной страницы */
export type PlaceLegalLinks = {
  policyHref: string | null
  consentHref: string | null
  cookieSettings: boolean
}

/** Атрибут строки документов Averra после своего подвала */
export const LEGAL_FOOTER_ATTRIBUTE = 'data-legal-footer'

/**
 * Какие документы Averra выводит после шаблона своего подвала. Ссылку, которую шаблон уже вывел
 * видимой (настоящий <a> с тем же адресом, с текстом, не скрытый hidden/aria-hidden), второй раз
 * не пишем — дубля нет. Текст «href=…» в абзаце или спрятанная ссылка дубль не отменяют
 */
export function legalFooterLinks(html: string, legal: PlaceLegalLinks) {
  const shown = visibleLinkHrefs(html)
  const missing = (href: string | null) => (href !== null && !shown.has(href) ? href : null)
  return {
    policy: missing(legal.policyHref),
    consent: missing(legal.consentHref),
    cookieSettings: legal.cookieSettings,
  }
}

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * Строка документов строкой HTML — для проверки определения (MCP check_custom_block): нейронка
 * видит подвал таким, каким его соберёт сайт. На сайте и в предпросмотре её рисует CustomSiteFooter
 */
export function legalFooterHtml(html: string, legal: PlaceLegalLinks) {
  const links = legalFooterLinks(html, legal)
  const parts = [
    links.policy && `<a href="${escapeAttribute(links.policy)}">Политика конфиденциальности</a>`,
    links.consent &&
      `<a href="${escapeAttribute(links.consent)}">Согласие на обработку персональных данных</a>`,
    links.cookieSettings &&
      '<button type="button" data-consent-open="" aria-haspopup="dialog">Настройки cookie</button>',
  ].filter(Boolean)
  return parts.length > 0 ? `<div ${LEGAL_FOOTER_ATTRIBUTE}="">${parts.join('')}</div>` : ''
}

/** Значения, которые прячут элемент целиком или делают его невидимым */
const HIDING: Readonly<Record<string, RegExp>> = {
  display: /^none\b/i,
  visibility: /^(?:hidden|collapse)\b/i,
  opacity: /^0*(?:\.0*)?%?\s*(?:!important)?$/i,
  'content-visibility': /^hidden\b/i,
  'font-size': /^0+(?:\.0*)?(?:[a-z%]*)?\s*(?:!important)?$/i,
  height: /^0+(?:\.0*)?(?:[a-z%]*)?\s*(?:!important)?$/i,
  'max-height': /^0+(?:\.0*)?(?:[a-z%]*)?\s*(?:!important)?$/i,
}

/**
 * CSS подвала прячет строку документов Averra (`[data-legal-footer]` или её ссылки): политика
 * обязательна по 152-ФЗ, поэтому это ошибка, а не совет. Ловится только явное правило по
 * атрибуту строки: скрытие через общий селектор (`:scope > :last-child`) отсюда не видно — об этом
 * сказано в документации
 */
export function legalFooterCssProblems(css: string): CustomBlockProblem[] {
  let root: postcss.Root
  try {
    root = postcss.parse(css)
  } catch (error) {
    // Синтаксис разбирает основная проверка CSS: здесь повторять её незачем
    if (error instanceof CssSyntaxError) return []
    throw error
  }
  const problems: CustomBlockProblem[] = []
  root.walkRules((rule) => {
    if (!rule.selector.includes(LEGAL_FOOTER_ATTRIBUTE)) return
    rule.walkDecls((decl) => {
      const hiding = HIDING[decl.prop.toLowerCase()]
      if (!hiding?.test(decl.value.trim())) return
      problems.push({
        part: 'css',
        level: 'error',
        line: decl.source?.start?.line,
        message: `«${decl.prop}: ${decl.value}» прячет строку документов [${LEGAL_FOOTER_ATTRIBUTE}]: ссылка на политику обязательна. Меняйте её вид (цвет, отступы, шрифт), но не прячьте`,
      })
    })
  })
  return problems
}
