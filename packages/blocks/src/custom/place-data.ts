import {
  canonicalPath,
  type FooterContacts,
  footerRequisites,
  socialLinks,
  telHref,
} from '@averra/schema'

// Данные шаблона своих шапки и подвала (свой блок с местом «шапка» или «подвал»). Ссылки уже
// разрешены Averra: шаблон их не строит, поэтому проверка меню, запрет удалить страницу из меню и
// «битая ссылка на сайт не выходит» работают как у стандартной шапки. Пустое — null: в Liquid
// пустая строка — истина, а null — ложь, и {% if site.logo.mark %} читается как задумано

/** Пункт меню в шаблоне */
export type PlaceMenuItem = {
  label: string
  /** Подпись на телефоне; null — как label */
  mobile_label: string | null
  href: string
  /** Пункт ведёт на открытую страницу: aria-current="page" */
  current: boolean
  /** Открывать в новой вкладке: target="_blank" */
  new_tab: boolean
  /**
   * Открывать окном (страница-окно поверх этой): шаблон ставит ссылке атрибут data-av-window —
   * {% if item.window %}data-av-window{% endif %}
   */
  window: boolean
}

/** Что шаблон шапки и подвала получает в переменной site */
export type PlaceSite = {
  name: string
  /** Главная: ссылка логотипа и «← На главную» */
  home: string
  menu: PlaceMenuItem[]
  button: Omit<PlaceMenuItem, 'current'> | null
  logo: {
    /** Картинка медиатеки — для фильтра image ({{ site.logo.image | image: '160px' }}) */
    image: { mediaId: string; alt: string } | null
    /** Знак акцентным шрифтом («Ve») */
    mark: string | null
    /** Подпись или название сайта; null — логотип только картинкой */
    text: string | null
  }
  organization: {
    name: string | null
    phone: string | null
    phone_href: string | null
    email: string | null
    email_href: string | null
    address: string | null
    inn: string | null
    ogrn: string | null
    /** Название, ИНН и ОГРН строками: «ИНН 7700000000» */
    requisites: string[]
    socials: { href: string; label: string; short: string }[]
  }
  /** Документы: адрес — только у опубликованной страницы, иначе null */
  legal: { policy_href: string | null; consent_href: string | null; cookie_settings: boolean }
  year: number
  /** «© 2026 Название сайта» */
  copyright: string
}

/** Что шаблон получает в переменной page */
export type PlacePage = {
  slug: string
  /** Служебная страница с короткой шапкой: меню и кнопки нет, нужна дорога на главную */
  short: boolean
  /** Главная страница */
  home: boolean
}

export type PlaceData = { site: PlaceSite; page: PlacePage }

/**
 * Форма данных места для проверки шаблона: опечатка на любом уровне (site.organization.phon,
 * item.hreff в цикле по site.menu) — ошибка при сохранении, а не пустой вывод на сайте.
 * Объект — известные ключи, массив из одного элемента — список таких элементов, 'value' — значение
 */
export type PlaceShape = 'value' | readonly [PlaceShape] | { readonly [key: string]: PlaceShape }

const link = {
  label: 'value',
  mobile_label: 'value',
  href: 'value',
  new_tab: 'value',
  window: 'value',
} as const

export const PLACE_SHAPE: { readonly site: PlaceShape; readonly page: PlaceShape } = {
  site: {
    name: 'value',
    home: 'value',
    menu: [{ ...link, current: 'value' }],
    button: link,
    logo: { image: { mediaId: 'value', alt: 'value' }, mark: 'value', text: 'value' },
    organization: {
      name: 'value',
      phone: 'value',
      phone_href: 'value',
      email: 'value',
      email_href: 'value',
      address: 'value',
      inn: 'value',
      ogrn: 'value',
      requisites: ['value'],
      socials: [{ href: 'value', label: 'value', short: 'value' }],
    },
    legal: { policy_href: 'value', consent_href: 'value', cookie_settings: 'value' },
    year: 'value',
    copyright: 'value',
  } satisfies Record<keyof PlaceSite, PlaceShape>,
  page: { slug: 'value', short: 'value', home: 'value' } satisfies Record<
    keyof PlacePage,
    PlaceShape
  >,
}

