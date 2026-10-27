import {
  BlockId,
  CONSENT_FIELD,
  ExistingPageSlug,
  FOOTER_FORM_ID,
  FORM_MAX_FIELDS,
  fieldRules,
  HONEYPOT_FIELD,
  leadValuesSchema,
  Uuid,
} from '@averra/schema'
import { getIP } from 'better-auth/api'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { Auth } from '../../auth/auth'
import type { Db } from '../../db/client'
import { errorForLog } from '../../log-error'
import { type NotificationDeps, notifyDepsOf } from '../../notifications/deps'
import { createRateLimiter } from '../../rate-limit'
import type { MailDeps } from '../mail/routes'
import { messagePage, PAGE_HEADERS } from './pages'
import { leadsRepo, storedLeadBytes } from './repo'
import { acceptLead, findPublishedForm, leadSnapshot, pagePath } from './service'

/**
 * Лимиты приёма заявок. По IP считается первым: ключ сайта выбирает клиент
 * (документация: Разработчику → Доступ и секреты, «Лимиты»)
 */
export type LeadLimits = {
  perIp: { max: number; windowMs: number }
  perSite: { max: number; windowMs: number }
  /**
   * Сколько байт данных заявок сайт принимает за последние сутки (считается в базе). Предел
   * отсекает только крупные заявки: см. smallLeadBytes
   */
  perSiteDailyBytes: number
  /**
   * Заявка с данными не больше этого принимается и сверх дневного предела объёма — под обычными
   * лимитами частоты. Иначе спамер, набив предел крупными заявками, закрыл бы форму для всех
   */
  smallLeadBytes: number
}

/** Окно дневного предела объёма */
const LEAD_VOLUME_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * С одного IP — 5 заявок за 10 минут, на сайт — 100 за час и не больше 10 МБ данных крупных
 * заявок за сутки. Честная заявка — 0,5–2 КБ (с одним многострочным полем, заполненным до
 * предела, — около 4,5 КБ), и она меньше smallLeadBytes (8 КБ): её дневной предел не касается,
 * даже когда спамер его выбрал. Заявка спамера, набитая до предела тела, — до ~100 КБ в базе,
 * и предел останавливает такие на сотне. Худший рост базы — 10 МБ крупных плюс 8 КБ × 2400
 * маленьких (≈19 МБ) в сутки на сайт, а не ~240 МБ без предела
 */
const LEAD_LIMITS: LeadLimits = {
  perIp: { max: 5, windowMs: 10 * 60 * 1000 },
  perSite: { max: 100, windowMs: 60 * 60 * 1000 },
  perSiteDailyBytes: 10 * 1024 * 1024,
  smallLeadBytes: 8 * 1024,
}

/**
 * Самое большое тело формы — из пределов схемы, а не на глаз. Худший честный случай: все поля
 * формы многострочные и заполнены до maxlength. maxlength считает единицы UTF-16, а urlencoded
 * превращает каждую в %XX%XX%XX — до 9 байт (кириллица — 6, символ вне BMP — 12 байт на две
 * единицы). Плюс ключи, ловушка и согласие — 16 КБ запаса. Всего около 227 КБ
 */
export const LEAD_BODY_LIMIT = FORM_MAX_FIELDS * fieldRules.textarea.max * 9 + 16 * 1024

/** Форма — блок страницы по его id или форма подвала (~footer: в id блока «~» не бывает) */
const FormParams = z.object({
  siteId: Uuid(),
  slug: ExistingPageSlug,
  blockId: z.union([BlockId, z.literal(FOOTER_FORM_ID)]),
})

/** Якорь текста успеха в блоке формы — как sentAnchor из @averra/blocks (API их не импортирует) */
const sentAnchor = (blockId: string) => `${blockId}-sent`

/** Источник http(s) из заголовка Origin. «null» и всё прочее — нет */
function httpOrigin(value: string | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined
  } catch {
    return undefined
  }
}

