import { Header, headerContacts, headerLinkIssues, MAIN_PAGE_SLUG, Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict } from '../../errors'
import { errorForLog } from '../../log-error'
import type { SitePublisher } from '../../publish/queue'
import { validate } from '../../validate'
import { readStoredSettings } from '../settings/read'
import { sitesRepo } from '../sites/repo'
import { headerRepo } from './repo'

const SiteParams = z.object({ siteId: Uuid() })

type HeaderDeps = {
  db: Db
  /** Сборка сайта на сервере после публикации шапки. Нет — публикация только меняет базу */
  publisher?: SitePublisher
  log: (message: string) => void
}

/**
 * Шапка сайта и меню (экран «Шапка и подвал» админки): монтируется на /sites/:siteId/header.
 * Черновик и публикация, как у темы: «Сохранить» меняет черновик, «Опубликовать» — шапку на сайте
 * и пересобирает его. Читать может любой участник и токен (шапка и так видна на сайте), менять —
 * владелец и редактор (header.edit); токену API — нет: шапку на всех страницах решает человек,
 * глядя на предпросмотр
 */
export function headerRoutes({ db, publisher, log }: HeaderDeps) {
  const repo = headerRepo(db)
  const site = (permission: Parameters<typeof requireSite>[1]) => requireSite(db, permission)
  // Как публикация страницы: сбой постановки в очередь не отменяет изменение, а «Собрать заново»
  // в настройках сайта поставит сборку ещё раз
  const rebuild = async (siteId: string) => {
    try {
      await publisher?.request(siteId)
    } catch (error) {
      log(`Сайт ${siteId}: не удалось поставить сборку в очередь — ${String(errorForLog(error))}`)
    }
  }

  return (
    new Hono<AuthEnv>()
      // Черновик, шапка на сайте и цели меню — страницы с блоками. Телефон и адрес организации —
      // для предпросмотра, только людям: телефон ИП — персональные данные, токену их не отдаём.
      // И людям — только когда они уже на сайте: до публикации главной снимок прячет организацию,
      // а «SEO → Организация» видит лишь владелец. Так редактор не узнает здесь больше, чем на сайте
      .get('/', validate('param', SiteParams), site('site.read'), async (c) => {
        const { siteId } = c.req.valid('param')
        const state = await repo.read(siteId)
        const found = state && (await sitesRepo(db).find(siteId))
        if (!state || !found) return c.json(notFound('Сайт не найден'), 404)
        const targets = await repo.targets(siteId)
        const onSite = targets.some((page) => page.slug === MAIN_PAGE_SLUG && page.published)
        const contacts =
          c.var.actor.kind === 'user' && onSite
            ? headerContacts(readStoredSettings(found.settings).organization)
            : null
        return c.json({ ...state, targets, contacts }, 200)
      })

      // Черновик: схема (раскладка, до 8 пунктов, только свои страницы и блоки), логотип из
      // медиатеки, страницы и блоки меню существуют — хотя бы в черновике
      .put(
        '/',
        validate('param', SiteParams),
        site('header.edit'),
        validate('json', Header),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const header = c.req.valid('json')
          const issues = [
            ...(await repo.logoIssues(siteId, header)),
            ...headerLinkIssues(header, await repo.targets(siteId), 'draft'),
          ]
          if (issues.length > 0) {
            return c.json(conflict('Шапку не сохранить: причина — у каждого поля', issues), 409)
          }
          const state = await repo.saveDraft(siteId, header)
          if (!state) return c.json(notFound('Сайт не найден'), 404)
          return c.json(state, 200)
        },
      )

      // Публикация: пункты меню и кнопка должны вести на опубликованные страницы и блоки — иначе
      // на сайте вышла бы битая ссылка. Логотип мог исчезнуть из медиатеки после сохранения
      .post('/publish', validate('param', SiteParams), site('header.edit'), async (c) => {
        const { siteId } = c.req.valid('param')
        const result = await repo.publish(siteId, (draft, targets) =>
          headerLinkIssues(draft, targets, 'published'),
        )
        if (!result) return c.json(notFound('Сайт не найден'), 404)
        if (result.problem) {
          const first = result.problem[0]?.message ?? ''
          return c.json(conflict(`Шапку не опубликовать. ${first}`, result.problem), 409)
        }
        await rebuild(siteId)
        return c.json(result.state, 200)
      })

      // Убрать шапку с сайта (снова «шапки нет», как до первой публикации): настройки остаются
      // черновиком. Сайт пересобирается, если шапка на нём была
      .delete('/', validate('param', SiteParams), site('header.edit'), async (c) => {
        const { siteId } = c.req.valid('param')
        const result = await repo.unpublish(siteId)
        if (!result) return c.json(notFound('Сайт не найден'), 404)
        if (result.wasOnSite) await rebuild(siteId)
        return c.json(result.state, 200)
      })
  )
}