const orNull = (text: string) => (text.trim() === '' ? null : text)

/** Ссылка шапки, как её готовит siteHeaderView */
type ViewLink = {
  label: string
  mobileLabel: string
  href: string
  current?: boolean
  newTab: boolean
  window?: boolean
}

const menuItem = (link: ViewLink): PlaceMenuItem => ({
  label: link.label,
  mobile_label: orNull(link.mobileLabel),
  href: link.href,
  current: link.current === true,
  new_tab: link.newTab,
  window: link.window === true,
})

export type PlaceDataInput = {
  siteName: string
  page: { slug: string; short: boolean; home: boolean }
  /** Пункты меню, уже разрешённые (siteHeaderLinks): только на опубликованное и наружу */
  menu: readonly ViewLink[]
  button: ViewLink | null
  /** Логотип по настройке шапки (siteBrandView) */
  brand: { image: string | null; mark: string; text: string | null }
  /** Реквизиты и контакты из «SEO → Организация» (пусто до публикации главной) */
  contacts: FooterContacts
  legal: { policyHref: string | null; consentHref: string | null; cookieSettings: boolean }
  year: number
}

/** Данные шаблона места: одна форма у шапки и подвала */
export function placeData(input: PlaceDataInput): PlaceData {
  const { contacts, brand } = input
  const text = brand.text ?? (brand.image ? null : input.siteName)
  return {
    site: {
      name: input.siteName,
      home: '/',
      menu: input.menu.map(menuItem),
      button: input.button ? (({ current: _, ...rest }) => rest)(menuItem(input.button)) : null,
      logo: {
        // Подпись рядом — картинка украшение (alt=""), без подписи её alt — название сайта
        image: brand.image
          ? { mediaId: brand.image, alt: text === null ? input.siteName : '' }
          : null,
        mark: orNull(brand.mark),
        text,
      },
      organization: {
        name: orNull(contacts.name),
        phone: orNull(contacts.phone),
        phone_href: contacts.phone ? telHref(contacts.phone) : null,
        email: orNull(contacts.email),
        email_href: contacts.email ? `mailto:${contacts.email}` : null,
        address: orNull(contacts.address),
        inn: orNull(contacts.inn),
        ogrn: orNull(contacts.ogrn),
        requisites: footerRequisites(contacts),
        socials: socialLinks(contacts.socials),
      },
      legal: {
        policy_href: input.legal.policyHref,
        consent_href: input.legal.consentHref,
        cookie_settings: input.legal.cookieSettings,
      },
      year: input.year,
      copyright: `© ${input.year} ${input.siteName}`,
    },
    page: input.page,
  }
}

/**
 * Образец данных для проверки при сохранении и предпросмотра определения: меню из трёх пунктов
 * (один — текущий, один — наружу), кнопка, текстовый логотип, «Организация» и документы
 */
export const samplePlaceData = (short = false): PlaceData =>
  placeData({
    siteName: 'Название сайта',
    page: { slug: short ? 'privacy' : 'index', short, home: !short },
    menu: short
      ? []
      : [
          { label: 'Услуги', mobileLabel: '', href: '/#services', current: false, newTab: false },
          { label: 'О нас', mobileLabel: '', href: '/about', current: true, newTab: false },
          {
            label: 'Telegram',
            mobileLabel: 'TG',
            href: 'https://t.me/example',
            current: false,
            newTab: true,
          },
        ],
    button: short
      ? null
      : { label: 'Оставить заявку', mobileLabel: 'Заявка', href: '/#form', newTab: false },
    brand: { image: null, mark: 'Аб', text: 'Название сайта' },
    contacts: {
      name: 'ООО «Пример»',
      phone: '+7 900 000-00-00',
      email: 'hello@example.ru',
      address: 'Москва, ул. Примерная, 1',
      inn: '7700000000',
      ogrn: '1027700000000',
      socials: ['https://vk.com/example'],
    },
    legal: {
      policyHref: canonicalPath('privacy'),
      consentHref: canonicalPath('consent'),
      cookieSettings: true,
    },
    year: 2026,
  })
