import {
  type Header,
  type HeaderContacts,
  type HeaderLayout,
  isCurrentLink,
  type LinkablePage,
  overlayFits,
  resolveSiteLink,
  telHref,
} from '@averra/schema'

/** Куда ведёт «К содержимому» в шапке: id у main страницы (Page) */
export const CONTENT_ID = 'content'

export type SiteHeaderLink = {
  label: string
  href: string
  /** Пункт ведёт на открытую страницу: aria-current="page" */
  current: boolean
}

/** Шапка, готовая к выводу: ссылки разрешены, лишнее для раскладки и страницы убрано */
export type SiteHeaderView = {
  layout: HeaderLayout
  sticky: boolean
  condense: boolean
  /** Прозрачная поверх первого экрана — уже с учётом того, с чего начинается страница */
  overlay: boolean
  siteName: string
  /** Логотип — id картинки медиатеки; null — в шапке название сайта */
  logo: string | null
  menu: SiteHeaderLink[]
  button: { label: string; href: string } | null
  phone: { text: string; href: string } | null
  /**
   * Адрес из «Организации»: в верхней строке двухэтажной шапки и в меню телефона под номером
   * (концепт телефона) — у двухэтажной всегда, у остальных — когда в шапке телефон. Пусто — без
   * адреса
   */
  address: string
}

type ViewInput = {
  /** Опубликованная шапка; null — её не публиковали, шапки на сайте нет */
  header: Header | null
  siteName: string
  /** Открытая страница: адрес и содержимое (с чего начинается и не скрыта ли шапка) */
  page: {
    slug: string
    content: {
      blocks: readonly { type: string; props: unknown }[]
      hideHeader?: boolean | undefined
    }
  }
  /** Опубликованные страницы с блоками: куда ссылки шапки ведут на собранном сайте */
  pages: readonly LinkablePage[]
  /** Телефон и адрес из «SEO → Организация» */
  contacts: HeaderContacts
}

/**
 * Что вывести в шапке открытой страницы. null — шапки нет: её не публиковали или страница её
 * скрыла. Пункт на страницу, которой нет на сайте, не выводится; на пропавший блок — ведёт на
 * страницу (resolveSiteLink). Одна функция для сайта и предпросмотра в админке
 */
export function siteHeaderView({
  header,
  siteName,
  page,
  pages,
  contacts,
}: ViewInput): SiteHeaderView | null {
  if (!header || page.content.hideHeader) return null
  // В раскладке «Минимум» меню нет — она для промо-страницы: логотип и одна кнопка
  const menu =
    header.layout === 'minimal'
      ? []
      : header.menu.flatMap((item) => {
          const { href } = resolveSiteLink(item, pages)
          return href ? [{ label: item.label, href, current: isCurrentLink(item, page.slug) }] : []
        })
  const buttonHref = header.button && resolveSiteLink(header.button, pages).href
  const phone = header.phone && contacts.phone !== '' ? contacts.phone : ''
  return {
    layout: header.layout,
    sticky: header.sticky,
    condense: header.sticky && header.condense,
    overlay: header.overlay && overlayFits(page.content.blocks),
    siteName,
    logo: header.logo,
    menu,
    button: header.button && buttonHref ? { label: header.button.label, href: buttonHref } : null,
    phone: phone ? { text: phone, href: telHref(phone) } : null,
    address: header.layout === 'double' || header.phone ? contacts.address : '',
  }
}

/**
 * Нужен ли странице скрипт шапки (@averra/blocks/site-header): собрать её при прокрутке,
 * зафиксировать прозрачную при прокрутке или закрыть меню телефона по Esc. Без этого
 * страница остаётся без скрипта
 */
export const headerScriptNeeded = (view: SiteHeaderView | null) =>
  view !== null && (view.condense || (view.overlay && view.sticky) || view.menu.length > 0)

/** Метка прокрутки нужна сборке и прозрачной липкой шапке: по ней скрипт знает, что ушли вниз */
export const headerWatchesScroll = (view: SiteHeaderView) =>
  view.condense || (view.overlay && view.sticky)

/**
 * Кнопке на телефоне — своя строка под логотипом: кнопка есть, а меню, куда её спрятать, нет
 * («Минимум» или все пункты ведут на страницы, которых нет на сайте). Шапка тогда выше, и сборке
 * сайта это нужно знать ещё для отступа якорей
 */
export const headerRowButton = (view: SiteHeaderView) =>
  view.button !== null && view.menu.length === 0

/** Самый длинный пункт, который ещё встаёт в строку с логотипом, телефоном и кнопкой */
const INLINE_ITEM_MAX = 24
/**
 * Сколько знаков меню и кнопки вместе встают в строку с логотипом на ноутбуке (1024 px). Без
 * логотипа в той же строке название сайта (до 80 знаков) — оно считается вместе с меню
 */
const INLINE_MENU_CHARS = 100

/**
 * Меню на широком экране — своей строкой под логотипом, телефоном и кнопкой. В одной строке с
 * ними длинное меню (восемь пунктов по 40 знаков) сжималось в столбик, каждый пункт — в две
 * строки, и липкая шапка занимала полэкрана. Своей строкой меню получает всю ширину, пункты не
 * переносятся внутри себя. Решает сборка по длине подписей — без скрипта и без :has(). У «по
 * центру» меню и так своей строкой, но длинное переносится на две-три строки: признак нужен ей
 * ради отступа якорей и первого экрана и целых пунктов. У «Минимума» меню нет
 */
export function headerMenuRow(view: SiteHeaderView) {
  if (view.layout === 'minimal' || view.menu.length === 0) return false
  const labels = view.menu.map((item) => item.label.length)
  const total =
    labels.reduce((sum, length) => sum + length, 0) +
    (view.button?.label.length ?? 0) +
    (view.logo === null ? view.siteName.length : 0)
  return Math.max(...labels) > INLINE_ITEM_MAX || total > INLINE_MENU_CHARS
}
