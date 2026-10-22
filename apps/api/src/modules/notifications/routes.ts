import {
  DeleteTelegramChannel,
  LeadEmailRecipients,
  NOTIFICATION_CHATS_MAX,
  NotificationChannelKind,
  NotificationChannelToggle,
  SaveTelegramChannel,
  ServiceEmailRecipients,
  ServiceRecipientEvents,
  Uuid,
} from '@averra/schema'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import type { Actor } from '../../auth/access'
import type { PasswordConfirmations } from '../../auth/confirm-password'
import { type AuthEnv, forbidden, notFound, requireOwner, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict } from '../../errors'
import { toMailLine } from '../../mail/templates/line'
import { type NotificationDeps, notifyDepsOf } from '../../notifications/deps'
import { eventTitle } from '../../notifications/events'
import { notificationOutboxRepo } from '../../notifications/outbox'
import { leadNotificationSummary } from '../../notifications/recipients'
import { type AudienceSite, notificationSettingsRepo } from '../../notifications/settings'
import { issueLinkCode } from '../../notifications/telegram/binder'
import { createRateLimiter } from '../../rate-limit'
import { validate, validationError } from '../../validate'
import type { MailDeps } from '../mail/routes'
import {
  channelsView,
  chatsLeft,
  checkChannel,
  linkStatus,
  linkView,
  recipientView,
  removeRecipient,
  removeTelegram,
  replaceLeadEmails,
  replaceServiceEmails,
  saveTelegram,
  sendTest,
  serviceEvents,
  telegramBot,
  telegramLock,
} from './service'

/** Проверок и тестовых уведомлений: не больше 10 за 15 минут на человека */
export const NOTIFICATION_CHECKS = { max: 10, windowMs: 15 * 60 * 1000 } as const

/**
 * Смен адресов получателей заявок: не больше 10 за 15 минут на человека и сайт. Каждая смена —
 * письмо владельцам и прежним получателям, а имя меняющего задаёт он сам: без предела учётка
 * клиента, чередуя два набора адресов, рассылала бы письма на любые адреса
 */
export const RECIPIENT_CHANGES = { max: 10, windowMs: 15 * 60 * 1000 } as const

const tooManyChanges = (retryAfterMs: number) => ({
  error: {
    code: 'rate_limited',
    message: `Слишком часто меняются получатели. Подождите ${Math.max(1, Math.ceil(retryAfterMs / 60_000))} мин и попробуйте снова`,
  },
})

const OWNER_ONLY = 'Каналы уведомлений и служебные события настраивает владелец админки'

const SiteParams = z.object({ siteId: Uuid() })
const RecipientParams = z.object({ id: Uuid() })
const SiteRecipientParams = SiteParams.extend({ id: Uuid() })
const ChannelParams = z.object({ kind: NotificationChannelKind })

type Deps = {
  db: Db
  mail: MailDeps
  notifications: NotificationDeps
  passwords: PasswordConfirmations
  log: (message: string) => void
}

/** Человек из сессии: токен API сюда не доходит (requireOwner, leads.*), проверка — для типов */
const userOf = (actor: Actor) => (actor.kind === 'user' ? actor.user : undefined)

const NO_TELEGRAM = 'Telegram не подключён: бота задаёт владелец в разделе «Уведомления»'

const tooMany = (retryAfterMs: number) => ({
  error: {
    code: 'rate_limited',
    message: `Слишком много проверок. Подождите ${Math.max(1, Math.ceil(retryAfterMs / 60_000))} мин и попробуйте снова`,
  },
})

