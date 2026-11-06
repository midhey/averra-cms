import { scriptProblems } from '@averra/blocks/custom-engine'
import { SiteScript, SiteScriptPublish, Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict } from '../../errors'
import { errorForLog } from '../../log-error'
import type { SitePublisher } from '../../publish/queue'
import { validate, validationError } from '../../validate'
import { type SiteScriptState, siteScriptRepo } from './repo'

const SiteParams = z.object({ siteId: Uuid() })

const changedDraft =
  'Черновик скрипта изменили, пока он был открыт (например, через MCP): проверьте его и опубликуйте снова'

type Deps = {
  db: Db
  /** Сборка сайта после публикации: скрипт и CSP — на каждой странице */
  publisher?: SitePublisher
  log: (message: string) => void
}

/** Состояние с замечаниями к черновику: то же, что проверяет публикация */
const withProblems = (state: SiteScriptState) => ({
  ...state,
  problems: scriptProblems(state.draft.script),
})

/**
 * Скрипт сайта (экран «Скрипт сайта»): монтируется на /sites/:siteId/script. Свой JS — код на
 * каждой странице, поэтому права — как у своих блоков: черновик читает и пишет владелец, токен —
 * по праву «Черновики своих блоков» (blocks.draft); публикует только владелец (blocks.define,
 * токену — никогда). Администратору сайта и редактору — нет
 */
export function siteScriptRoutes({ db, publisher, log }: Deps) {
  const repo = siteScriptRepo(db)
  const site = (permission: Parameters<typeof requireSite>[1]) => requireSite(db, permission)
  const rebuild = async (siteId: string) => {
    try {
      await publisher?.request(siteId)
    } catch (error) {
      log(`Сайт ${siteId}: не удалось поставить сборку в очередь — ${String(errorForLog(error))}`)
    }
  }

  return (
    new Hono<AuthEnv>()
      .get('/', validate('param', SiteParams), site('blocks.draft'), async (c) => {
        const state = await repo.read(c.req.valid('param').siteId)
        if (!state) return c.json(notFound('Сайт не найден'), 404)
        return c.json(withProblems(state), 200)
      })

      // Черновик сохраняется и с ошибкой разбора — её показывают замечания; опубликовать нельзя
      .put(
        '/',
        validate('param', SiteParams),
        site('blocks.draft'),
        validate('json', SiteScript),
        async (c) => {
          const state = await repo.saveDraft(c.req.valid('param').siteId, c.req.valid('json'))
          if (!state) return c.json(notFound('Сайт не найден'), 404)
          return c.json(withProblems(state), 200)
        },
      )

      // Отменить черновик: снова как на сайте
      .delete('/', validate('param', SiteParams), site('blocks.draft'), async (c) => {
        const state = await repo.discardDraft(c.req.valid('param').siteId)
        if (!state) return c.json(notFound('Сайт не найден'), 404)
        return c.json(withProblems(state), 200)
      })

      // Публикация — только без ошибок разбора и только того черновика, который видел человек
      .post(
        '/publish',
        validate('param', SiteParams),
        site('blocks.define'),
        validate('json', SiteScriptPublish),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const { draft: seen } = c.req.valid('json')
          const errors = scriptProblems(seen.script).filter((problem) => problem.level === 'error')
          if (errors.length > 0) {
            return c.json(
              validationError(
                errors.map((problem) => ({ path: 'script', message: problem.message })),
              ),
              400,
            )
          }
          const result = await repo.publish(siteId, seen)
          if (!result) return c.json(notFound('Сайт не найден'), 404)
          if (result.changed) return c.json(conflict(changedDraft), 409)
          await rebuild(siteId)
          return c.json(withProblems(result.state), 200)
        },
      )
  )
}
