import { z } from 'zod'
import { ExistingPageSlug } from './page'

// Cookie-уведомление сайта (раздел «SEO и аналитика» → «Cookie и согласие»). Хранится группой
// cookies в sites.settings. Уведомление нужно только сайту со счётчиками: без Метрики и GA4 сайт
// не ставит ни одной cookie, и говорить посетителю не о чем (docs/decisions/cookie-consent)

/**
 * Режим: consent — счётчики грузятся только после согласия посетителя (по умолчанию),
 * notice — счётчики работают сразу, посетитель видит уведомление и «Понятно»
 */
export const CookieMode = z.enum(['consent', 'notice'])
export type CookieMode = z.infer<typeof CookieMode>

export const cookieModeTitles = {
  consent: 'Согласие до аналитики',
  notice: 'Только уведомление',
} as const satisfies Record<CookieMode, string>

/** Вид: плашка снизу, карточка в углу, окно по центру (строгий — до выбора сайт за ним) */
export const CookieLook = z.enum(['bar', 'card', 'modal'])
export type CookieLook = z.infer<typeof CookieLook>

export const cookieLookTitles = {
  bar: 'Плашка снизу',
  card: 'Карточка в углу',
  modal: 'Окно по центру',
} as const satisfies Record<CookieLook, string>

export const COOKIE_TEXT_MAX = 400

/** Страница политики: адрес страницы этого сайта или пусто — политики нет */
export const PolicyPage = z.union([z.literal(''), ExistingPageSlug])

export const CookieSettings = z.strictObject({
  mode: CookieMode.default('consent'),
  look: CookieLook.default('card'),
  /** Текст уведомления. Пусто — текст по умолчанию под режим и включённые счётчики */
  text: z.string().trim().max(COOKIE_TEXT_MAX).default(''),
  policyPage: PolicyPage.default(''),
})
export type CookieSettings = z.infer<typeof CookieSettings>

/** Счётчики сайта: номера проверены схемой настроек, пусто — счётчика нет */
export type AnalyticsIds = { metrika: string; ga4: string }

/** Показывать ли уведомление: только если на сайте есть счётчик */
export const cookieNoticeShown = (analytics: AnalyticsIds) =>
  analytics.metrika !== '' || analytics.ga4 !== ''

/** Сервисы аналитики сайта словами: в именительном («Яндекс Метрика») и винительном падеже */
export function analyticsServices(analytics: AnalyticsIds) {
  const nominative: string[] = []
  const accusative: string[] = []
  if (analytics.metrika !== '') {
    nominative.push('Яндекс Метрика')
    accusative.push('Яндекс Метрику')
  }
  if (analytics.ga4 !== '') {
    nominative.push('Google Analytics')
    accusative.push('Google Analytics')
  }
  return { nominative: nominative.join(' и '), accusative: accusative.join(' и ') }
}

/** Текст уведомления по умолчанию: под режим и счётчики, которые на сайте на самом деле есть */
export function defaultCookieText(mode: CookieMode, analytics: AnalyticsIds) {
  const services = analyticsServices(analytics)
  // Счётчиков нет (подсказка в админке до их подключения) — общими словами, без пустых скобок
  const named = services.nominative !== ''
  return mode === 'consent'
    ? `Необходимые cookie нужны, чтобы сайт работал. Аналитические${named ? ` (${services.nominative})` : ''} включим только с вашего согласия.`
    : `Мы используем cookie, чтобы сайт работал, и ${named ? services.accusative : 'сервисы аналитики'}, чтобы понимать, как им пользуются. Продолжая, вы соглашаетесь с этим.`
}

/** Текст уведомления на сайте: свой или по умолчанию */
export const cookieNoticeText = (cookies: CookieSettings, analytics: AnalyticsIds) =>
  cookies.text === '' ? defaultCookieText(cookies.mode, analytics) : cookies.text

/** Описание аналитики в окне настроек: какие сервисы и что они считают */
export function analyticsDescription(analytics: AnalyticsIds) {
  return `${analyticsServices(analytics).nominative}: посещения и источники переходов.`
}
