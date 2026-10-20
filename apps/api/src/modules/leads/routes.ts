import { LeadSettings, LeadStatus, UpdateLead, Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, forbidden, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { errorForLog } from '../../log-error'
import { validate } from '../../validate'
import type { MailDeps } from '../mail/routes'
import { CSV_BOM, csvLine, leadCsvRow, leadsCsvHeader } from './csv'
import { type ExportCursor, leadsRepo, RECENT_LEADS_DEFAULT, RECENT_LEADS_MAX } from './repo'
import { saveLeadSettings } from './service'

const SiteParams = z.object({ siteId: Uuid() })
const LeadParams = SiteParams.extend({ leadId: Uuid() })
const ListQuery = z.object({ status: LeadStatus.optional() })
const RecentQuery = z.object({
  limit: z
    .string()
    .regex(/^\d{1,3}$/u, `Число от 1 до ${RECENT_LEADS_MAX}`)
    .transform(Number)
    .pipe(z.number().int().min(1).max(RECENT_LEADS_MAX))
    .optional(),
})

const LEAD_NOT_FOUND = 'Заявка не найдена'

/**
 * Заявки сайта в админке: список, карточка, «обработана», удаление, CSV и настройки.
 * Монтируется на /sites/:siteId/leads. Права — действия leads.* в auth/access.ts: владелец
 * и клиент сайта; редактору — 403, токену API — 403 при любой таблице (персональные данные)
 */
export function leadsRoutes({ db, mail }: { db: Db; mail: MailDeps }) {
  const repo = leadsRepo(db)
  const site = (permission: Parameters<typeof requireSite>[1]) => requireSite(db, permission)

  return (
    new Hono<AuthEnv>()
      // notifications — уходят ли уведомления: почта выключена — заявки копятся молча,
      // и раздел должен сказать это честно
      .get(
        '/',
        validate('param', SiteParams),
        site('leads.read'),
        validate('query', ListQuery),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const { status } = c.req.valid('query')
          const settings = await repo.settings(siteId)
          const mailStatus = mail.runtime.status()
          return c.json(
            {
              items: await repo.list(siteId, status ? { status } : {}),
              notifications: {
                enabled: mailStatus.enabled,
                reason: mailStatus.enabled ? null : mailStatus.reason,
                recipients:
                  settings && settings.recipients.length > 0
                    ? ('custom' as const)
                    : ('owners' as const),
              },
            },
            200,
          )
        },
      )

      // Последние заявки для обзора сайта: limit штук (по умолчанию RECENT_LEADS_DEFAULT)
      // и только то, что показывает карточка обзора, — без согласия, версии страницы и прочего.
      // Обзор открывают часто, и полный список с персональными данными туда не уходит.
      // Права — как у списка: владелец и клиент, редактору и токену API — 403
      .get(
        '/recent',
        validate('param', SiteParams),
        site('leads.read'),
        validate('query', RecentQuery),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const { limit } = c.req.valid('query')
          return c.json({ items: await repo.recent(siteId, limit ?? RECENT_LEADS_DEFAULT) }, 200)
        },
      )

      // CSV всех заявок сайта потоком: подписи колонок — одним запросом, заявки — порциями
      // по LEADS_EXPORT_BATCH, и каждая порция уходит в ответ, когда её готов принять клиент.
      // В памяти API — одна порция, а не все заявки за срок хранения. Значения-формулы
      // обезврежены (csv.ts)
      .get('/export', validate('param', SiteParams), site('leads.read'), async (c) => {
        const { siteId } = c.req.valid('param')
        const labels = await repo.exportLabels(siteId)
        const date = new Date().toISOString().slice(0, 10)
        return c.body(exportStream(repo, siteId, labels), 200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="leads-${date}.csv"`,
          'Cache-Control': 'no-store',
        })
      })

      .get('/settings', validate('param', SiteParams), site('leads.read'), async (c) => {
        const { siteId } = c.req.valid('param')
        const settings = await repo.settings(siteId)
        if (!settings) return c.json(notFound('Сайт не найден'), 404)
        return c.json(settings, 200)
      })

      .put(
        '/settings',
        validate('param', SiteParams),
        site('leads.settings'),
        validate('json', LeadSettings),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const actor = c.get('actor')
          // Токен API сюда не доходит (персональные данные), но тип этого не знает
          if (actor.kind !== 'user')
            return c.json(forbidden('Настройки заявок меняет человек'), 403)
          const saved = await saveLeadSettings(db, {
            siteId,
            settings: c.req.valid('json'),
            user: actor.user,
            mailEnabled: mail.runtime.status().enabled,
          })
          if (!saved) return c.json(notFound('Сайт не найден'), 404)
          mail.wake()
          return c.json(saved, 200)
        },
      )

      .get('/:leadId', validate('param', LeadParams), site('leads.read'), async (c) => {
        const { siteId, leadId } = c.req.valid('param')
        const lead = await repo.find(siteId, leadId)
        if (!lead) return c.json(notFound(LEAD_NOT_FOUND), 404)
        return c.json(lead, 200)
      })

      .patch(
        '/:leadId',
        validate('param', LeadParams),
        site('leads.manage'),
        validate('json', UpdateLead),
        async (c) => {
          const { siteId, leadId } = c.req.valid('param')
          const { status } = c.req.valid('json')
          const lead = await repo.setStatus(siteId, leadId, status, new Date())
          if (!lead) return c.json(notFound(LEAD_NOT_FOUND), 404)
          return c.json(lead, 200)
        },
      )

      .delete('/:leadId', validate('param', LeadParams), site('leads.manage'), async (c) => {
        const { siteId, leadId } = c.req.valid('param')
        if (!(await repo.remove(siteId, leadId))) return c.json(notFound(LEAD_NOT_FOUND), 404)
        return c.body(null, 204)
      })
  )
}

/**
 * Тело выгрузки CSV. Заголовки и статус 200 уходят раньше заявок, поэтому сбой посреди
 * выгрузки (упала база) нельзя сообщить кодом ответа. Поток тогда завершается ошибкой,
 * а не закрывается: сервер рвёт соединение без конца chunked-ответа, и браузер (fetch в админке)
 * видит сбой вместо обрезанного файла, похожего на целый. В лог — без данных заявок
 */
function exportStream(
  repo: ReturnType<typeof leadsRepo>,
  siteId: string,
  labels: readonly string[],
) {
  const encoder = new TextEncoder()
  let after: ExportCursor | undefined
  let started = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true
          controller.enqueue(encoder.encode(CSV_BOM + csvLine(leadsCsvHeader(labels))))
          return
        }
        const batch = await repo.exportBatch(siteId, after)
        const last = batch.at(-1)
        if (!last) {
          controller.close()
          return
        }
        controller.enqueue(
          encoder.encode(batch.map((lead) => csvLine(leadCsvRow(lead, labels))).join('')),
        )
        after = { at: last.cursorAt, id: last.id }
      } catch (error) {
        console.error(`Выгрузка CSV заявок сайта ${siteId} оборвалась`, errorForLog(error))
        controller.error(new Error('Выгрузка CSV оборвалась'))
      }
    },
  })
}
