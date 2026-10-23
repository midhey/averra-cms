import { ThemeInput, Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { errorForLog } from '../../log-error'
import type { SitePublisher } from '../../publish/queue'
import { validate, validationError } from '../../validate'
import { themeRepo } from './repo'

const SiteParams = z.object({ siteId: Uuid() })

type ThemeDeps = {
  db: Db
  /** Сборка сайта на сервере после публикации темы. Нет — публикация только меняет базу */
  publisher?: SitePublisher
  log: (message: string) => void
}

/**
 * Тема сайта (экран «Тема» админки): монтируется на /sites/:siteId/theme. Черновик и публикация,
 * как у страниц: «Сохранить» меняет черновик, «Опубликовать» — тему на сайте и пересобирает его.
 * Читать может любой участник и токен (тема и так видна на сайте), менять — владелец и редактор
 * (theme.edit); токену API — нет: тему решает человек, глядя на предпросмотр
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
          const view = await repo.saveDraft(c.req.valid('param').siteId, c.req.valid('json'))
          if (!view) return c.json(notFound('Сайт не найден'), 404)
          return c.json(view, 200)
        },
      )

      // Публикация: черновик ещё раз проходит проверку — тема сайта до редактора тем могла быть
      // с плохим контрастом, и опубликовать её как есть, не поправив, нельзя
      .post('/publish', validate('param', SiteParams), site('theme.edit'), async (c) => {
        const { siteId } = c.req.valid('param')
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
