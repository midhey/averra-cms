import { z } from 'zod'
import { BlockId } from './define-block'
import { MediaId } from './media'
import { ExistingPageSlug, MAIN_PAGE_SLUG } from './page'
import { canonicalPath } from './seo'

/** Сколько пунктов в меню: больше в строку шапки на ноутбуке не встаёт */
export const HEADER_MENU_MAX = 8

/** Подпись пункта меню и кнопки: короткая, чтобы меню вставало в строку */
export const HEADER_LABEL_MAX = 40

/**
 * Раскладки шапки (концепт Headers): классика — всё в строку; меню по центру — логотип сверху,
 * меню под ним; двухэтажная — сверху адрес и телефон, ниже логотип и меню; минимум — логотип и
 * кнопка, для промо-страницы
 */
export const HeaderLayout = z.enum(['classic', 'center', 'double', 'minimal'])
export type HeaderLayout = z.infer<typeof HeaderLayout>

export const headerLayoutTitles: Record<HeaderLayout, string> = {
  classic: 'Классика',
  center: 'Меню по центру',
  double: 'Двухэтажная',
  minimal: 'Минимум',
}

export const headerLayoutHints: Record<HeaderLayout, string> = {
  classic: 'Логотип, меню, телефон и кнопка в одну строку',
  center: 'Логотип по центру, меню строкой под ним',
  double: 'Сверху адрес и телефон, ниже логотип, меню и кнопка',
  minimal: 'Логотип и кнопка без меню — для промо-страницы',
}

/**
 * Куда ведёт пункт меню или кнопка шапки: страница сайта и, если нужно, блок на ней (его id —
 * якорь). Не строка-ссылка: так в меню только свои страницы и блоки, а есть ли они — проверяет
 * публикация шапки
 */
export const SiteLink = z.strictObject({
  page: ExistingPageSlug.meta({ title: 'Страница' }),
  block: BlockId.optional().meta({ title: 'Блок на странице' }),
})
export type SiteLink = z.infer<typeof SiteLink>

const HeaderLabel = z.string().trim().min(1).max(HEADER_LABEL_MAX)

/** Пункт меню: подпись и куда ведёт */
export const MenuItem = SiteLink.extend({ label: HeaderLabel.meta({ title: 'Подпись' }) })
export type MenuItem = z.infer<typeof MenuItem>

/** Кнопка шапки: текст и куда ведёт — обычно к форме заявки */
export const HeaderButton = SiteLink.extend({ label: HeaderLabel.meta({ title: 'Текст кнопки' }) })
export type HeaderButton = z.infer<typeof HeaderButton>

const headerFields = {
  layout: HeaderLayout.default('classic').meta({ title: 'Раскладка' }),
  sticky: z.boolean().default(true).meta({ title: 'Липкая шапка' }),
  condense: z.boolean().default(false).meta({ title: 'Собирается при прокрутке' }),
  overlay: z.boolean().default(false).meta({ title: 'Прозрачная на первом экране' }),
  phone: z.boolean().default(false).meta({ title: 'Телефон из «SEO → Организация»' }),
  button: HeaderButton.nullable().default(null).meta({ title: 'Кнопка в шапке' }),
  logo: MediaId.nullable().default(null).meta({ title: 'Логотип' }),
  menu: z.array(MenuItem).max(HEADER_MENU_MAX).default([]).meta({ title: 'Меню' }),
}

/**
 * Шапка сайта: одна на все страницы, страница может её скрыть (hideHeader в содержимом). Логотип
 * — картинка или SVG из медиатеки; без него в шапке название сайта
 */
export const Header = z.strictObject(headerFields).superRefine((header, ctx) => {
  if (header.condense && !header.sticky) {
    ctx.addIssue({
      code: 'custom',
      path: ['condense'],
      message: 'Собираться при прокрутке может только липкая шапка: включите «Липкая шапка»',
    })
  }
})
export type Header = z.infer<typeof Header>
/** Что можно прислать в API: поля со значениями по умолчанию необязательны */
export type HeaderInput = z.input<typeof Header>

/** Шапка по умолчанию: классика, липкая, без меню и кнопки, название сайта вместо логотипа */
export const defaultHeader: Header = Header.parse({})

