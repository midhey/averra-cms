import { CheckMailSettings, DeleteMailSettings, SaveMailSettings, Uuid } from '@averra/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Actor } from '../../auth/access'
import type { PasswordConfirmations } from '../../auth/confirm-password'
import { type AuthEnv, forbidden, notFound, requireOwner } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { checkStale, conflict, mailSettingsLocked } from '../../errors'
import { createCheckTokens } from '../../mail/check-token'
import { describeMailer } from '../../mail/mailer'
import { outboxRepo } from '../../mail/outbox'
import type { MailRuntime } from '../../mail/runtime'
import { mailSettingsFieldLabels, mailSettingsRepo } from '../../mail/settings'
import { MailTemplateId, mailTemplateList, previewMail, renderMail } from '../../mail/templates'
import { toMailLine } from '../../mail/templates/line'
import type { OutboxSettings } from '../../mail/worker'
import { createRateLimiter } from '../../rate-limit'
import { validate, validationError } from '../../validate'
import {
  checkPasswordOf,
  removeSmtp,
  saveSmtp,
  shapeOfInput,
  smtpInfoOf,
  smtpLockOf,
  smtpView,
} from './smtp-service'

/**
 * Почта в зависимостях API: почта процесса (состояние меняется без перезапуска — настройки SMTP
 * правят в админке), настройки очереди и как разбудить обработчик
 */
export type MailDeps = {
  runtime: MailRuntime
  settings: OutboxSettings
  /** Посмотреть в очередь сейчас. Без обработчика — ничего не делает */
  wake: () => void
}

/** Проверок подключения: не больше 10 за 15 минут на владельца — сервер не сканер портов */
export const SMTP_CHECKS = { max: 10, windowMs: 15 * 60 * 1000 } as const

const OWNER_ONLY = 'Почту смотрит и настраивает только владелец админки'

const OutboxParams = z.object({ id: Uuid() })
const TemplateParams = z.object({ template: MailTemplateId })

/** Владелец из requireOwner: токен и участник сюда не доходят, проверка — для типов */
const userOf = (actor: Actor) => (actor.kind === 'user' ? actor.user : undefined)

/** Ошибка у поля формы SMTP — как ошибки схемы: админка покажет её у поля */
const fieldIssue = (path: 'password' | 'to', message: string) =>
  validationError([{ path, message }])

/**
 * Почта в админке: состояние, настройки SMTP, очередь, повтор и предпросмотр шаблонов.
 * Монтируется на /mail. Только владелец: в очереди адреса людей и ошибки сервера, а настройки
 * почты — общие для всех сайтов. Менять SMTP — ещё и с повторным вводом своего пароля
 * (passwords: счётчик неудач общий со сменой пароля, auth/confirm-password.ts)
 */
