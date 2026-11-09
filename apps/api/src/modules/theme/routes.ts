import { compileWindowCss } from '@averra/blocks/custom-engine'
import { type Theme, ThemeInput, themeMediaIds, Uuid } from '@averra/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { media } from '../../db/schema'
import { errorForLog } from '../../log-error'
import type { SitePublisher } from '../../publish/queue'
import { validate, validationError } from '../../validate'
import { themeRepo } from './repo'

const SiteParams = z.object({ siteId: Uuid() })

type Issue = { path: string; message: string }

/**
 * Проверки темы, которых нет в схеме: свой CSS окон — тем же движком, что CSS своих блоков (ошибки
 * со строкой; предупреждения — нет, их показывает экран), и фон-картинка — картинка медиатеки
 * этого сайта, а не чужая или удалённая
 */
async function themeIssues(db: Db, siteId: string, theme: Theme): Promise<Issue[]> {
  const issues: Issue[] = []
  if (theme.windowCss && theme.windowCss.trim() !== '') {
    for (const problem of compileWindowCss(theme.windowCss).problems) {
      if (problem.level !== 'error') continue
      issues.push({
        path: 'windowCss',
        message: problem.line ? `Строка ${problem.line}: ${problem.message}` : problem.message,
      })
    }
  }
  // Картинки темы (фон и url(media:…) в CSS окон) — только из медиатеки этого сайта: чужой или
  // удалённой нет в справочнике снимка, и сборка выбросила бы весь CSS окон
  const ids = themeMediaIds(theme)
  if (ids.length > 0) {
    const found = new Set(
      (
        await db
          .select({ id: media.id })
          .from(media)
          .where(and(eq(media.siteId, siteId), inArray(media.id, ids)))
      ).map((row) => row.id),
    )
    if (theme.background && !found.has(theme.background.mediaId)) {
      issues.push({
        path: 'background.mediaId',
        message: 'Картинки нет в медиатеке сайта: выберите другую',
      })
    }
    const background = theme.background?.mediaId
    for (const id of ids) {
      if (id === background || found.has(id)) continue
      issues.push({
        path: 'windowCss',
        message: `Картинки media:${id} нет в медиатеке сайта: загрузите её или уберите из CSS`,
      })
    }
  }
  return issues
}

type ThemeDeps = {
  db: Db
  /** Сборка сайта на сервере после публикации темы. Нет — публикация только меняет базу */
  publisher?: SitePublisher
  log: (message: string) => void
}

/**
 * Тема сайта (экран «Тема» админки): монтируется на /sites/:siteId/theme. Черновик и публикация,
 * как у страниц: «Сохранить» меняет черновик, «Опубликовать» — тему на сайте и пересобирает его.
 * Читать может любой участник и токен (тема и так видна на сайте), менять — только владелец
 * (theme.edit: фирменный стиль делает студия); токену API — нет: тему решает человек, глядя на
 * предпросмотр
 */
export function themeRoutes({ db, publisher, log }: ThemeDeps) {
  const repo = themeRepo(db)
  const site = (permission: Parameters<typeof requireSite>[1]) => requireSite(db, permission)

  return (
    new Hono<AuthEnv>()
      .get('/', validate('param', SiteParams), site('site.read'), async (c) => {
        const view = await repo.read(c.req.valid('param').siteId)
        if (!view) return c.json(notFound('Сайт не найден'), 404)
        return c.json(view, 200)
      })

      // Черновик проверяется той же схемой, что в админке: цвета, шрифты из каталога и контраст
      // основных пар (ThemeInput). Непроходящий контраст — 400 с путём до цвета
      .put(
        '/',
        validate('param', SiteParams),
        site('theme.edit'),
        validate('json', ThemeInput),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const theme = c.req.valid('json')
          const issues = await themeIssues(db, siteId, theme)
          if (issues.length > 0) return c.json(validationError(issues), 400)
          const view = await repo.saveDraft(siteId, theme)
          if (!view) return c.json(notFound('Сайт не найден'), 404)
          return c.json(view, 200)
        },
      )

      // Публикация: черновик ещё раз проходит проверку — тема сайта до редактора тем могла быть
      // с плохим контрастом, и опубликовать её как есть, не поправив, нельзя
      .post('/publish', validate('param', SiteParams), site('theme.edit'), async (c) => {
        const { siteId } = c.req.valid('param')
        // Фон-картинку из медиатеки не удалить, пока она в теме («где используется»), а CSS окон
        // проверен при сохранении черновика: здесь — схема ещё раз
        const result = await repo.publish(siteId, (draft) =>
          ThemeInput.safeParse(draft).error?.issues.map((issue) => ({
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        )
        if (!result) return c.json(notFound('Сайт не найден'), 404)
        if (result.problem) return c.json(validationError(result.problem), 400)
        // Как публикация страницы: сбой постановки в очередь не отменяет публикацию, а
        // «Собрать заново» в настройках сайта поставит сборку ещё раз
        try {
          await publisher?.request(siteId)
        } catch (error) {
          log(
            `Сайт ${siteId}: не удалось поставить сборку в очередь — ${String(errorForLog(error))}`,
          )
        }
        return c.json(result.view, 200)
      })
  )
}
