import { z } from 'zod'
import { contrastRatio, formatContrast } from './contrast'
import type { FormField } from './forms'
import { contrastPairs, type ThemeColorRole, type ThemeColors } from './theme'
import { HTTPS_URL } from './url'

/**
 * Виды подвала (концепт Footers): простой — одна строка с реквизитами и документами; с
 * колонками — о компании, разделы, контакты, соцсети; большой — колонки и короткая форма
 * «Перезвоните мне»
 */
export const FooterLayout = z.enum(['simple', 'columns', 'big'])
export type FooterLayout = z.infer<typeof FooterLayout>

export const footerLayoutTitles: Record<FooterLayout, string> = {
  simple: 'Простой',
  columns: 'С колонками',
  big: 'Большой',
}

export const footerLayoutHints: Record<FooterLayout, string> = {
  simple: 'Одна строка: реквизиты и обязательные ссылки',
  columns: 'О компании, разделы, контакты и соцсети',
  big: 'Колонки и короткая форма «Перезвоните мне»',
}

/**
 * Фон подвала — роль темы, а не свой цвет: «Поверхность» (светлая полоса в светлой теме) или
 * «Акцент» (в светлых темах — тёмный). Пары цветов на нём уже проверены темой (footerPalette)
 */
export const FooterTone = z.enum(['surface', 'accent'])
export type FooterTone = z.infer<typeof FooterTone>

export const footerToneTitles: Record<FooterTone, string> = {
  surface: 'Поверхность',
  accent: 'Акцент',
}

/** «О компании» — строка под названием в колонке: одно предложение */
export const FOOTER_ABOUT_MAX = 200

const line = (max: number) => z.string().trim().max(max)
const required = (max: number) => z.string().trim().min(1).max(max)

/** Тексты формы «Перезвоните мне» большого подвала */
export const FooterCallback = z.strictObject({
  title: required(80).default('Остались вопросы?').meta({ title: 'Заголовок формы' }),
  text: line(200)
    .default('Оставьте телефон — перезвоним в рабочее время')
    .meta({ title: 'Текст под заголовком' }),
  button: required(40).default('Перезвоните мне').meta({ title: 'Текст кнопки' }),
  successText: required(300)
    .default('Спасибо! Мы получили номер и скоро перезвоним.')
    .meta({ title: 'Текст после отправки' }),
})
export type FooterCallback = z.infer<typeof FooterCallback>

const footerFields = {
  layout: FooterLayout.default('simple').meta({ title: 'Вид подвала' }),
  tone: FooterTone.default('surface').meta({ title: 'Фон подвала' }),
  about: line(FOOTER_ABOUT_MAX).default('').meta({ title: 'О компании' }),
  sections: z.boolean().default(true).meta({ title: 'Разделы — пункты меню шапки' }),
  callback: FooterCallback.prefault({}).meta({ title: 'Форма «Перезвоните мне»' }),
}

/**
 * Подвал сайта: один на все страницы, страница может его скрыть (hideFooter в содержимом).
 * Реквизиты, контакты и соцсети здесь не вводятся — они из «SEO → Организация»; разделы — пункты
 * меню шапки. Ссылки «Политика конфиденциальности» и «Настройки cookie» есть в любом виде
 */
export const Footer = z.strictObject(footerFields)
export type Footer = z.infer<typeof Footer>
export type FooterInput = z.input<typeof Footer>

/** Подвал по умолчанию: простой на поверхности */
export const defaultFooter: Footer = Footer.parse({})

