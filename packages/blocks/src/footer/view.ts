import {
  FOOTER_CONSENT_TEXT,
  type Footer,
  type FooterContacts,
  type FooterLayout,
  type FooterTone,
  footerRequisites,
  type Header,
  isCurrentLink,
  type LinkablePage,
  resolveSiteLink,
  type SocialLink,
  socialLinks,
  telHref,
} from '@averra/schema'
import type { LegalFooterProps } from '../cookie/CookieNotice'
import type { SiteHeaderLink } from '../header/view'

/** Форма «Перезвоните мне», готовая к выводу */
export type FooterCallbackView = {
  title: string
  text: string
  button: string
  successText: string
  consentText: string
  /** Политика конфиденциальности — ссылка у согласия; без неё формы на сайте нет */
  policyHref: string
  /** Адрес приёма заявок. Нет — предпросмотр в админке: форма не отправляется */
  action: string | undefined
}

/** Подвал, готовый к выводу: ссылки разрешены, пустые колонки убраны */
export type SiteFooterView = {
  layout: FooterLayout
  tone: FooterTone
  siteName: string
  about: string
  /** «© 2026 Ремонт у Ивана» */
  copyright: string
  /** Название организации, ИНН, ОГРН — из «SEO → Организация» */
  requisites: string[]
  /** Разделы — пункты меню шапки, что ведут на опубликованное */
  sections: SiteHeaderLink[]
  phone: { text: string; href: string } | null
  email: { text: string; href: string } | null
  address: string
  socials: SocialLink[]
  /** Обязательные ссылки — в любом виде подвала */
  legal: LegalFooterProps
  callback: FooterCallbackView | null
}

type ViewInput = {
  /** Опубликованный подвал; null — его не публиковали: на сайте прежняя полоса */
  footer: Footer | null
  siteName: string
  /** Открытая страница: адрес (текущий пункт разделов) и не скрыт ли на ней подвал */
  page: { slug: string; content: { hideFooter?: boolean | undefined } }
  /** Шапка сайта: её меню — разделы подвала. null — шапки нет, разделов тоже */
  header: Pick<Header, 'menu'> | null
  /** Опубликованные страницы с блоками: куда ссылки разделов ведут на собранном сайте */
  pages: readonly LinkablePage[]
  /** Реквизиты, контакты и соцсети из «SEO → Организация» */
  contacts: FooterContacts
  /** Политика и «Настройки cookie» — то же, что у прежней полосы (cookieNoticeView) */
  legal: LegalFooterProps
  /**
   * Адрес приёма формы подвала на этой странице; undefined — предпросмотр (форма видна, но не
   * отправляется); null — страницы нет в базе (стандартная 404): API заявку с неё не примет,
   * поэтому формы нет совсем — посетитель не должен заполнять форму, которая теряет заявку
   */
  formAction?: string | null | undefined
  /** Год в «©» — год сборки сайта */
  year: number
}

/**
 * Что вывести в подвале открытой страницы. null — подвала нет (его не публиковали или страница
 * его скрыла): тогда внизу прежняя полоса с политикой и «Настройками cookie» (LegalFooter) —
 * обязательные ссылки остаются на каждой странице. Одна функция для сайта и предпросмотра
 */
export function siteFooterView(input: ViewInput): SiteFooterView | null {
  const { footer, contacts, legal } = input
  if (!footer || input.page.content.hideFooter) return null
  const sections =
    footer.sections && footer.layout !== 'simple' && input.header
      ? input.header.menu.flatMap((item) => {
          const { href } = resolveSiteLink(item, input.pages)
          return href
            ? [{ label: item.label, href, current: isCurrentLink(item, input.page.slug) }]
            : []
        })
      : []
  const organization = contacts.name.trim()
  return {
    layout: footer.layout,
    tone: footer.tone,
    siteName: input.siteName,
    about: footer.about,
    copyright: `© ${input.year} ${input.siteName}`,
    // Название организации, совпадающее с названием сайта, второй раз не пишем
    requisites: footerRequisites({
      ...contacts,
      name: organization === input.siteName.trim() ? '' : organization,
    }),
    sections,
    phone: contacts.phone ? { text: contacts.phone, href: telHref(contacts.phone) } : null,
    email: contacts.email ? { text: contacts.email, href: `mailto:${contacts.email}` } : null,
    address: contacts.address,
    socials: socialLinks(contacts.socials),
    legal,
    // Форма собирает телефон — без опубликованной политики её не показываем (152-ФЗ)
    callback:
      footer.layout === 'big' && legal.policyHref && input.formAction !== null
        ? {
            ...footer.callback,
            consentText: FOOTER_CONSENT_TEXT,
            policyHref: legal.policyHref,
            action: input.formAction,
          }
        : null,
  }
}
