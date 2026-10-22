import { z } from 'zod'
import { CookieSettings } from './cookies'
import { MAIL_ADDRESS_PATTERN } from './mail'
import { MediaId } from './media'
import { SEO_DESCRIPTION_MAX } from './page'
import { SiteName } from './site'
import { HTTPS_ORIGIN, HTTPS_URL, isInternalPath } from './url'

// Настройки сайта для поиска, соцсетей и аналитики (раздел «SEO» в админке). Хранятся в
// sites.settings (jsonb), название — в sites.name. Всё отсюда попадает в HTML опубликованного
// сайта, поэтому строки, которые уходят в атрибуты и скрипты, проверяются строгими шаблонами

/** Шаблон заголовка: %s — заголовок страницы. Пусто — заголовок страницы как есть */
export const TITLE_PLACEHOLDER = '%s'

export const TitleTemplate = z
  .string()
  .trim()
  .max(120)
  .refine(
    (value) => value === '' || value.split(TITLE_PLACEHOLDER).length === 2,
    'Шаблон должен содержать %s ровно один раз: на его место встанет заголовок страницы',
  )

/**
 * Заголовок страницы по шаблону сайта. На главной шаблон не применяется (решает рендерер).
 * Подстановка функцией: строку замены replace разбирает, и заголовок «Курс $& доллара» иначе
 * превратился бы в «Курс %s доллара»
 */
export function applyTitleTemplate(template: string, title: string) {
  return template === '' ? title : template.replace(TITLE_PLACEHOLDER, () => title)
}

/** Описание сайта по умолчанию: тот же предел, что у описания страницы */
export const SeoDescription = z.string().trim().max(SEO_DESCRIPTION_MAX)

/** Языки сайта: атрибут lang у html и og:locale */
export const siteLanguages = {
  ru: { title: 'Русский', locale: 'ru_RU' },
  en: { title: 'Английский', locale: 'en_US' },
  kk: { title: 'Казахский', locale: 'kk_KZ' },
  uz: { title: 'Узбекский', locale: 'uz_UZ' },
  ky: { title: 'Киргизский', locale: 'ky_KG' },
  tg: { title: 'Таджикский', locale: 'tg_TJ' },
  be: { title: 'Белорусский', locale: 'be_BY' },
  uk: { title: 'Украинский', locale: 'uk_UA' },
  hy: { title: 'Армянский', locale: 'hy_AM' },
  az: { title: 'Азербайджанский', locale: 'az_AZ' },
  ka: { title: 'Грузинский', locale: 'ka_GE' },
  tr: { title: 'Турецкий', locale: 'tr_TR' },
  de: { title: 'Немецкий', locale: 'de_DE' },
  fr: { title: 'Французский', locale: 'fr_FR' },
  es: { title: 'Испанский', locale: 'es_ES' },
  it: { title: 'Итальянский', locale: 'it_IT' },
  zh: { title: 'Китайский', locale: 'zh_CN' },
} as const

export const SiteLanguage = z.enum(
  Object.keys(siteLanguages) as [keyof typeof siteLanguages, ...(keyof typeof siteLanguages)[]],
)
export type SiteLanguage = z.infer<typeof SiteLanguage>

const SITE_URL_MESSAGE = 'Адрес сайта — https:// и домен без пути, например https://example.ru'

/**
 * Канонический адрес сайта: https и домен, без пути. Пусто — адрес установки (SITE_URL).
 * Хранится в одном виде: строчными, без косой черты в конце
 */
export const SiteUrl = z
  .string()
  .trim()
  .max(200)
  .refine((value) => value === '' || HTTPS_ORIGIN.test(value), SITE_URL_MESSAGE)
  .transform((value) => value.toLowerCase().replace(/\/$/, ''))

/**
 * Код подтверждения прав (Яндекс Вебмастер, Google Search Console). Можно вставить код или весь
 * мета-тег: код вынимается из content="…". Только латиница, цифры, _ и - — он уходит в атрибут
 */