/** Два подвала одинаковые — по смыслу, а не по порядку ключей */
export function sameFooter(a: Footer, b: Footer) {
  return JSON.stringify(Footer.parse(a)) === JSON.stringify(Footer.parse(b))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Подвал из базы — с запасом на откат версии: незнакомые ключи отбрасываются (и у текстов
 * формы), поле с непонятным значением — значение по умолчанию (о нём — onInvalid с путём).
 * Сборка и админка из-за этого не падают
 */
export function readFooter(stored: unknown, onInvalid?: (field: string) => void): Footer {
  const source = isRecord(stored) ? stored : {}
  const read = <K extends keyof typeof footerFields>(key: K): Footer[K] => {
    const parsed = footerFields[key].safeParse(source[key])
    if (parsed.success) return parsed.data as Footer[K]
    onInvalid?.(key)
    return defaultFooter[key]
  }
  const callback = isRecord(source.callback) ? source.callback : {}
  const readCallback = <K extends keyof FooterCallback>(key: K): FooterCallback[K] => {
    const parsed = FooterCallback.shape[key].safeParse(callback[key])
    if (parsed.success) return parsed.data as FooterCallback[K]
    onInvalid?.(`callback.${key}`)
    return defaultFooter.callback[key]
  }
  return {
    layout: read('layout'),
    tone: read('tone'),
    about: read('about'),
    sections: read('sections'),
    callback: {
      title: readCallback('title'),
      text: readCallback('text'),
      button: readCallback('button'),
      successText: readCallback('successText'),
    },
  }
}

// ── Форма «Перезвоните мне» ─────────────────────────────────────────────────────────────────

/**
 * Id формы подвала в адресе приёма заявок (/api/forms/:siteId/:slug/~footer) и в якоре успеха.
 * Знака «~» не бывает в id блока (BlockId), поэтому с формой на странице он не совпадёт
 */
export const FOOTER_FORM_ID = '~footer'

/** Поля формы подвала: только телефон — короткая форма «перезвоните» */
export const footerFormFields: readonly FormField[] = [
  { name: 'phone', type: 'phone', label: 'Телефон', required: true },
]

/** Текст согласия у формы подвала: тот же, что у блока «Форма» по умолчанию */
export const FOOTER_CONSENT_TEXT = 'Я согласен на обработку персональных данных'

/**
 * Что мешает опубликовать подвал. Форма «Перезвоните мне» собирает телефон, поэтому большому
 * подвалу нужна опубликованная политика конфиденциальности (152-ФЗ): без неё форму не показать
 */
export function footerPublishIssues(footer: Pick<Footer, 'layout'>, policyPublished: boolean) {
  if (footer.layout !== 'big' || policyPublished) return []
  return [
    {
      path: 'layout',
      message:
        'в большом подвале форма «Перезвоните мне», а политика конфиденциальности не опубликована. Выберите и опубликуйте её в «SEO → Cookie и согласие» или выберите другой вид',
    },
  ]
}

// ── Заявки: откуда пришла ───────────────────────────────────────────────────────────────────

/** Откуда заявка: блок «Форма» на странице или форма подвала */
export const LeadSource = z.enum(['block', 'footer'])
export type LeadSource = z.infer<typeof LeadSource>

/**
 * Форма заявки словами — в CSV и уведомлении: у формы подвала видно, что она из подвала, а не
 * блок страницы с тем же заголовком. У блока — заголовок как есть, как было до подвала
 */
export const leadFormLabel = (lead: { source: LeadSource; formTitle: string }) =>
  lead.source === 'footer' ? `${lead.formTitle} (подвал сайта)` : lead.formTitle

// ── Данные из «SEO → Организация» ───────────────────────────────────────────────────────────

/** Реквизиты строкой подвала: название, ИНН и ОГРН (у ИП — ОГРНИП, 15 цифр). Пустое — пропуск */
export function footerRequisites(organization: { name: string; inn: string; ogrn: string }) {
  const { name, inn, ogrn } = organization
  return [
    name,
    inn ? `ИНН ${inn}` : '',
    ogrn ? `${ogrn.length === 15 ? 'ОГРНИП' : 'ОГРН'} ${ogrn}` : '',
  ].filter((part) => part !== '')
}

/**
 * Что подвал берёт из «SEO → Организация»: название и реквизиты, телефон, почта, адрес строкой и
 * соцсети. Нового наружу это не открывает: всё это уже в разметке организации на опубликованной
 * главной, а до её публикации снимок организацию не отдаёт
 */
export function footerContacts(organization: {
  name: string
  phone: string
  email: string
  address: { street: string; city: string }
  inn: string
  ogrn: string
  socials: readonly string[]
}) {
  const { city, street } = organization.address
  return {
    name: organization.name,
    phone: organization.phone,
    email: organization.email,
    address: [city, street].filter((part) => part !== '').join(', '),
    inn: organization.inn,
    ogrn: organization.ogrn,
    socials: [...organization.socials],
  }
}
export type FooterContacts = ReturnType<typeof footerContacts>

/** Пустые контакты: главная не опубликована или «Организация» не заполнена */
export const emptyFooterContacts: FooterContacts = {
  name: '',
  phone: '',
  email: '',
  address: '',
  inn: '',
  ogrn: '',
  socials: [],
}

/** Соцсети, которые узнаём по адресу: название для диктора и короткая подпись значка */
const socialNetworks: { hosts: string[]; label: string; short: string }[] = [
  { hosts: ['vk.com', 'vk.ru'], label: 'ВКонтакте', short: 'VK' },
  { hosts: ['t.me', 'telegram.me'], label: 'Telegram', short: 'TG' },
  { hosts: ['ok.ru'], label: 'Одноклассники', short: 'OK' },
  { hosts: ['youtube.com', 'youtu.be'], label: 'YouTube', short: 'YT' },
  { hosts: ['rutube.ru'], label: 'Rutube', short: 'RT' },
  { hosts: ['dzen.ru'], label: 'Дзен', short: 'Дз' },
  { hosts: ['wa.me', 'whatsapp.com'], label: 'WhatsApp', short: 'WA' },
  { hosts: ['max.ru'], label: 'MAX', short: 'MAX' },
]

export type SocialLink = { href: string; label: string; short: string }

/**
 * Соцсети из «SEO → Организация» для подвала: знакомая сеть — по названию (ВКонтакте, VK),
 * остальные — по домену. Адреса уже проверены схемой (https), но кривой из старой базы
 * пропускаем, а не роняем сборку
 */
export function socialLinks(urls: readonly string[]): SocialLink[] {
  return urls.flatMap((href) => {
    // Тот же шаблон, что у поля «Соцсети»: https, домен, дальше путь. URL в схеме нет — пакет
    // собирается без DOM, а домен из проверенного адреса берётся и так
    if (!HTTPS_URL.test(href)) return []
    const domain = /^https:\/\/([^/?#:]+)/i.exec(href)?.[1] ?? ''
    const host = domain.toLowerCase().replace(/^(?:www|m)\./, '')
    const known = socialNetworks.find((network) =>
      network.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)),
    )
    if (known) return [{ href, label: known.label, short: known.short }]
    const short = host.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2)
    return [{ href, label: host, short: short.toUpperCase() || '↗' }]
  })
}

