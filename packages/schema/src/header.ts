import { z } from 'zod'
import { CustomPlace, customPlaceKey, customPlaceMediaIds, readCustomPlace } from './custom-place'
import { BlockId } from './define-block'
import { MediaId } from './media'
import { ExistingPageSlug, MAIN_PAGE_SLUG } from './page'
import { canonicalPath } from './seo'
import { HTTPS_URL } from './url'

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

/** Подпись для телефона: короче основной. Пусто — как на широком экране */
const MobileLabel = z.string().trim().max(HEADER_LABEL_MAX).default('')

const TEL_HREF = /^tel:\+?\d[\d()-]{3,19}$/
// Управляющие символы (\p{Cc}) не проходят, как и в https-ссылке: NUL база не сохранит, а
// остальные человек в адресе не видит
const MAILTO_HREF = /^mailto:[^\s@<>"'\\\p{Cc}]+@[^\s@<>"'\\\p{Cc}]+\.[^\s@<>"'\\\p{Cc}]+$/u

/**
 * Внешняя ссылка пункта меню и кнопки: https://… (Telegram, WhatsApp, маркетплейс), tel: и
 * mailto:. Без пробелов, кавычек, < > и обратной косой черты: такой адрес браузер прочитал бы не
 * так, как его видит человек. javascript:, data: и http:// сюда не проходят
 */
export const isExternalHref = (href: string) =>
  (HTTPS_URL.test(href) && !/[\s"'<>\\\p{Cc}]/u.test(href)) ||
  TEL_HREF.test(href) ||
  MAILTO_HREF.test(href)

export const EXTERNAL_HREF_HINT =
  'Ссылка https://…, телефон tel:+79991234567 или почта mailto:name@example.ru'

export const ExternalHref = z
  .string()
  .trim()
  .min(1, 'Впишите ссылку')
  .max(2000)
  .refine(isExternalHref, EXTERNAL_HREF_HINT)

/**
 * Куда ведёт пункт меню или кнопка: страница сайта (и, может быть, блок на ней) — или внешняя
 * ссылка. Одна схема с двумя целями, а не union: ошибка встаёт у поля (menu.2.url), и пункт
 * читается по знакомым ключам. newTab — открыть в новой вкладке; нет значения — по умолчанию
 * (opensNewTab): внешняя https — в новой, остальное — в той же
 */
const linkShape = {
  page: ExistingPageSlug.optional().meta({ title: 'Страница' }),
  block: BlockId.optional().meta({ title: 'Блок на странице' }),
  url: ExternalHref.optional().meta({ title: 'Внешняя ссылка' }),
  newTab: z.boolean().optional().meta({ title: 'Открывать в новой вкладке' }),
  // Страница сайта, настроенная как окно (форма заявки), открывается поверх текущей; без JS —
  // переход на неё. Внешнюю ссылку окном не открыть
  window: z.boolean().optional().meta({ title: 'Открывать в окне' }),
}

/** Ссылка шапки: на страницу сайта или внешняя */
export type HeaderLink = {
  page?: string | undefined
  block?: string | undefined
  url?: string | undefined
  newTab?: boolean | undefined
  window?: boolean | undefined
}

/** Ровно одна цель: страница (с блоком или без) или внешняя ссылка */
function oneTarget(link: HeaderLink, ctx: z.RefinementCtx) {
  if (link.url === undefined && link.page === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['page'],
      message: 'Выберите страницу или впишите ссылку',
    })
  }
  if (link.url !== undefined && (link.page !== undefined || link.block !== undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: ['url'],
      message: 'Пункт ведёт либо на страницу сайта, либо по внешней ссылке',
    })
  }
  if (link.window === true && link.url !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['window'],
      message: 'Окном открывается только страница сайта, а не внешняя ссылка',
    })
  }
}

/** Ссылка шапки открывает окно: только на страницу сайта (внешнюю схема и так не пустит) */
export const opensWindow = (link: HeaderLink) => link.window === true && link.url === undefined

/** Пункт меню: подпись, подпись для телефона и куда ведёт */
export const MenuItem = z
  .strictObject({
    label: HeaderLabel.meta({ title: 'Подпись' }),
    mobileLabel: MobileLabel.meta({ title: 'Подпись на телефоне' }),
    ...linkShape,
  })
  .superRefine(oneTarget)
export type MenuItem = z.infer<typeof MenuItem>