export const VerificationCode = z
  .string()
  .trim()
  .transform((value) => /content\s*=\s*["']([^"']*)["']/i.exec(value)?.[1]?.trim() ?? value)
  .pipe(
    z
      .string()
      .regex(
        /^([A-Za-z0-9_-]{6,100})?$/,
        'Вставьте код из content="…" или весь мета-тег: латиница, цифры, _ и -',
      ),
  )

/** Номер счётчика Яндекс Метрики: только цифры. Подставляется в скрипт — поэтому строго */
export const MetrikaId = z
  .string()
  .trim()
  .regex(/^(\d{4,12})?$/, 'Номер счётчика — только цифры, например 98765432')

/**
 * Идентификатор потока Google Analytics 4: G-XXXXXXXXXX. Подставляется в скрипт — поэтому строго
 */
export const Ga4Id = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(G-[A-Z0-9]{4,16})?$/, 'Идентификатор потока GA4 вида G-XXXXXXXXXX')

const MAIL_ADDRESS_REGEXP = new RegExp(`^(?:${MAIL_ADDRESS_PATTERN})$`, 'v')

const OptionalEmail = z
  .string()
  .trim()
  .max(254)
  .refine(
    (value) => value === '' || MAIL_ADDRESS_REGEXP.test(value),
    'Нужен адрес почты, например info@example.ru',
  )

const Phone = z
  .string()
  .trim()
  .regex(
    /^(\+?[\d\s()-]{5,30})?$/,
    'Телефон: цифры, пробелы, скобки и дефис, например +7 900 123-45-67',
  )

const SocialUrl = z
  .string()
  .trim()
  .max(500)
  .regex(HTTPS_URL, 'Ссылка на страницу в соцсети, начинается с https://')

/** Вид организации для разметки schema.org */
export const OrganizationType = z.enum(['Organization', 'LocalBusiness'])
export const organizationTypeTitles = {
  Organization: 'Организация',
  LocalBusiness: 'Местный бизнес (магазин, салон, мастерская)',
} as const satisfies Record<z.infer<typeof OrganizationType>, string>

const addressLine = (max: number) => z.string().trim().max(max).default('')

/**
 * Организация для JSON-LD на главной (schema.org Organization или LocalBusiness). Пустое название —
 * разметки нет. Реквизиты необязательны: ИНН — 10 или 12 цифр, ОГРН — 13 (ОГРНИП — 15)
 */
export const Organization = z
  .strictObject({
    type: OrganizationType.default('Organization'),
    name: z.string().trim().max(200).default(''),
    logo: MediaId.nullable().default(null),
    phone: Phone.default(''),
    email: OptionalEmail.default(''),
    address: z
      .strictObject({
        street: addressLine(200),
        city: addressLine(100),
        region: addressLine(100),
        postalCode: z
          .string()
          .trim()
          .regex(/^(\d{6})?$/, 'Индекс — 6 цифр')
          .default(''),
      })
      .prefault({}),
    socials: z.array(SocialUrl).max(10).default([]),
    inn: z
      .string()
      .trim()
      .regex(/^(\d{10}|\d{12})?$/, 'ИНН — 10 цифр у организации или 12 у ИП')
      .default(''),
    ogrn: z
      .string()
      .trim()
      .regex(/^(\d{13}|\d{15})?$/, 'ОГРН — 13 цифр, ОГРНИП — 15')
      .default(''),
  })
  .superRefine((org, ctx) => {
    const filled =
      org.logo !== null ||
      org.phone !== '' ||
      org.email !== '' ||
      Object.values(org.address).some((line) => line !== '') ||
      org.socials.length > 0 ||
      org.inn !== '' ||
      org.ogrn !== ''
    if (filled && org.name === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Укажите название: без него поисковик не поймёт, чьи это данные',
      })
    }
  })
export type Organization = z.infer<typeof Organization>

// ── Редиректы ────────────────────────────────────────────────────────────────────────────────