// ── Цвета ───────────────────────────────────────────────────────────────────────────────────

/** Роли темы для частей подвала: фон, текст, приглушённый текст, фокус, кнопка */
export type FooterPalette = {
  background: ThemeColorRole
  text: ThemeColorRole
  muted: ThemeColorRole
  focus: ThemeColorRole
  buttonBackground: ThemeColorRole
  buttonText: ThemeColorRole
}

/**
 * Подвал красится только ролями темы (CSS-переменные --footer-* в SiteFooter.module.css — те же
 * роли, это сверяет тест). На акценте весь текст, рамки полей и фокус — «текст на акценте», а
 * кнопка наоборот: так любая пара — та, что тема уже проверила на контраст
 */
export const footerPalette: Record<FooterTone, FooterPalette> = {
  surface: {
    background: 'surface',
    text: 'text',
    muted: 'muted',
    focus: 'accent',
    buttonBackground: 'accent',
    buttonText: 'onAccent',
  },
  accent: {
    background: 'accent',
    text: 'onAccent',
    muted: 'onAccent',
    focus: 'onAccent',
    buttonBackground: 'onAccent',
    buttonText: 'accent',
  },
}

/** Пары подвала: что на чём стоит и какой нужен контраст (WCAG 2.2 AA) */
const footerPairs = [
  { part: 'Текст', foreground: 'text', min: 4.5 },
  { part: 'Приглушённый текст', foreground: 'muted', min: 4.5 },
  { part: 'Рамка фокуса', foreground: 'focus', min: 3 },
  { part: 'Кнопка формы', foreground: 'buttonBackground', min: 3 },
] as const

/**
 * Контраст частей подвала в теме: на фоне подвала — текст, приглушённый текст, рамка фокуса и
 * кнопка; на кнопке — её текст. Каждая пара совпадает с проверяемой парой темы (themeContrast),
 * поэтому у темы, которую сохранили, подвал читается в любом виде
 */
export function footerContrast(colors: ThemeColors, tone: FooterTone) {
  const palette = footerPalette[tone]
  const pairs = [
    ...footerPairs.map((pair) => ({
      part: pair.part,
      foreground: palette[pair.foreground],
      background: palette.background,
      min: pair.min,
    })),
    {
      part: 'Текст кнопки',
      foreground: palette.buttonText,
      background: palette.buttonBackground,
      min: 4.5,
    },
  ]
  return pairs.map((pair) => {
    const ratio = contrastRatio(colors[pair.foreground], colors[pair.background])
    return {
      ...pair,
      ratio,
      ok: ratio >= pair.min,
      label: `${pair.part}: ${formatContrast(ratio)}`,
    }
  })
}

/**
 * Пара подвала проверена темой: такая же пара ролей (в любом порядке — контраст симметричен) есть
 * среди блокирующих пар темы с порогом не ниже нужного
 */
export const themeChecksPair = (pair: {
  foreground: ThemeColorRole
  background: ThemeColorRole
  min: number
}) =>
  contrastPairs.some(
    (checked) =>
      checked.blocking &&
      checked.min >= pair.min &&
      ((checked.foreground === pair.foreground && checked.background === pair.background) ||
        (checked.foreground === pair.background && checked.background === pair.foreground)),
  )
