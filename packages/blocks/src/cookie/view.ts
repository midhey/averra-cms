import {
  analyticsDescription,
  cookieNoticeShown,
  cookieNoticeText,
  MAIN_PAGE_SLUG,
  type StoredSiteSettings,
} from '@averra/schema'
import type { CookieNoticeProps, LegalFooterProps } from './CookieNotice'

/** Адрес страницы политики, если она опубликована; иначе null — ссылки на сайте нет */
export function policyHref(settings: Pick<StoredSiteSettings, 'cookies'>, published: string[]) {
  const slug = settings.cookies.policyPage
  if (slug === '' || !published.includes(slug)) return null
  return slug === MAIN_PAGE_SLUG ? '/' : `/${slug}`
}

/**
 * Что показать на странице: уведомление (null — его нет: на сайте нет счётчиков, и cookie сайт не
 * ставит) и подвал с документами. Одна функция для сайта и предпросмотра в админке
 */
export function cookieNoticeView(
  settings: Pick<StoredSiteSettings, 'cookies' | 'analytics'>,
  published: string[],
): { notice: CookieNoticeProps | null; footer: LegalFooterProps } {
  const { cookies, analytics } = settings
  const href = policyHref(settings, published)
  if (!cookieNoticeShown(analytics)) {
    return { notice: null, footer: { policyHref: href, cookieSettings: false } }
  }
  return {
    notice: {
      mode: cookies.mode,
      look: cookies.look,
      text: cookieNoticeText(cookies, analytics),
      policyHref: href,
      analyticsDescription: analyticsDescription(analytics),
      metrika: analytics.metrika,
      ga4: analytics.ga4,
    },
    footer: { policyHref: href, cookieSettings: cookies.mode === 'consent' },
  }
}