/** Сколько редиректов в таблице: хватает переезда старого сайта на сотню страниц */
export const REDIRECTS_MAX = 300

/** Пути, которые сайт отдаёт сам: перенаправлять их нельзя */
const SERVICE_PREFIXES = ['/api/', '/media/', '/_astro/']

/**
 * Файлы в корне сайта, которые кладёт сборка: robots.txt, sitemap.xml, страница 404, иконки и
 * манифест. Caddy отдаёт файл и до API не доходит — редирект с такого адреса не сработал бы.
 * Имена иконок совпадают с ICON_FILES API (сверяет settings.test.ts)
 */
export const SITE_ROOT_FILES = [
  '/404',
  '/404.html',
  '/robots.txt',
  '/sitemap.xml',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
] as const

function safeDecode(path: string) {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

/**
 * Путь в одном виде для сравнения: раскодированный и без косой черты в конце (кроме корня).
 * /old, /old/ и /%D1%81%D1%82%D0%B0%D1%80%D1%8B%D0%B9 → /old, /old, /старый
 */
export function normalizeRedirectPath(path: string) {
  const trimmed = safeDecode(path).replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/** Путь внутренней ссылки без ?… и #… */
const pathOf = (href: string) => href.split(/[?#]/)[0] ?? href

export const RedirectFrom = z
  .string()
  .trim()
  .max(300)
  .refine(isInternalPath, 'Адрес на этом сайте, с / в начале, например /old-page')
  .refine((path) => !/[?#\s]/.test(path), 'Без ?, # и пробелов: редирект срабатывает по пути')
  .transform(normalizeRedirectPath)
  .refine((path) => path !== '/', 'С главной перенаправить нельзя: она есть всегда')
  .refine(
    (path) => !SERVICE_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix)),
    'Служебные адреса /api/, /media/ и /_astro/ перенаправить нельзя',
  )
  .refine(
    (path) => !(SITE_ROOT_FILES as readonly string[]).includes(path.toLowerCase()),
    'Это служебный файл сайта (robots.txt, sitemap.xml, страница 404, иконки): его отдаёт сервер, редирект не сработает',
  )

export const RedirectTo = z
  .string()
  .trim()
  .max(2000)
  .refine((href) => !/\s/.test(href), 'Без пробелов')
  .refine(
    (href) => isInternalPath(href) || HTTPS_URL.test(href),
    'Путь на этом сайте (/new-page) или ссылка https://',
  )
  // Половинка суррогатной пары не кодируется в адрес (redirectLocation упал бы на каждом заходе)
  .refine((href) => {
    try {
      encodeURI(href)
      return true
    } catch {
      return false
    }
  }, 'В адресе есть повреждённый символ: наберите его заново')

export const Redirect = z.strictObject({ from: RedirectFrom, to: RedirectTo })
export type Redirect = z.infer<typeof Redirect>

/**
 * Путь ссылки https на этот сайт (как в адресе, можно закодированный) или undefined — ссылка на
 * другой сайт. Даёт тот, кто знает адрес сайта и умеет разбирать URL (API): у схемы нет API среды,
 * а сравнивать надо хост целиком — с портом по умолчанию (:443) и доменом в punycode
 */
export type SameSitePath = (href: string) => string | undefined

/** Путь, куда ведёт ссылка «куда» на этом сайте (без ?… и #…), или undefined — на другой сайт */
function targetPath(to: string, sameSitePath: SameSitePath | undefined) {
  if (isInternalPath(to)) return normalizeRedirectPath(pathOf(to))
  const path = sameSitePath?.(to)
  return path === undefined ? undefined : normalizeRedirectPath(pathOf(path))
}

export type RedirectIssue = { index: number; field: 'from' | 'to'; message: string }

/**
 * Ошибки таблицы редиректов: повтор «откуда», редирект на себя и петли — цепочка по адресам
 * этого сайта не должна вернуться туда, откуда начала (браузер показал бы «слишком много
 * перенаправлений»). Цепочки без петель допустимы. sameSitePath узнаёт ссылки https на свой
 * сайт: без него они считаются внешними, и петлю через них найдёт только API
 */
export function redirectTableIssues(
  redirects: readonly Redirect[],
  sameSitePath?: SameSitePath,
): RedirectIssue[] {
  const issues: RedirectIssue[] = []
  const seen = new Set<string>()
  redirects.forEach(({ from }, index) => {
    if (seen.has(from)) {
      issues.push({ index, field: 'from', message: 'Этот адрес уже есть в таблице выше' })
    }
    seen.add(from)
  })
  const byFrom = new Map(redirects.map(({ from, to }) => [from, to]))
  const next = (path: string) => {
    const to = byFrom.get(path)
    return to === undefined ? undefined : targetPath(to, sameSitePath)
  }
  redirects.forEach(({ from, to }, index) => {
    if (targetPath(to, sameSitePath) === from) {
      issues.push({ index, field: 'to', message: 'Редирект ведёт сам на себя' })
      return
    }
    const visited = new Set([from])
    for (let step = next(from); step !== undefined; step = next(step)) {
      if (visited.has(step)) {
        issues.push({
          index,
          field: 'to',
          message: `Петля: цепочка редиректов от ${from} возвращается на ${step}`,
        })
        return
      }
      visited.add(step)
    }
  })
  return issues
}

/** Таблица редиректов: без повторов «откуда», без редиректа на себя и без петель */
export const Redirects = z
  .array(Redirect)
  .max(REDIRECTS_MAX)
  .superRefine((redirects, ctx) => {
    for (const issue of redirectTableIssues(redirects)) {
      ctx.addIssue({ code: 'custom', path: [issue.index, issue.field], message: issue.message })
    }
  })

/** Куда перенаправить путь запроса, или undefined. Таблица уже проверена схемой */
export function findRedirect(redirects: readonly Redirect[], requestPath: string) {
  const path = normalizeRedirectPath(requestPath)
  return redirects.find((redirect) => redirect.from === path)?.to
}

/**
 * «Куда» для заголовка Location. В заголовке HTTP только ASCII, а «куда» может быть /цены или
 * https://пример.рф: такие символы кодируются (%D1%86…), уже закодированное остаётся как есть.
 * Браузер раскодирует и путь, и домен. Одна функция для API и dev-рендерера.
 *
 * search — строка запроса исходного адреса (?utm_source=…): она переходит в «куда», чтобы метки
 * рекламы со старых ссылок не терялись. Если у «куда» своя строка запроса — остаётся только она:
 * владелец задал её явно, а склейка двух наборов дала бы дубли параметров
 */
export function redirectLocation(to: string, search = '') {
  const hashAt = to.indexOf('#')
  const base = hashAt === -1 ? to : to.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : to.slice(hashAt)
  const query = search.replace(/^\?/, '')
  const target = query !== '' && !base.includes('?') ? `${base}?${query}${hash}` : to
  return target.replace(/[^\p{ASCII}]+/gu, (chunk) => encodeURIComponent(chunk))
}

// ── Настройки целиком ────────────────────────────────────────────────────────────────────────

const Verification = z.strictObject({
  yandex: VerificationCode.default(''),
  google: VerificationCode.default(''),
})

const Analytics = z.strictObject({
  metrika: MetrikaId.default(''),
  ga4: Ga4Id.default(''),
})

/**
 * Поля настроек без названия (оно в sites.name). Группы (verification, analytics, organization)
 * заменяются целиком: недостающее внутри группы — значение по умолчанию
 */
const settingsFields = {
  titleTemplate: TitleTemplate,
  description: SeoDescription,
  language: SiteLanguage,
  url: SiteUrl,
  ogImage: MediaId.nullable(),
  icon: MediaId.nullable(),
  hideFromSearch: z.boolean(),
  verification: Verification,
  analytics: Analytics,
  organization: Organization,
  redirects: Redirects,
  cookies: CookieSettings,
}

/** Настройки в базе: каждого поля может не быть — тогда значение по умолчанию */
const StoredSiteSettings = z.strictObject({
  titleTemplate: settingsFields.titleTemplate.default(''),
  description: settingsFields.description.default(''),
  language: settingsFields.language.default('ru'),
  url: settingsFields.url.default(''),
  ogImage: settingsFields.ogImage.default(null),
  icon: settingsFields.icon.default(null),
  // Сайт, у которого настроек ещё нет (создан до этого шага), уже работает: он открыт поисковикам.
  // Новый сайт установки создаётся скрытым явно (newSiteSettings)
  hideFromSearch: settingsFields.hideFromSearch.default(false),
  verification: settingsFields.verification.prefault({}),
  analytics: settingsFields.analytics.prefault({}),
  organization: settingsFields.organization.prefault({}),
  redirects: settingsFields.redirects.default([]),
  cookies: settingsFields.cookies.prefault({}),
})
export type StoredSiteSettings = z.infer<typeof StoredSiteSettings>

/** Настройки сайта так, как их отдаёт API: название и всё остальное */
export const SiteSettings = StoredSiteSettings.extend({ name: SiteName })
export type SiteSettings = z.infer<typeof SiteSettings>

/**
 * Что присылают в PATCH: любые поля верхнего уровня, остальные не меняются. Без значений по
 * умолчанию: не присланное поле не должно сброситься
 */
export const SiteSettingsPatch = z.strictObject({ name: SiteName, ...settingsFields }).partial()
export type SiteSettingsPatch = z.infer<typeof SiteSettingsPatch>
export type SiteSettingsPatchInput = z.input<typeof SiteSettingsPatch>

/** Настройки нового сайта установки: скрыт от поисковиков, пока его делают (до запуска) */
export const newSiteSettings = (): StoredSiteSettings =>
  StoredSiteSettings.parse({ hideFromSearch: true })

/**
 * Настройки из базы — с запасом на откат версии. Более новая версия API могла записать новое
 * поле или значение, которого прежняя схема не знает (другой язык, длиннее таблица). Прежняя
 * не должна из-за этого ронять админку, сборку и каждый 404: незнакомые ключи отбрасываются, а
 * поле верхнего уровня с непонятным значением читается значением по умолчанию — о нём
 * сообщается onInvalid. В базе оно остаётся как было (settingsRepo пишет поверх сохранённого)
 */
export function readSiteSettings(
  stored: unknown,
  onInvalid?: (field: string) => void,
): StoredSiteSettings {
  // Копия: лишнее удаляется из неё, а не из того, что передали
  const copy: unknown = JSON.parse(JSON.stringify(stored ?? {}))
  const value: Record<string, unknown> =
    typeof copy === 'object' && copy !== null && !Array.isArray(copy)
      ? (copy as Record<string, unknown>)
      : {}
  for (;;) {
    const result = StoredSiteSettings.safeParse(value)
    if (result.success) return result.data
    let progressed = false
    for (const issue of result.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        const target = issue.path.reduce<unknown>(
          (node, key) => (node as Record<PropertyKey, unknown>)?.[key],
          value,
        ) as Record<string, unknown> | undefined
        for (const key of issue.keys) {
          if (target && key in target) {
            delete target[key]
            progressed = true
          }
        }
        continue
      }
      const field = issue.path[0]
      if (typeof field === 'string' && field in value) {
        delete value[field]
        onInvalid?.(field)
        progressed = true
      }
    }
    // Ошибка, которую не исправить удалением поля, — значит, сломана схема, а не данные
    if (!progressed) throw result.error
  }
}

/** Картинки медиатеки, на которые ссылаются настройки: их нельзя удалить, и они нужны сборке */
export function settingsMediaIds(settings: StoredSiteSettings) {
  return [settings.ogImage, settings.icon, settings.organization.logo].filter(
    (id): id is string => id !== null,
  )
}
