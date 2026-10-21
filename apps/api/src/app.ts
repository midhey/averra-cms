import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { type Auth, RESET_REQUESTS_PER_IP } from './auth/auth'
import { createPasswordConfirmation } from './auth/confirm-password'
import { type AuthEnv, authenticate } from './auth/middleware'
import type { Db } from './db/client'
import { errorForLog } from './log-error'
import type { IconRenderer } from './media/favicon'
import type { ImageProcessor } from './media/processor'
import type { MediaStorage } from './media/storage'
import { authRoutes } from './modules/auth/routes'
import { buildsRoutes } from './modules/builds/routes'
import { exportRoutes, type PublishedSite } from './modules/export/routes'
import { invitationsRoutes, siteInvitationsRoutes } from './modules/invitations/routes'
import { formsRoutes, type LeadLimits } from './modules/leads/public-routes'
import { leadsRoutes } from './modules/leads/routes'
import { type MailDeps, mailRoutes } from './modules/mail/routes'
import { mediaFilesRoutes, mediaRoutes } from './modules/media/routes'
import { ogRoutes } from './modules/og/routes'
import { revisionsRoutes } from './modules/revisions/routes'
import { iconsRoutes } from './modules/settings/icons'
import { settingsRoutes } from './modules/settings/routes'
import { FALLBACK_PREFIX, siteRoutes } from './modules/site/routes'
import { sitesRoutes } from './modules/sites/routes'
import { statusRoutes } from './modules/status/routes'
import { type HostStatus, noHostStatus } from './modules/status/service'
import type { OgCardRenderers } from './og/card'
import type { SitePublisher } from './publish/queue'
import { createRateLimiter } from './rate-limit'

// Здесь не импортируем Node API (fs, process и т.п.): админка читает типы этого файла.
// Всё платформенное создаётся в index.ts и приходит через deps
export type AppDeps = {
  db: Db
  auth: Auth
  /** Откуда принимаем изменяющие запросы с cookie: адреса админки и самого API */
  trustedOrigins: readonly string[]
  log: (message: string) => void
  /** Где лежат файлы медиатеки: папка на диске, потом S3 */
  storage: MediaStorage
  /** Проверка и нарезка картинок (sharp) */
  images: ImageProcessor
  /** Самый большой файл медиатеки в байтах */
  mediaMaxBytes: number
  /** Набор иконок сайта из картинки медиатеки (sharp, с кешем): favicon.ico, PNG для манифеста */
  icons: IconRenderer
  /**
   * Карточки для соцсетей из заголовка страницы (sharp и Golos Text): опубликованные и
   * предпросмотр — с раздельными кешами и общей очередью
   */
  ogCards: OgCardRenderers
  /**
   * Почта: почта процесса (состояние без секретов, настройки SMTP из админки, проверка
   * подключения) и очередь. Провайдера берёт обработчик очереди (index.ts)
   */
  mail: MailDeps
  /** Адрес админки: из него собираются ссылки в письмах (приглашение, сброс пароля) */
  adminUrl: string
  /**
   * Адрес опубликованного сайта (SITE_URL): его домен админка показывает в панели. Нет — не знаем
   */
  siteUrl?: string
  /**
   * Через сколько миллисекунд, не раньше, отвечать на «Забыли пароль?»: по времени ответа
   * не должно быть видно, есть ли такой адрес. По умолчанию 300
   */
  resetResponseMs?: number
  /** Лимиты приёма заявок с форм: по умолчанию LEAD_LIMITS, тесты ставят свои */
  leadLimits?: LeadLimits
  /**
   * Сборка сайта на сервере после публикации: очередь из src/publish/queue.ts.
   * Нет (разработка, PUBLISH_DIR не задан) — публикация только меняет базу
   */
  publisher?: SitePublisher
  /**
   * Опубликованные сайты на диске — для выгрузки статическим архивом. Есть вместе с publisher
   * (PUBLISH_DIR)
   */
  published?: PublishedSite
  /**
   * Страница 404 текущей версии сайта на сервере (PUBLISH_DIR/main/current/404.html): её отдаёт
   * API на адреса домена сайта, где нет файла и нет редиректа. Есть вместе с publisher
   */
  notFoundPage?: () => Promise<string | undefined>
  /** Версия установки (AVERRA_VERSION из образа). По умолчанию dev */
  version?: string
  /**
   * Сведения с сервера для состояния установки: итоги бэкапов и обновлений из папки состояния
   * (deploy/averra.sh) и место на диске. Нет — ни бэкапов, ни дисков (разработка)
   */
  host?: HostStatus
}

/** Запросов сброса пароля на один адрес: не больше трёх за 15 минут */
const RESET_REQUESTS_PER_EMAIL = { max: 3, windowMs: 15 * 60 * 1000 } as const

