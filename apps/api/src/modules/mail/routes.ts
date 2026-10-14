import { Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound, requireOwner } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict } from '../../errors'
import type { MailStatus } from '../../mail/mailer'
import { outboxRepo } from '../../mail/outbox'
import { MailTemplateId, mailTemplateList, previewMail } from '../../mail/templates'
import type { OutboxSettings } from '../../mail/worker'
import { validate } from '../../validate'

/** Почта в зависимостях API: состояние без секретов, настройки очереди и как разбудить обработчик */
export type MailDeps = {
  status: MailStatus
  settings: OutboxSettings
  /** Посмотреть в очередь сейчас. Без обработчика (почта выключена) — ничего не делает */
  wake: () => void
}

const OutboxParams = z.object({ id: Uuid() })
const TemplateParams = z.object({ template: MailTemplateId })

/**
 * Почта в админке: состояние, очередь, повтор и предпросмотр шаблонов. Монтируется на /mail.
 * Только владелец: в очереди адреса людей и ошибки сервера, а настройки почты — общие для всех сайтов
 */
export function mailRoutes({ db, mail }: { db: Db; mail: MailDeps }) {
  const outbox = outboxRepo(db)

  return (
    new Hono<AuthEnv>()
      .use(requireOwner('Почту смотрит и настраивает только владелец админки'))
      .get('/', (c) =>
        c.json(
          { status: mail.status, settings: mail.settings, templates: mailTemplateList() },
          200,
        ),
      )

      .get('/outbox', async (c) => c.json(await outbox.list({ now: new Date() }), 200))

      .post('/outbox/:id/retry', validate('param', OutboxParams), async (c) => {
        const { id } = c.req.valid('param')
        const result = await outbox.retry(id, new Date())
        if (result === 'not_found') return c.json(notFound('Письмо не найдено'), 404)
        if (result === 'busy') {
          return c.json(conflict('Письмо уже отправлено или отправляется прямо сейчас'), 409)
        }
        if (result === 'gone') {
          return c.json(
            conflict(
              'Письмо с одноразовой ссылкой не повторить: ссылка истекла или стёрта после неудачной отправки. ' +
                'Пусть человек запросит новую (сброс пароля, приглашение)',
            ),
            409,
          )
        }
        mail.wake()
        return c.json({ status: 'pending' as const }, 200)
      })

      // Предпросмотр на примерных данных: те же renderMail и макет, что у настоящих писем
      .get('/templates/:template/preview', validate('param', TemplateParams), (c) => {
        const { template } = c.req.valid('param')
        return c.json(previewMail(template), 200)
      })
  )
}
