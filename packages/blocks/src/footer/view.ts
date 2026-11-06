import {
  canonicalPath,
  FOOTER_CONSENT_TEXT,
  type Footer,
  type FooterContacts,
  type FooterLayout,
  type FooterTextFont,
  type FooterTone,
  footerRequisites,
  type Header,
  type LinkablePage,
  legalPages,
  type SocialLink,
  socialLinks,
  telHref,
} from '@averra/schema'
import type { LegalFooterProps } from '../cookie/CookieNotice'
import {
  type SiteBrandView,
  type SiteHeaderLink,
  siteBrandView,
  siteHeaderLinks,
} from '../header/view'

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
  /** «© 2026 Ремонт у Ивана»; пусто — «© и год» выключены */
  copyright: string
  /** Линия над подвалом */
  divider: boolean
  /** Свой текст подвала (подпись, часы работы); пусто — нет */
  text: string
  textFont: FooterTextFont
  /** Логотип шапки в подвале; null — его нет */
  brand: SiteBrandView | null
  /** Согласие на обработку данных — ссылкой рядом с политикой; null — ссылки нет */
  consentHref: string | null
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
  /**
   * Шапка сайта: её меню — разделы подвала, её логотип — логотип подвала. null — шапки нет,
   * разделов тоже, а логотип — название сайта
   */
  header:
    | (Pick<Header, 'menu'> & Partial<Pick<Header, 'brand' | 'logo' | 'logoMark' | 'logoText'>>)
    | null
  /** Опубликованные страницы с блоками: куда ссылки разделов ведут на собранном сайте */
  pages: readonly LinkablePage[]
  /** Реквизиты, контакты и соцсети из «SEO → Организация» */
  contacts: FooterContacts
  /** Политика и «Настройки cookie» — то же, что у прежней полосы (cookieNoticeView) */
  legal: LegalFooterProps
  /** Опубликованная страница согласия (consentPageHref); null или нет — ссылки нет */
  consentHref?: string | null | undefined
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
 * Адрес страницы согласия на обработку данных, если она опубликована (published — адреса
 * опубликованных страниц); иначе null — ссылки на неё нет
 */
export function consentPageHref(published: readonly string[]) {
  const { slug } = legalPages.consent
  return published.includes(slug) ? canonicalPath(slug) : null
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
      ? siteHeaderLinks(input.header.menu, input.pages, input.page.slug)
      : []
  const header = input.header
  const brand = footer.brand
    ? siteBrandView(
        {
          brand: header?.brand ?? 'image',
          logo: header?.logo ?? null,
          logoMark: header?.logoMark ?? '',
          logoText: header?.logoText ?? '',
        },
        input.siteName,
      )
    : null
  const organization = contacts.name.trim()
  return {
    layout: footer.layout,
    tone: footer.tone,
    siteName: input.siteName,
    about: footer.about,
    copyright: footer.copyright ? `© ${input.year} ${input.siteName}` : '',
    divider: footer.divider,
    text: footer.text,
    textFont: footer.textFont,
    brand,
    consentHref: footer.consent ? (input.consentHref ?? null) : null,
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