export function createApp(deps: AppDeps) {
  const { db, auth, trustedOrigins, log, mail, adminUrl } = deps
  // Свои на каждый экземпляр API: глобального состояния нет, тесты не делят счётчики.
  // По IP — то же правило, что у Better Auth, но проверяется раньше счётчика адресов
  const resetLimits = {
    byIp: createRateLimiter({
      max: RESET_REQUESTS_PER_IP.max,
      windowMs: RESET_REQUESTS_PER_IP.window * 1000,
    }),
    byEmail: createRateLimiter(RESET_REQUESTS_PER_EMAIL),
  }
  // Один счётчик неудач на все пути, которыми вошедший проверяет свой пароль по HTTP:
  // повторный пароль для настроек почты и смена пароля. Двух счётчиков хватило бы на вдвое
  // больший перебор
  const passwords = createPasswordConfirmation(auth)
  const app = new Hono<AuthEnv>()
    // Адреса сайта без файла (fallback) — не построчно: туда идут /favicon.ico и сканеры
    // (/wp-login.php…) со всего интернета, и лог API утонул бы в них. Это не события API
    .use(
      logger((line) => {
        if (!line.includes(` ${FALLBACK_PREFIX}/`)) log(line)
      }),
    )
    .basePath('/api')
    // Закрыто всё, кроме короткого списка в auth/middleware.ts
    .use(authenticate({ db, auth, trustedOrigins }))
    .get('/health', (c) => c.json({ status: 'ok' } as const))
    .get('/health/ready', async (c) => {
      try {
        await db.execute(sql`select 1`)
        return c.json({ status: 'ok', db: 'up' } as const)
      } catch {
        return c.json({ status: 'error', db: 'down' } as const, 503)
      }
    })
    .route(
      '/',
      authRoutes({
        auth,
        mail,
        passwords,
        trustedOrigins,
        resetLimits,
        resetResponseMs: deps.resetResponseMs ?? 300,
      }),
    )
    // Сайт установки без id в адресе: одна установка — один сайт (modules/site)
    .route('/site', siteRoutes({ db, siteUrl: deps.siteUrl, notFoundPage: deps.notFoundPage }))
    .route('/sites', sitesRoutes({ db, publisher: deps.publisher, log, siteUrl: deps.siteUrl }))
    // SEO и настройки сайта — владельцу; иконки сайта открыты: их берёт рендерер (modules/settings)
    .route(
      '/sites/:siteId/settings',
      settingsRoutes({ db, siteUrl: deps.siteUrl, publisher: deps.publisher, log }),
    )
    .route('/sites/:siteId/icons', iconsRoutes({ db, storage: deps.storage, icons: deps.icons }))
    // Карточка из заголовка для соцсетей: открытая — сборке сайта, предпросмотр — админке
    .route('/sites/:siteId', ogRoutes({ db, siteUrl: deps.siteUrl, cards: deps.ogCards }))
    .route('/sites/:siteId/build', buildsRoutes({ db, publisher: deps.publisher }))
    .route('/sites/:siteId/pages/:slug/revisions', revisionsRoutes({ db }))
    .route('/sites/:siteId/media', mediaRoutes({ ...deps, maxBytes: deps.mediaMaxBytes }))
    .route('/media', mediaFilesRoutes(deps))
    .route('/sites/:siteId/invitations', siteInvitationsRoutes({ db, mail, adminUrl }))
    .route('/invitations', invitationsRoutes({ db, auth }))
    .route('/mail', mailRoutes({ db, mail, passwords, log, adminUrl }))
    .route('/sites/:siteId/leads', leadsRoutes({ db, mail }))
    .route(
      '/sites/:siteId/export',
      exportRoutes({
        db,
        storage: deps.storage,
        version: deps.version ?? 'dev',
        published: deps.published,
      }),
    )
    // Состояние установки — только владельцу (modules/status)
    .route(
      '/status',
      statusRoutes({
        db,
        mail,
        version: deps.version ?? 'dev',
        host: deps.host ?? noHostStatus,
        publishEnabled: deps.publisher !== undefined,
      }),
    )
    // Открытый приём заявок с форм опубликованного сайта (без входа, см. auth/middleware.ts)
    .route(
      '/forms',
      formsRoutes({
        db,
        auth,
        mail,
        adminUrl,
        log,
        ...(deps.leadLimits ? { limits: deps.leadLimits } : {}),
      }),
    )

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Не найдено' } }, 404))

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: { code: 'http_error', message: err.message } }, err.status)
    }
    // Ошибка запроса к базе — без параметров: в них бывают секреты (log-error.ts)
    console.error(errorForLog(err))
    return c.json({ error: { code: 'internal', message: 'Внутренняя ошибка сервера' } }, 500)
  })

  return app
}

export type AppType = ReturnType<typeof createApp>