export function mailRoutes({
  db,
  mail,
  passwords,
  log,
}: {
  db: Db
  mail: MailDeps
  passwords: PasswordConfirmations
  log: (message: string) => void
}) {
  const outbox = outboxRepo(db)
  const { runtime } = mail
  // Свои на каждый экземпляр API, как остальные лимиты: глобального состояния нет
  const checkTokens = createCheckTokens()
  const checks = createRateLimiter(SMTP_CHECKS)
  const changeDeps = { db, runtime, log, wake: mail.wake }

  return (
    new Hono<AuthEnv>()
      .use(requireOwner(OWNER_ONLY))
      .get('/', (c) =>
        c.json(
          { status: runtime.status(), settings: mail.settings, templates: mailTemplateList() },
          200,
        ),
      )

      // Настройки SMTP без пароля: откуда они, можно ли менять и почему нет
      .get('/smtp', async (c) => c.json(await smtpView(db, runtime), 200))

      // «Проверить подключение»: те же шаги, что у pnpm mail:test, по ещё не сохранённым
      // настройкам. Порт — только 465 или 587 (схема), проверок — не больше SMTP_CHECKS.
      // Пароля владельца проверка не просит, поэтому сохранённый пароль SMTP в ней — только
      // с сохранёнными настройками и на почту владельца (checkPasswordOf)
      .post('/smtp/check', validate('json', CheckMailSettings), async (c) => {
        const user = userOf(c.var.actor)
        if (!user) return c.json(forbidden(OWNER_ONLY), 403)
        const lock = smtpLockOf(runtime)
        if (lock) return c.json(mailSettingsLocked(lock.message), 409)
        const input = c.req.valid('json')
        const row = await mailSettingsRepo(db).get()
        const password = checkPasswordOf(runtime, row, input, user.email)
        if (!password.ok) return c.json(fieldIssue(password.path, password.message), 400)
        // Считаем только настоящие проверки — те, что идут к серверу
        const limit = checks.take(user.id)
        if (!limit.allowed) {
          const minutes = Math.max(1, Math.ceil(limit.retryAfterMs / 60_000))
          return c.json(
            {
              error: {
                code: 'rate_limited',
                message: `Слишком много проверок подключения. Подождите ${minutes} мин и попробуйте снова`,
              },
            },
            429,
          )
        }
        const shape = shapeOfInput(input)
        const rendered = renderMail('mail-test', {
          sentAt: new Date().toISOString(),
          provider: toMailLine(describeMailer(smtpInfoOf(shape)), 300, 'SMTP'),
          via: 'admin',
        })
        const diagnosis = await runtime.diagnose(
          {
            host: shape.host,
            port: shape.port,
            security: shape.security,
            user: shape.user,
            password: password.password,
            from: { address: shape.fromAddress, name: shape.fromName },
          },
          { to: input.to, ...rendered },
        )
        const checkToken = diagnosis.ok
          ? await checkTokens.issue(user.id, { ...shape, password: password.password })
          : null
        return c.json({ ok: diagnosis.ok, steps: diagnosis.steps, checkToken }, 200)
      })

      // Сохранить SMTP: только с паролем владельца и итогом проверки (или «без проверки»)
      .put('/smtp', validate('json', SaveMailSettings), async (c) => {
        const user = userOf(c.var.actor)
        if (!user) return c.json(forbidden(OWNER_ONLY), 403)
        const lock = smtpLockOf(runtime)
        if (lock) return c.json(mailSettingsLocked(lock.message), 409)
        const { currentPassword, ...input } = c.req.valid('json')
        const confirmed = await passwords.confirm(user, currentPassword, c.req.raw.headers)
        if (!confirmed.ok) return c.json(confirmed.body, confirmed.status)
        const result = await saveSmtp(changeDeps, checkTokens, input, user)
        if (!result.ok) {
          if (result.problem === 'password') {
            return c.json(fieldIssue('password', result.message), 400)
          }
          return c.json(checkStale(), 409)
        }
        return c.json(
          {
            smtp: await smtpView(db, runtime),
            changed: result.fields.map((field) => mailSettingsFieldLabels[field]),
            notified: result.notified,
          },
          200,
        )
      })

      // Удалить SMTP из админки: почта вернётся к варианту по умолчанию. Тоже с паролем
      .delete('/smtp', validate('json', DeleteMailSettings), async (c) => {
        const user = userOf(c.var.actor)
        if (!user) return c.json(forbidden(OWNER_ONLY), 403)
        const lock = smtpLockOf(runtime)
        if (lock) return c.json(mailSettingsLocked(lock.message), 409)
        const { currentPassword } = c.req.valid('json')
        const confirmed = await passwords.confirm(user, currentPassword, c.req.raw.headers)
        if (!confirmed.ok) return c.json(confirmed.body, confirmed.status)
        const result = await removeSmtp(changeDeps, user)
        if (!result.ok) return c.json(notFound('Настроек SMTP в админке нет'), 404)
        return c.json({ smtp: await smtpView(db, runtime), notified: result.notified }, 200)
      })

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
