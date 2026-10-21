import {
  MAIN_PAGE_SLUG,
  normalizeRedirectPath,
  redirectTableIssues,
  type SiteSettings,
  SiteSettingsPatch,
  Uuid,
} from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict, type Issue } from '../../errors'
import { errorForLog } from '../../log-error'
import type { SitePublisher } from '../../publish/queue'
import { validate } from '../../validate'
import { mediaRepo } from '../media/repo'
import { sitesRepo } from '../sites/repo'
import { effectiveSiteUrl, settingsRepo } from './repo'

const SiteParams = z.object({ siteId: Uuid() })

const pagePath = (slug: string) => (slug === MAIN_PAGE_SLUG ? '/' : `/${slug}`)

type SettingsDeps = {
  db: Db
  /** Адрес установки (SITE_URL): адрес сайта по умолчанию */
  siteUrl: string | undefined
  publisher?: SitePublisher
  log: (message: string) => void
}

/**
 * SEO и настройки сайта (раздел «SEO» админки): монтируется на /sites/:siteId/settings. Права —
 * site.settings (только владелец, auth/access.ts). Сохранение пересобирает сайт: всё отсюда —
 * в HTML каждой страницы, robots.txt и sitemap.xml
 */
/**
 * Нужна ли пересборка сайта. Редиректы в релиз не попадают: их читает API на адресах без файла
 * (GET /api/site/fallback/*), поэтому таблица действует сразу, а сборка ради неё — лишняя работа
 * VPS и лишняя строка в журнале сборок
 */
const needsRebuild = (patch: SiteSettingsPatch) =>
  Object.keys(patch).some((key) => key !== 'redirects')

export function settingsRoutes({ db, siteUrl, publisher, log }: SettingsDeps) {
  const repo = settingsRepo(db)
  const media = mediaRepo(db)
  const pages = sitesRepo(db)
  const site = (permission: Parameters<typeof requireSite>[1]) => requireSite(db, permission)

  const response = (settings: SiteSettings) => ({
    settings,
    installationUrl: siteUrl ?? null,
    url: effectiveSiteUrl(settings, siteUrl),
  })

  /** Картинки настроек — только из медиатеки этого сайта, как картинки страниц */
  async function missingMedia(siteId: string, patch: SiteSettingsPatch): Promise<Issue[]> {
    const refs = [
      { path: 'ogImage', id: patch.ogImage },
      { path: 'icon', id: patch.icon },
      { path: 'organization.logo', id: patch.organization?.logo },
    ].flatMap(({ path, id }) => (typeof id === 'string' ? [{ path, id }] : []))
    const existing = await media.existingIds(
      siteId,
      refs.map((ref) => ref.id),
    )
    return refs
      .filter((ref) => !existing.has(ref.id))
      .map((ref) => ({
        path: ref.path,
        message: 'Картинки нет в медиатеке сайта: выберите другую',
      }))
  }

  /**
   * Редирект с адреса, где есть страница, не сработает: Caddy отдаёт файл страницы и до API не
   * доходит. Поэтому такой редирект не сохраняем, а говорим, что мешает
   */
  async function shadowedRedirects(siteId: string, patch: SiteSettingsPatch): Promise<Issue[]> {
    if (!patch.redirects?.length) return []
    const byPath = new Map(
      (await pages.listPages(siteId)).map((page) => [
        normalizeRedirectPath(pagePath(page.slug)),
        page,
      ]),
    )
    return patch.redirects.flatMap(({ from }, index) => {
      const page = byPath.get(from)
      return page
        ? [
            {
              path: `redirects.${index}.from`,
              message: `По этому адресу есть страница «${page.title}»: она главнее редиректа. Удалите страницу или выберите другой адрес`,
            },
          ]
        : []
    })
  }

  /**
   * Ссылка https на свой же домен — тот же внутренний адрес: /a → https://сайт/a — петля. Схема
   * адреса сайта не знает, поэтому эта проверка здесь — и при смене таблицы, и при смене адреса
   * (таблица могла стать петлёй из-за нового адреса)
   */
  async function sameSiteLoops(siteId: string, patch: SiteSettingsPatch): Promise<Issue[]> {
    if (patch.redirects === undefined && patch.url === undefined) return []
    const stored = await repo.read(siteId)
    if (!stored) return []
    const url = effectiveSiteUrl({ url: patch.url ?? stored.url }, siteUrl)
    if (!url) return []
    const redirects = patch.redirects ?? stored.redirects
    return redirectTableIssues(redirects, url).map((issue) => {
      if (patch.redirects) {
        return { path: `redirects.${issue.index}.${issue.field}`, message: issue.message }
      }
      const redirect = redirects[issue.index]
      return {
        path: 'url',
        message: `С этим адресом редирект ${redirect?.from} → ${redirect?.to} ведёт по кругу: поправьте таблицу редиректов`,
      }
    })
  }

  return new Hono<AuthEnv>()
    .get('/', validate('param', SiteParams), site('site.settings'), async (c) => {
      const settings = await repo.read(c.req.valid('param').siteId)
      if (!settings) return c.json(notFound('Сайт не найден'), 404)
      return c.json(response(settings), 200)
    })

    .patch(
      '/',
      validate('param', SiteParams),
      site('site.settings'),
      validate('json', SiteSettingsPatch),
      async (c) => {
        const { siteId } = c.req.valid('param')
        const patch = c.req.valid('json')
        const issues = [
          ...(await missingMedia(siteId, patch)),
          ...(await shadowedRedirects(siteId, patch)),
          ...(await sameSiteLoops(siteId, patch)),
        ]
        if (issues.length > 0) {
          return c.json(conflict('Настройки спорят с тем, что уже есть на сайте', issues), 409)
        }
        const saved = await repo.update(siteId, patch)
        if (!saved) return c.json(notFound('Сайт не найден'), 404)
        if (!needsRebuild(patch)) return c.json(response(saved), 200)
        // Как публикация: сбой постановки в очередь не отменяет сохранение, а «Собрать заново»
        // в настройках сайта поставит сборку ещё раз
        try {
          await publisher?.request(siteId)
        } catch (error) {
          log(
            `Сайт ${siteId}: не удалось поставить сборку в очередь — ${String(errorForLog(error))}`,
          )
        }
        return c.json(response(saved), 200)
      },
    )
}