/** Одни и те же действия с получателями у обеих аудиторий: привязка чата, отвязка, проверка */
function audienceActions({ db, mail, notifications, log }: Deps) {
  const repo = notificationSettingsRepo(db)
  const checks = createRateLimiter(NOTIFICATION_CHECKS)
  const deps = () => notifyDepsOf(mail, notifications)

  return {
    async list(siteId: AudienceSite) {
      return (await repo.recipients(siteId)).map(recipientView)
    },

    /** Выдать код привязки чата: Telegram должен быть готов, а у аудитории — место для чата */
    async link(c: Context<AuthEnv>, siteId: AudienceSite) {
      const user = userOf(c.var.actor)
      if (!user) return c.json(forbidden(OWNER_ONLY), 403)
      const bot = await telegramBot(db, deps())
      if (!bot) return c.json(conflict(NO_TELEGRAM), 409)
      if ((await chatsLeft(db, siteId, NOTIFICATION_CHATS_MAX)) <= 0) {
        return c.json(
          conflict('Чатов уже десять: отвяжите лишний, прежде чем привязать новый'),
          409,
        )
      }
      const link = await issueLinkCode(db, { siteId, createdBy: user.id, now: new Date() })
      notifications.bind()
      return c.json(linkView(bot.botUsername, link), 201)
    },

    async linkState(c: Context<AuthEnv>, siteId: AudienceSite, id: string) {
      const state = await linkStatus(db, id, siteId, new Date(), notifications.bindProblem())
      if (!state) return c.json(notFound('Код привязки не найден'), 404)
      return c.json(state, 200)
    },

    async remove(c: Context<AuthEnv>, siteId: AudienceSite, id: string) {
      const user = userOf(c.var.actor)
      if (!user) return c.json(forbidden(OWNER_ONLY), 403)
      if (!(await removeRecipient(db, deps(), { siteId, id, user }))) {
        return c.json(notFound('Получатель не найден'), 404)
      }
      log(
        `[${new Date().toISOString()}] Уведомления: получатель ${id} отвязан (${siteId === null ? 'служебные' : `заявки сайта ${siteId}`}), ${toMailLine(user.name, 100, 'без имени')} <${user.email}>`,
      )
      mail.wake()
      notifications.wake()
      return c.body(null, 204)
    },

    async test(c: Context<AuthEnv>, siteId: AudienceSite) {
      const user = userOf(c.var.actor)
      if (!user) return c.json(forbidden(OWNER_ONLY), 403)
      const limit = checks.take(user.id)
      if (!limit.allowed) return c.json(tooMany(limit.retryAfterMs), 429)
      const { queued, fallback } = await sendTest(db, deps(), { siteId, user })
      mail.wake()
      notifications.wake()
      return c.json({ queued, fallback }, 200)
    },

    checks,
  }
}

/**
 * Уведомления установки — только владельцу: каналы (вкл/выкл, бот Telegram и прокси — с его
 * паролем, как SMTP), служебные события и их получатели, проверка каналов и очередь уведомлений.
 * Монтируется на /notifications. Это сопровождение установки, как «Почта» и «Состояние»
 */