/** Две шапки одинаковые — по смыслу, а не по порядку ключей */
export function sameHeader(a: Header, b: Header) {
  return JSON.stringify(Header.parse(a)) === JSON.stringify(Header.parse(b))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Пункт меню или кнопка из базы: только знакомые ключи. Более новая версия могла дописать в пункт
 * поле, которого эта не знает, — строгая схема отвергла бы из-за него весь пункт
 */
const knownLinkKeys = (value: unknown) =>
  isRecord(value)
    ? Object.fromEntries(
        ['page', 'block', 'label'].flatMap((key) => (key in value ? [[key, value[key]]] : [])),
      )
    : value

/**
 * Шапка из базы — с запасом на откат версии: более новая версия могла записать поле или значение,
 * которых эта не знает. Незнакомые ключи отбрасываются — и у шапки, и у пунктов меню и кнопки;
 * поле с непонятным значением — значение по умолчанию, непонятный пункт меню — пропадает только он
 * (о них — onInvalid с путём). Сборка и админка из-за этого не падают
 */
export function readHeader(stored: unknown, onInvalid?: (field: string) => void): Header {
  const source = isRecord(stored) ? stored : {}
  const read = <K extends keyof typeof headerFields>(key: K, value = source[key]): Header[K] => {
    const parsed = headerFields[key].safeParse(value)
    if (parsed.success) return parsed.data as Header[K]
    onInvalid?.(key)
    return defaultHeader[key]
  }
  const readMenu = (): MenuItem[] => {
    if (!Array.isArray(source.menu)) return read('menu')
    return source.menu
      .flatMap((stored, index) => {
        const parsed = MenuItem.safeParse(knownLinkKeys(stored))
        if (parsed.success) return [parsed.data]
        onInvalid?.(`menu.${index}`)
        return []
      })
      .slice(0, HEADER_MENU_MAX)
  }
  const header: Header = {
    layout: read('layout'),
    sticky: read('sticky'),
    condense: read('condense'),
    overlay: read('overlay'),
    phone: read('phone'),
    button: read('button', knownLinkKeys(source.button)),
    logo: read('logo'),
    menu: readMenu(),
  }
  // Сборка без липкости — правило схемы, а не повод ронять сайт
  if (header.condense && !header.sticky) header.condense = false
  return header
}

/** Адрес ссылки шапки на сайте: путь страницы (как в карте сайта) и якорь блока */
export function siteLinkHref(link: SiteLink) {
  const path = canonicalPath(link.page)
  return link.block ? `${path}#${link.block}` : path
}

/** Опубликованная страница — то, что нужно, чтобы проверить ссылку шапки */
export type LinkablePage = { slug: string; blockIds: readonly string[] }

/**
 * Куда ссылка шапки ведёт на собранном сайте. Страницы нет на сайте — ссылки нет (undefined):
 * пункт не выводится. Блока на странице нет — ведёт на страницу без якоря. Так пропавшая цель
 * не роняет сборку и не даёт битой ссылки. missing — что пропало: его админка показывает
 */
export function resolveSiteLink(link: SiteLink, pages: readonly LinkablePage[]) {
  const page = pages.find((candidate) => candidate.slug === link.page)
  if (!page) return { href: undefined, missing: 'page' as const }
  if (link.block && !page.blockIds.includes(link.block)) {
    return { href: siteLinkHref({ page: link.page }), missing: 'block' as const }
  }
  return { href: siteLinkHref(link), missing: undefined }
}

/** Пункт ведёт на саму страницу (без блока) — на ней он текущий (aria-current="page") */
export const isCurrentLink = (link: SiteLink, slug: string) =>
  link.page === slug && link.block === undefined

/**
 * Прозрачная шапка поверх первого экрана — только если страница начинается с «Первого экрана» на
 * фото (вариант cover): шапка ложится на то же затемнённое фото, что и текст блока, и берёт его
 * цвета. Над картинкой сбоку (split) или над текстом другого блока прозрачная шапка выглядела бы
 * обычной или читалась бы как часть блока. Остальные страницы — с обычной шапкой
 */
export function overlayFits(blocks: readonly { type: string; props: unknown }[]) {
  const first = blocks[0]
  return (
    first?.type === 'hero' &&
    isRecord(first.props) &&
    first.props.variant === 'cover' &&
    isRecord(first.props.image) &&
    typeof first.props.image.mediaId === 'string'
  )
}

/** Подпись страницы для людей: главная — «Главная», остальные — заголовком */
export const pageLinkTitle = (page: { slug: string; title: string }) =>
  page.slug === MAIN_PAGE_SLUG ? `Главная (${page.title})` : page.title

/**
 * Что в шапке ведёт на страницу: «пункт меню «Услуги»», «кнопка «Рассчитать»». По этому списку
 * страницу не дают удалить, пока она в шапке, — иначе пункт молча пропал бы с сайта
 */
export function headerPageUses(header: Pick<Header, 'menu' | 'button'>, slug: string) {
  return [
    ...header.menu.filter((item) => item.page === slug).map((item) => `пункт меню «${item.label}»`),
    ...(header.button?.page === slug ? [`кнопка «${header.button.label}»`] : []),
  ]
}

/** Картинки медиатеки, на которые ссылается шапка: их нельзя удалить, и они нужны сборке */
export const headerMediaIds = (header: Header | null | undefined) =>
  header?.logo ? [header.logo] : []

/** Блок страницы, на который может вести пункт меню: его id — якорь */
export type HeaderTargetBlock = {
  id: string
  type: string
  /** Заголовок блока, если он есть: по нему блок узнают в списке */
  label: string | null
  /** Есть в черновике страницы */
  draft: boolean
  /** Есть на опубликованной странице */
  published: boolean
}

/** Страница сайта — цель пунктов меню и кнопки шапки */
export type HeaderTargetPage = {
  slug: string
  title: string
  /** Страница опубликована: только на неё ссылка шапки работает на сайте */
  published: boolean
  /** Шапка скрыта на опубликованной странице (hideHeader) */
  hideHeader: boolean
  /** Подвал скрыт на опубликованной странице (hideFooter) */
  hideFooter: boolean
  /** Опубликованная страница начинается с «Первого экрана» на фото (overlayFits) */
  overlay: boolean
  /** Блоки черновика, потом — те, что остались только на сайте */
  blocks: HeaderTargetBlock[]
}

/**
 * Ведут ли пункты меню и кнопка туда, где что-то есть. draft — при сохранении: страница есть,
 * блок — в черновике или на сайте. published — при публикации шапки: страница опубликована, блок
 * есть на опубликованной странице, иначе на сайте вышла бы битая ссылка. Путь — до поля
 * (menu.2.block), сообщение называет пункт и что сделать
 */
export function headerLinkIssues(
  header: Pick<Header, 'menu' | 'button'>,
  pages: readonly HeaderTargetPage[],
  stage: 'draft' | 'published',
) {
  const links = [
    ...header.menu.map((item, index) => ({
      link: item,
      path: `menu.${index}`,
      subject: `Пункт меню «${item.label}»`,
    })),
    ...(header.button
      ? [{ link: header.button, path: 'button', subject: `Кнопка «${header.button.label}»` }]
      : []),
  ]
  return links.flatMap(({ link, path, subject }) => {
    const page = pages.find((candidate) => candidate.slug === link.page)
    if (!page) {
      return [
        {
          path: `${path}.page`,
          message: `${subject}: страницы ${canonicalPath(link.page)} нет — выберите другую`,
        },
      ]
    }
    if (stage === 'published' && !page.published) {
      return [
        {
          path: `${path}.page`,
          message: `${subject}: страница «${page.title}» не опубликована — опубликуйте её или выберите другую`,
        },
      ]
    }
    if (link.block === undefined) return []
    const block = page.blocks.find((candidate) => candidate.id === link.block)
    if (stage === 'published' && !block?.published) {
      return [
        {
          path: `${path}.block`,
          message: `${subject}: блока #${link.block} нет на опубликованной странице «${page.title}» — опубликуйте страницу или выберите другой блок`,
        },
      ]
    }
    if (!block) {
      return [
        {
          path: `${path}.block`,
          message: `${subject}: блока #${link.block} нет на странице «${page.title}» — выберите другой`,
        },
      ]
    }
    return []
  })
}

/**
 * Телефон и адрес для шапки — из «SEO → Организация». Телефон — по флажку «Телефон в шапке» (его
 * ставят владелец или редактор: телефон ИП — персональные данные, сам он в шапку не попадает).
 * Адрес — в двухэтажной шапке всегда, в остальных раскладках — вместе с телефоном (siteHeaderView).
 * Нового наружу это не открывает: и номер, и адрес уже есть в разметке организации на
 * опубликованной главной, а до её публикации снимок их не отдаёт
 */
export function headerContacts(organization: {
  phone: string
  address: { street: string; city: string }
}) {
  const { city, street } = organization.address
  return {
    phone: organization.phone,
    address: [city, street].filter((line) => line !== '').join(', '),
  }
}
export type HeaderContacts = ReturnType<typeof headerContacts>