/** Кнопка шапки: текст и куда ведёт — обычно к форме заявки */
export const HeaderButton = z
  .strictObject({
    label: HeaderLabel.meta({ title: 'Текст кнопки' }),
    mobileLabel: MobileLabel.meta({ title: 'Текст на телефоне' }),
    ...linkShape,
  })
  .superRefine(oneTarget)
export type HeaderButton = z.infer<typeof HeaderButton>

/**
 * Внешняя ссылка открывается в новой вкладке, если про неё не сказали иного. Схема адреса — без
 * учёта регистра, как её читает браузер и пропускает проверка: «HTTPS://T.ME/…» тоже наружу
 */
export const opensNewTab = (link: HeaderLink) =>
  link.newTab ?? (link.url !== undefined && /^https:\/\//i.test(link.url))

/**
 * Логотип в шапке: картинка (без неё — название сайта, как было всегда), текст (знак и подпись)
 * или картинка с подписью рядом
 */
export const HeaderBrand = z.enum(['image', 'text', 'imageText'])
export type HeaderBrand = z.infer<typeof HeaderBrand>

export const headerBrandTitles: Record<HeaderBrand, string> = {
  image: 'Картинка',
  text: 'Текст',
  imageText: 'Картинка и текст',
}

/** Знак текстового логотипа: одна-четыре буквы акцентным шрифтом («Ve») */
export const LOGO_MARK_MAX = 4
/** Подпись логотипа: до двух строк */
export const LOGO_TEXT_MAX = 80

// ── Вид шапки ───────────────────────────────────────────────────────────────────────────────

/** Форма кнопки шапки: как в теме, «таблетка» или прямые углы */
export const HeaderButtonShape = z.enum(['theme', 'pill', 'square'])
export type HeaderButtonShape = z.infer<typeof HeaderButtonShape>
export const headerButtonShapeTitles: Record<HeaderButtonShape, string> = {
  theme: 'Как в теме',
  pill: 'Таблетка',
  square: 'Прямые углы',
}

/** Кнопка при наведении: цвет меняется всегда, «подъём» ещё приподнимает её с тенью */
export const HeaderButtonHover = z.enum(['shade', 'lift'])
export type HeaderButtonHover = z.infer<typeof HeaderButtonHover>
export const headerButtonHoverTitles: Record<HeaderButtonHover, string> = {
  shade: 'Меняет цвет',
  lift: 'Цвет и подъём',
}

/** Пункт меню при наведении: подчёркивание, подложка «Поверхность» или цвет «Акцент» */
export const HeaderLinkHover = z.enum(['underline', 'background', 'color'])
export type HeaderLinkHover = z.infer<typeof HeaderLinkHover>
export const headerLinkHoverTitles: Record<HeaderLinkHover, string> = {
  underline: 'Подчёркивание',
  background: 'Подложка',
  color: 'Цвет акцента',
}

/** Кнопка на телефоне: в раскрытом меню или всегда в строке шапки рядом с «Меню» */
export const HeaderMobileButton = z.enum(['menu', 'row'])
export type HeaderMobileButton = z.infer<typeof HeaderMobileButton>
export const headerMobileButtonTitles: Record<HeaderMobileButton, string> = {
  menu: 'В меню',
  row: 'В строке шапки',
}

/** Меню на телефоне: панель под шапкой или весь экран под ней */
export const HeaderMobileMenu = z.enum(['panel', 'fullscreen'])
export type HeaderMobileMenu = z.infer<typeof HeaderMobileMenu>
export const headerMobileMenuTitles: Record<HeaderMobileMenu, string> = {
  panel: 'Панель',
  fullscreen: 'Во весь экран',
}

/** Пункты меню на телефоне: по левому краю или по центру */
export const HeaderMobileAlign = z.enum(['start', 'center'])
export type HeaderMobileAlign = z.infer<typeof HeaderMobileAlign>
export const headerMobileAlignTitles: Record<HeaderMobileAlign, string> = {
  start: 'Слева',
  center: 'По центру',
}

/**
 * Вид шапки: только перечисления и роли темы — контраст уже проверен темой, а предпросмотр
 * точный. Значения по умолчанию — вид шапки до появления этих настроек
 */
export const HeaderLook = z.strictObject({
  divider: z.boolean().default(true).meta({ title: 'Линия под шапкой' }),
  buttonShape: HeaderButtonShape.default('theme').meta({ title: 'Форма кнопки' }),
  buttonHover: HeaderButtonHover.default('shade').meta({ title: 'Кнопка при наведении' }),
  linkHover: HeaderLinkHover.default('underline').meta({ title: 'Пункт меню при наведении' }),
  mobileButton: HeaderMobileButton.default('menu').meta({ title: 'Кнопка на телефоне' }),
  mobileMenu: HeaderMobileMenu.default('panel').meta({ title: 'Меню на телефоне' }),
  mobileAlign: HeaderMobileAlign.default('start').meta({ title: 'Пункты меню на телефоне' }),
})
export type HeaderLook = z.infer<typeof HeaderLook>

/** Подпись логотипа: до двух строк, перенос — Enter */
const LogoText = z
  .string()
  .trim()
  .max(LOGO_TEXT_MAX)
  .refine((text) => text.split('\n').length <= 2, 'Подпись логотипа — не больше двух строк')

const headerFields = {
  layout: HeaderLayout.default('classic').meta({ title: 'Раскладка' }),
  sticky: z.boolean().default(true).meta({ title: 'Липкая шапка' }),
  condense: z.boolean().default(false).meta({ title: 'Собирается при прокрутке' }),
  overlay: z.boolean().default(false).meta({ title: 'Прозрачная на первом экране' }),
  phone: z.boolean().default(false).meta({ title: 'Телефон из «SEO → Организация»' }),
  button: HeaderButton.nullable().default(null).meta({ title: 'Кнопка в шапке' }),
  logo: MediaId.nullable().default(null).meta({ title: 'Логотип' }),
  brand: HeaderBrand.default('image').meta({ title: 'Логотип в шапке' }),
  logoMark: z.string().trim().max(LOGO_MARK_MAX).default('').meta({ title: 'Знак логотипа' }),
  logoText: LogoText.default('').meta({ title: 'Подпись логотипа' }),
  menu: z.array(MenuItem).max(HEADER_MENU_MAX).default([]).meta({ title: 'Меню' }),
  look: HeaderLook.prefault({}).meta({ title: 'Вид шапки' }),
  /**
   * Свой вид шапки — свой блок с местом «шапка» и тексты его полей; null — стандартная шапка.
   * Меню, кнопку, логотип и телефон свой вид получает данными из полей выше
   */
  custom: CustomPlace.nullable().default(null).meta({ title: 'Свой вид шапки' }),
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
 * поле, которого эта не знает, — строгая схема отвергла бы из-за него весь пункт. Подпись для
 * телефона и «новая вкладка» с непонятным значением пропадают, а не роняют пункт
 */
const knownLinkKeys = (value: unknown) => {
  if (!isRecord(value)) return value
  const known: Record<string, unknown> = Object.fromEntries(
    ['page', 'block', 'url', 'label', 'mobileLabel', 'newTab', 'window'].flatMap((key) =>
      key in value ? [[key, value[key]]] : [],
    ),
  )
  if (!MobileLabel.safeParse(known.mobileLabel).success) delete known.mobileLabel
  if (known.newTab !== undefined && typeof known.newTab !== 'boolean') delete known.newTab
  // Кривой флажок окна (или окно у внешней ссылки после ручной правки) не роняет весь пункт
  if (known.window !== undefined && (typeof known.window !== 'boolean' || 'url' in known)) {
    delete known.window
  }
  return known
}

/** Вид шапки из базы: поле с непонятным значением — по умолчанию, остальные остаются */
function readLook(stored: unknown, onInvalid?: (field: string) => void): HeaderLook {
  const source = isRecord(stored) ? stored : {}
  const look: HeaderLook = HeaderLook.parse({})
  for (const key of Object.keys(HeaderLook.shape) as (keyof HeaderLook)[]) {
    if (!(key in source)) continue
    const parsed = HeaderLook.shape[key].safeParse(source[key])
    if (parsed.success) Object.assign(look, { [key]: parsed.data })
    else onInvalid?.(`look.${key}`)
  }
  return look
}

/** Свой вид из базы: непонятный — стандартная шапка (о нём — onInvalid), а не упавшая сборка */
function readCustom(stored: unknown, onInvalid?: (field: string) => void) {
  const custom = readCustomPlace(stored)
  if (custom !== undefined) return custom
  onInvalid?.('custom')
  return null
}

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
    brand: read('brand'),
    logoMark: read('logoMark'),
    logoText: read('logoText'),
    menu: readMenu(),
    look: readLook(source.look, onInvalid),
    custom: readCustom(source.custom, onInvalid),
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

/** Адрес любой ссылки шапки: внешняя — как есть, страница — путь и якорь */
export const headerLinkHref = (link: HeaderLink) =>
  link.url ?? siteLinkHref({ page: link.page ?? MAIN_PAGE_SLUG, block: link.block })

/**
 * Поля вида шапки, кроме выбора своего вида (custom). Один список на сервер и админку: новое поле
 * вида добавляют сюда, и проверка владельца, и перенос вида на экране администратора его видят
 */
export const HEADER_LOOK_FIELDS = ['layout', 'sticky', 'condense', 'overlay', 'look'] as const

const pickFields = <T extends object, K extends keyof T>(source: T, keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K>

/**
 * Вид шапки — то, что меняет только владелец (header.look): раскладка, поведение, группа look и
 * выбор своего вида. Тексты, ссылки, логотип, телефон и поля своего вида — администратор сайта
 * (header.edit)
 */
export const headerLookOf = (header: Header) => ({
  ...pickFields(header, HEADER_LOOK_FIELDS),
  custom: customPlaceKey(header.custom),
})

/** Вид двух шапок одинаковый — по смыслу, а не по порядку ключей */
export const sameHeaderLook = (a: Header, b: Header) =>
  JSON.stringify(headerLookOf(Header.parse(a))) === JSON.stringify(headerLookOf(Header.parse(b)))

/** Опубликованная страница — то, что нужно, чтобы проверить ссылку шапки */
export type LinkablePage = { slug: string; blockIds: readonly string[] }

/**
 * Куда ссылка шапки ведёт на собранном сайте. Страницы нет на сайте — ссылки нет (undefined):
 * пункт не выводится. Блока на странице нет — ведёт на страницу без якоря. Так пропавшая цель
 * не роняет сборку и не даёт битой ссылки. missing — что пропало: его админка показывает
 */
export function resolveSiteLink(link: HeaderLink, pages: readonly LinkablePage[]) {
  // Внешняя ссылка проверена схемой и от страниц сайта не зависит
  if (link.url !== undefined) return { href: link.url, missing: undefined }
  const page = pages.find((candidate) => candidate.slug === link.page)
  if (!page) return { href: undefined, missing: 'page' as const }
  if (link.block && !page.blockIds.includes(link.block)) {
    return { href: siteLinkHref({ page: page.slug }), missing: 'block' as const }
  }
  return { href: siteLinkHref({ page: page.slug, block: link.block }), missing: undefined }
}

/** Пункт ведёт на саму страницу (без блока) — на ней он текущий (aria-current="page") */
export const isCurrentLink = (link: HeaderLink, slug: string) =>
  link.url === undefined && link.page === slug && link.block === undefined

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

/**
 * Шапка, какой её сохраняют: у логотипа «Текст» картинки нет. Иначе спрятанная картинка держалась
 * бы в шапке (её нельзя удалить из медиатеки, а убрать в этом виде нечем) и сама вернулась бы,
 * стоит переключить вид. Картинку снова выбирают, переключив на «Картинку»
 */
export const headerWithVisibleLogo = <T extends Pick<Header, 'brand' | 'logo'>>(header: T): T =>
  header.brand === 'text' && header.logo !== null ? { ...header, logo: null } : header

/** Картинки медиатеки, на которые ссылается шапка: их нельзя удалить, и они нужны сборке */
export const headerMediaIds = (header: Header | null | undefined) => [
  ...(header?.logo ? [header.logo] : []),
  ...customPlaceMediaIds(header?.custom),
]

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
    // Внешнюю ссылку проверила схема: страниц и блоков у неё нет
    if (link.url !== undefined) return []
    const page = pages.find((candidate) => candidate.slug === link.page)
    if (!page) {
      return [
        {
          path: `${path}.page`,
          message: `${subject}: страницы ${canonicalPath(link.page ?? '')} нет — выберите другую`,
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
 * ставят владелец или администратор сайта: телефон ИП — персональные данные, сам он в шапку не
 * попадает). Адрес — в двухэтажной шапке всегда, в остальных раскладках — вместе с телефоном
 * (siteHeaderView). Нового наружу это не открывает: и номер, и адрес уже есть в разметке
 * организации на опубликованной главной, а до её публикации снимок их не отдаёт
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