function httpUrl(value: string | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/** Путь без хвоста статического хостинга: /o-nas/, /o-nas.html и /o-nas/index.html — это /o-nas */
function normalizedPath(pathname: string) {
  const path = pathname
    .replace(/\/index\.html$/, '')
    .replace(/\.html$/, '')
    .replace(/\/+$/, '')
  return path === '' ? '/' : path
}

/**
 * Страница с формой, куда вернуть посетителя. Источник — Origin (его браузер шлёт с каждой
 * межсайтовой POST-формой), путь — адрес страницы из маршрута приёма: страница и так известна.
 * Referer тут ненадёжен: по умолчанию (strict-origin-when-cross-origin) браузер шлёт в чужой
 * источник только «https://сайт/», без пути. Поэтому путь из Referer берём, лишь если он
 * указывает на эту же страницу (так сохраняется её точный вид: /o-nas/ или /o-nas.html).
 * Перенаправляем только на источник, который сам прислал форму, — открытого редиректа нет.
 * Ни Origin, ни Referer (Origin: null, no-referrer) — undefined: API покажет свою страницу
 */
function returnUrl(origin: string | undefined, referer: string | undefined, slug: string) {
  const fromReferer = httpUrl(referer)
  const source = httpOrigin(origin) ?? fromReferer?.origin
  if (!source) return undefined
  const path = pagePath(slug)
  if (
    fromReferer &&
    fromReferer.origin === source &&
    normalizedPath(fromReferer.pathname) === normalizedPath(path)
  ) {
    return `${source}${fromReferer.pathname}`
  }
  return `${source}${path}`
}

type FormsDeps = {
  db: Db
  auth: Auth
  mail: MailDeps
  notifications: NotificationDeps
  adminUrl: string
  log: (message: string) => void
  limits?: LeadLimits
}

/**
 * Открытый приём заявок с форм опубликованного сайта: POST /api/forms/:siteId/:slug/:blockId
 * (у формы подвала вместо id блока — ~footer, slug — страница, где её отправили),
 * application/x-www-form-urlencoded. Входа нет — это посетитель сайта (маршрут в списке открытых
 * в auth/middleware.ts). Сайт без JavaScript, поэтому ответ — для браузера: 303 обратно на страницу
 * с якорем успеха или понятная HTML-страница ошибки. Кто просит только JSON — ApiError
 */
export function formsRoutes({
  db,
  auth,
  mail,
  notifications,
  adminUrl,
  log,
  limits = LEAD_LIMITS,
}: FormsDeps) {
  // Свои на каждый экземпляр API: глобального состояния нет. IP живёт только здесь, в памяти
  const byIp = createRateLimiter(limits.perIp)
  const bySite = createRateLimiter(limits.perSite)
  const repo = leadsRepo(db)

  const wantsJson = (c: Context) => {
    const accept = c.req.header('accept') ?? ''
    return accept.includes('application/json') && !accept.includes('text/html')
  }

  /** Ошибка: страница для браузера или ApiError для скрипта */
  function failure(
    c: Context,
    status: ContentfulStatusCode,
    error: { code: string; title: string; message: string },
    options: { problems?: { path: string; message: string }[]; back?: string } = {},
  ) {
    const { problems = [], back } = options
    if (wantsJson(c)) {
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(problems.length > 0 ? { issues: problems } : {}),
          },
        },
        status,
      )
    }
    const page = messagePage({
      title: error.title,
      message: error.message,
      problems: problems.map((problem) => problem.message),
      back,
    })
    return c.html(page, status, PAGE_HEADERS)
  }

  /**
   * Принято (или поймана ловушка — снаружи неотличимо): назад на страницу с параметром sent и
   * якорем успеха. sent=<id формы> — адрес «спасибо» для целей аналитики без своего JS (Метрика:
   * «посещение страницы, URL содержит sent=»). Id блока — латиница, цифры, _ и - (BlockId)
   */
  function success(c: Context, slug: string, blockId: string, successText: string) {
    if (wantsJson(c)) return c.json({ status: 'accepted' as const }, 200)
    const back = returnUrl(c.req.header('origin'), c.req.header('referer'), slug)
    if (back) return c.redirect(`${back}?sent=${blockId}#${sentAnchor(blockId)}`, 303)
    return c.html(
      messagePage({ title: 'Заявка отправлена', message: successText }),
      200,
      PAGE_HEADERS,
    )
  }

  const notFound = (c: Context) =>
    failure(c, 404, {
      code: 'not_found',
      title: 'Форма не найдена',
      message:
        'Такой формы на опубликованном сайте нет: страницу могли обновить. Откройте страницу заново и отправьте форму ещё раз',
    })

  const tooMany = (c: Context, retryAfterMs: number) => {
    const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000))
    c.header('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
    return failure(c, 429, {
      code: 'rate_limited',
      title: 'Слишком много заявок',
      message: `С вашего адреса или на этот сайт сейчас отправили слишком много заявок. Попробуйте через ${minutes} мин`,
    })
  }

  /** Дневной предел объёма сайта исчерпан: честный отказ, а не молчаливая потеря заявки */
  const siteFull = (c: Context) => {
    c.header('Retry-After', String(60 * 60))
    return failure(c, 429, {
      code: 'rate_limited',
      title: 'Форма сейчас не принимает заявки',
      message:
        'На этот сайт за сутки пришло слишком много длинных заявок, и форма временно их не принимает. Сократите текст в полях и отправьте снова, попробуйте позже или свяжитесь с компанией другим способом',
    })
  }

  return new Hono().post(
    '/:siteId/:slug/:blockId',
    // Тело больше лимита отклоняется до чтения целиком
    bodyLimit({
      maxSize: LEAD_BODY_LIMIT,
      onError: (c) =>
        failure(c, 413, {
          code: 'payload_too_large',
          title: 'Слишком длинная заявка',
          message:
            'Заявка не отправлена: в полях слишком много текста. Сократите его и отправьте снова',
        }),
    }),
    async (c) => {
      const params = FormParams.safeParse(c.req.param())
      if (!params.success) return notFound(c)
      const { siteId, slug, blockId } = params.data

      // IP — только ключ счётчика в памяти: в базу и в лог он не попадает (152-ФЗ)
      const ip = getIP(c.req.raw, auth.options) ?? 'no-trusted-ip'
      const ipLimit = byIp.take(ip)
      if (!ipLimit.allowed) return tooMany(c, ipLimit.retryAfterMs)

      if (!/^application\/x-www-form-urlencoded\b/i.test(c.req.header('content-type') ?? '')) {
        return failure(c, 415, {
          code: 'unsupported_media_type',
          title: 'Форма не отправлена',
          message:
            'Форма принимает только обычную отправку из браузера (application/x-www-form-urlencoded)',
        })
      }

      const published = await findPublishedForm(db, siteId, slug, blockId, log)
      if (!published) return notFound(c)

      // Повторённый ключ — первое значение: так поле читает и браузерная форма. Объект без
      // прототипа: ключ поля «constructor» иначе нашёлся бы у Object.prototype
      const raw: Record<string, string> = Object.create(null)
      for (const [key, value] of new URLSearchParams(await c.req.text())) {
        if (!Object.hasOwn(raw, key)) raw[key] = value
      }
      const { props } = published

      // Ловушка заполнена — бот. Ответ как при успехе, но заявки и писем нет
      if ((raw[HONEYPOT_FIELD] ?? '').trim() !== '') {
        log(`Форма ${siteId}/${slug}/${blockId}: заполнена ловушка, заявка не сохранена`)
        return success(c, slug, blockId, props.successText)
      }

      const parsed = leadValuesSchema(props.fields).safeParse(raw)
      if (!parsed.success) {
        const labels = new Map(props.fields.map((field) => [field.name, field.label]))
        labels.set(CONSENT_FIELD, 'Согласие на обработку персональных данных')
        const problems = parsed.error.issues.map((issue) => {
          const path = issue.path.map(String).join('.')
          return { path, message: `${labels.get(path) ?? path} — ${issue.message}` }
        })
        const back = returnUrl(c.req.header('origin'), c.req.header('referer'), slug)
        return failure(
          c,
          400,
          {
            code: 'validation',
            title: 'Заявка не отправлена',
            message:
              'Поправьте поля формы и отправьте её снова. Кнопка «Назад» в браузере вернёт к форме с тем, что вы уже ввели',
          },
          { problems, ...(back ? { back: `${back}#${blockId}` } : {}) },
        )
      }

      // Дневной предел объёма — в базе, по заявкам, которые уже сохранены: рост базы спамом
      // ограничен, даже если API перезапускали. Он касается только крупных заявок: маленькие
      // (все честные) проходят и сверх него, иначе спамер закрыл бы форму для всех. Пишем в лог,
      // чтобы студия заметила атаку
      const bytes = storedLeadBytes(leadSnapshot(props.fields, parsed.data))
      if (bytes > limits.smallLeadBytes) {
        const since = new Date(Date.now() - LEAD_VOLUME_WINDOW_MS)
        if ((await repo.storedBytesSince(siteId, since)) >= limits.perSiteDailyBytes) {
          log(`Форма ${siteId}/${slug}/${blockId}: исчерпан дневной предел объёма заявок сайта`)
          return siteFull(c)
        }
      }

      // Лимит сайта — только для заявок, которые будут сохранены. Ловушка и неверные формы его
      // не тратят: иначе бот с многих IP выбрал бы лимит, и настоящие посетители получали бы 429
      const siteLimit = bySite.take(siteId)
      if (!siteLimit.allowed) return tooMany(c, siteLimit.retryAfterMs)

      try {
        await acceptLead(db, {
          form: published,
          values: parsed.data,
          notifications: notifyDepsOf(mail, notifications),
          adminUrl,
        })
      } catch (error) {
        // Транзакция откатилась: нет ни заявки, ни писем. Посетитель должен узнать, что заявка
        // не ушла, — страницей, а не JSON общего обработчика ошибок
        console.error(errorForLog(error))
        return failure(c, 500, {
          code: 'internal',
          title: 'Заявка не сохранена',
          message:
            'Не получилось сохранить заявку из-за сбоя на сервере. Попробуйте ещё раз через несколько минут',
        })
      }
      mail.wake()
      notifications.wake()
      return success(c, slug, blockId, props.successText)
    },
  )
}