export function notificationsRoutes(input: Deps) {
  const { db, mail, notifications, passwords, log } = input
  const repo = notificationSettingsRepo(db)
  const actions = audienceActions(input)
  const deps = () => notifyDepsOf(mail, notifications)

  return (
    new Hono<AuthEnv>()
      .use(requireOwner(OWNER_ONLY))
      .get('/', async (c) => {
        const current = deps()
        return c.json(
          {
            channels: await channelsView(db, current),
            telegramLock: telegramLock(current),
            events: serviceEvents(),
            recipients: await actions.list(null),
          },
          200,
        )
      })

      .put(
        '/channels/:kind',
        validate('param', ChannelParams),
        validate('json', NotificationChannelToggle),
        async (c) => {
          const user = userOf(c.var.actor)
          if (!user) return c.json(forbidden(OWNER_ONLY), 403)
          const { kind } = c.req.valid('param')
          const { enabled } = c.req.valid('json')
          await repo.saveChannel(
            db,
            kind,
            { enabled, updatedBy: user.id },
            new Date(),
            notifications.channels[kind].defaultEnabled,
          )
          log(
            `[${new Date().toISOString()}] Уведомления: канал ${kind} ${enabled ? 'включён' : 'выключен'}, ${user.email}`,
          )
          notifications.wake(true)
          return c.json({ channels: await channelsView(db, deps()) }, 200)
        },
      )

      // Бот Telegram: токен только на запись, смена — с паролем владельца. Токен проверяется getMe
      .put('/telegram', validate('json', SaveTelegramChannel), async (c) => {
        const user = userOf(c.var.actor)
        if (!user) return c.json(forbidden(OWNER_ONLY), 403)
        const lock = telegramLock(deps())
        if (lock) return c.json(conflict(lock), 409)
        const { token, proxy, currentPassword } = c.req.valid('json')
        const confirmed = await passwords.confirm(user, currentPassword, c.req.raw.headers)
        if (!confirmed.ok) return c.json(confirmed.body, confirmed.status)
        const result = await saveTelegram(db, deps(), notifications, {
          token,
          proxy: proxy === undefined ? 'keep' : proxy || null,
          user,
        })
        if (!result.ok)
          return c.json(validationError([{ path: result.path, message: result.message }]), 400)
        log(
          `[${new Date().toISOString()}] Уведомления: бот Telegram @${result.bot.username} сохранён, ${user.email}` +
            (result.dropped > 0 ? `; отвязано чатов прежнего бота: ${result.dropped}` : ''),
        )
        mail.wake()
        notifications.wake(true)
        return c.json({ channels: await channelsView(db, deps()), dropped: result.dropped }, 200)
      })

      .delete('/telegram', validate('json', DeleteTelegramChannel), async (c) => {
        const user = userOf(c.var.actor)
        if (!user) return c.json(forbidden(OWNER_ONLY), 403)
        const { currentPassword } = c.req.valid('json')
        const confirmed = await passwords.confirm(user, currentPassword, c.req.raw.headers)
        if (!confirmed.ok) return c.json(confirmed.body, confirmed.status)
        const dropped = await removeTelegram(db, deps(), user)
        log(`[${new Date().toISOString()}] Уведомления: бот Telegram удалён, ${user.email}`)
        mail.wake()
        notifications.wake(true)
        return c.json({ channels: await channelsView(db, deps()), dropped }, 200)
      })

      // «Проверить» у канала: как — решает его адаптер (check). Telegram — сразу (getMe и
      // сообщение в чаты), почта — письмо себе через очередь писем
      .post('/channels/:kind/check', validate('param', ChannelParams), async (c) => {
        const user = userOf(c.var.actor)
        if (!user) return c.json(forbidden(OWNER_ONLY), 403)
        const limit = actions.checks.take(user.id)
        if (!limit.allowed) return c.json(tooMany(limit.retryAfterMs), 429)
        const { kind } = c.req.valid('param')
        const result = await checkChannel(db, deps(), kind, user)
        if (result.queued > 0) mail.wake()
        // Проверка прошла — канал снова работает: его сообщения не ждут конца паузы после сбоя
        if (result.ok) notifications.wake(kind)
        else if (result.queued > 0) notifications.wake()
        return c.json({ ok: result.ok, steps: result.steps }, 200)
      })

      .put('/service/email', validate('json', ServiceEmailRecipients), async (c) => {
        const user = userOf(c.var.actor)
        if (!user) return c.json(forbidden(OWNER_ONLY), 403)
        const rows = await replaceServiceEmails(db, deps(), {
          recipients: c.req.valid('json').recipients,
          user,
        })
        return c.json({ recipients: rows.map(recipientView) }, 200)
      })

      .patch(
        '/service/recipients/:id',
        validate('param', RecipientParams),
        validate('json', ServiceRecipientEvents),
        async (c) => {
          const { id } = c.req.valid('param')
          const row = await repo.recipient(null, id)
          if (!row) return c.json(notFound('Получатель не найден'), 404)
          await repo.setEvents(db, row.id, c.req.valid('json').events)
          return c.json({ recipients: await actions.list(null) }, 200)
        },
      )

      .delete('/service/recipients/:id', validate('param', RecipientParams), (c) =>
        actions.remove(c, null, c.req.valid('param').id),
      )

      .post('/service/telegram/link', (c) => actions.link(c, null))

      .get('/service/telegram/link/:id', validate('param', RecipientParams), (c) =>
        actions.linkState(c, null, c.req.valid('param').id),
      )

      .post('/service/test', (c) => actions.test(c, null))

      // Последние сообщения очереди уведомлений (Telegram): без данных — в них заявки
      .get('/outbox', async (c) =>
        c.json(
          (await notificationOutboxRepo(db).list()).map((item) => ({
            ...item,
            title: eventTitle(item.event),
          })),
          200,
        ),
      )
  )
}

/**
 * Уведомления о заявках сайта: получатели (почта и чаты Telegram), привязка чата и проверка.
 * Монтируется на /sites/:siteId/notifications. Права — как у настроек заявок (leads.settings):
 * владелец и клиент сайта, редактору — 403, токену API — 403 всегда (персональные данные)
 */
export function siteNotificationsRoutes(input: Deps) {
  const { db, mail, notifications } = input
  const actions = audienceActions(input)
  const deps = () => notifyDepsOf(mail, notifications)
  const changes = createRateLimiter(RECIPIENT_CHANGES)
  const site = (permission: Parameters<typeof requireSite>[1]) => requireSite(db, permission)

  return (
    new Hono<AuthEnv>()
      // Каналы — только то, что нужно для привязки: готов ли канал и почему нет, имя бота
      .get('/', validate('param', SiteParams), site('leads.read'), async (c) => {
        const { siteId } = c.req.valid('param')
        const current = deps()
        const channels = (await channelsView(db, current, 'site')).map((channel) => ({
          kind: channel.kind,
          title: channel.title,
          ready: channel.ready,
          reason: channel.reason,
          details: channel.details,
        }))
        return c.json(
          {
            channels,
            recipients: await actions.list(siteId),
            summary: await leadNotificationSummary(db, current, siteId),
          },
          200,
        )
      })

      .put(
        '/email',
        validate('param', SiteParams),
        site('leads.settings'),
        validate('json', LeadEmailRecipients),
        async (c) => {
          const user = userOf(c.var.actor)
          if (!user) return c.json(forbidden('Получателей заявок меняет человек'), 403)
          const { siteId } = c.req.valid('param')
          const limit = changes.take(`${user.id}:${siteId}`)
          if (!limit.allowed) return c.json(tooManyChanges(limit.retryAfterMs), 429)
          const changed = await replaceLeadEmails(db, deps(), {
            siteId,
            addresses: c.req.valid('json').addresses,
            user,
          })
          if (!changed) return c.json(notFound('Сайт не найден'), 404)
          mail.wake()
          notifications.wake()
          return c.json({ recipients: await actions.list(siteId), notified: changed.notified }, 200)
        },
      )

      .delete(
        '/recipients/:id',
        validate('param', SiteRecipientParams),
        site('leads.settings'),
        (c) => {
          const { siteId, id } = c.req.valid('param')
          return actions.remove(c, siteId, id)
        },
      )

      .post('/telegram/link', validate('param', SiteParams), site('leads.settings'), (c) =>
        actions.link(c, c.req.valid('param').siteId),
      )

      .get(
        '/telegram/link/:id',
        validate('param', SiteRecipientParams),
        site('leads.settings'),
        (c) => {
          const { siteId, id } = c.req.valid('param')
          return actions.linkState(c, siteId, id)
        },
      )

      .post('/test', validate('param', SiteParams), site('leads.settings'), (c) =>
        actions.test(c, c.req.valid('param').siteId),
      )
  )
}
