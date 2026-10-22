import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { leads, notificationOutbox } from '../db/schema'
import { retryDelayMs } from '../mail/outbox'
import { createTestApi } from '../testing'
import { enqueueNotifications, notificationOutboxRepo } from './outbox'
import { bindChat, fakeTelegram, saveBot, siteWithForm, submitLead } from './testing/scenario'
import { processNotifications, startNotificationWorker } from './worker'

// Очередь уведомлений: заявка и сообщение — одной транзакцией, повторы с растущей паузой,
// окончательный отказ, сбой канала без траты попыток, стирание данных и очистка. Часы — свои

const fake = await fakeTelegram()
const api = await createTestApi({ telegramApiUrl: fake.url })
afterAll(async () => {
  await api.close()
  await fake.close()
})
const owner = await api.loginAs('owner')
expect((await saveBot(api, owner.headers)).status).toBe(200)
const siteId = await siteWithForm(api, owner.headers)
const { chat } = await bindChat(api, fake, owner.headers, {
  siteId,
  chat: { id: 5151, type: 'private', first_name: 'Менеджер' },
})
const chatId = String(chat.id)

const pass = (now: Date, options: { paused?: Set<string> } = {}) =>
  processNotifications({
    db: api.db,
    channels: api.notifications.channels,
    secretBox: api.secretBox,
    readiness: () => api.notifyDeps().readiness,
    maxAttempts: 3,
    now: () => now,
    ...options,
  })

const rowsOf = () =>
  api.db.select().from(notificationOutbox).where(eq(notificationOutbox.address, chatId))

beforeEach(async () => {
  await api.db.delete(notificationOutbox)
})

describe('очередь уведомлений', () => {
  it('заявка кладёт сообщение в той же транзакции; ушло — данные стёрты', async () => {
    expect((await submitLead(api, siteId)).status).toBe(200)
    const [queued] = await rowsOf()
    expect(queued).toMatchObject({ status: 'pending', event: 'lead.new', channel: 'telegram' })
    expect(queued?.data).toMatchObject({ siteName: 'Ремонт' })
    expect(queued?.leadId).toBeTruthy()

    const result = await pass(new Date())
    expect(result).toMatchObject({ claimed: 1, sent: 1 })
    const [sent] = await rowsOf()
    expect(sent).toMatchObject({ status: 'sent', data: null, attempts: 1 })
    expect(sent?.messageId).toBeTruthy()
  })

  it('сломанная очередь уведомлений откатывает заявку: посетитель видит ошибку', async () => {
    await api.db.execute(sql`CREATE FUNCTION fail_notifications() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'очередь уведомлений сломана (тест)'; END $$ LANGUAGE plpgsql`)
    await api.db.execute(sql`CREATE TRIGGER fail_notifications BEFORE INSERT ON notification_outbox
      FOR EACH ROW EXECUTE FUNCTION fail_notifications()`)
    try {
      const before = await api.db.select().from(leads).where(eq(leads.siteId, siteId))
      const res = await submitLead(api, siteId)
      expect(res.status).toBe(500)
      const after = await api.db.select().from(leads).where(eq(leads.siteId, siteId))
      expect(after).toHaveLength(before.length)
    } finally {
      await api.db.execute(sql`DROP TRIGGER fail_notifications ON notification_outbox`)
      await api.db.execute(sql`DROP FUNCTION fail_notifications`)
    }
  })

  it('временный сбой — повтор с растущей паузой, после последней попытки — не отправлено', async () => {
    await submitLead(api, siteId)
    let now = new Date()
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      fake.failNext({ status: 500, description: 'Internal Server Error' }, chatId)
      const result = await pass(now)
      const [row] = await rowsOf()
      if (attempt < 3) {
        expect(result.retry).toBe(1)
        expect(row?.status).toBe('pending')
        expect(row?.nextAttemptAt.getTime()).toBe(now.getTime() + retryDelayMs(attempt))
        // Раньше паузы сообщение не берётся
        expect((await pass(now)).claimed).toBe(0)
        now = new Date(row?.nextAttemptAt.getTime() ?? 0)
      } else {
        expect(result.failed).toBe(1)
        expect(row).toMatchObject({ status: 'failed', data: null })
        expect(row?.lastError).toContain('Сбой на стороне Telegram')
      }
    }
  })

  it('«бот заблокирован» — сразу не отправлено; 429 — пауза не короче просьбы Telegram', async () => {
    await submitLead(api, siteId)
    fake.failNext({ status: 403, description: 'Forbidden: bot was blocked by the user' }, chatId)
    const now = new Date()
    expect((await pass(now)).failed).toBe(1)
    expect((await rowsOf())[0]).toMatchObject({ status: 'failed', data: null, attempts: 1 })

    await api.db.delete(notificationOutbox)
    await submitLead(api, siteId)
    fake.failNext({ status: 429, description: 'Too Many Requests', retryAfter: 600 }, chatId)
    const later = new Date()
    expect((await pass(later)).retry).toBe(1)
    const [row] = await rowsOf()
    expect(row?.nextAttemptAt.getTime()).toBe(later.getTime() + 600_000)
  })

  it('сбой канала (токен) — попытка не тратится, канал выжидает, остальное ждёт', async () => {
    await submitLead(api, siteId)
    await submitLead(api, siteId)
    fake.failNext({ status: 401, description: 'Unauthorized' }, chatId)
    const result = await pass(new Date())
    expect(result.down).toEqual(new Set(['telegram']))
    const rows = await rowsOf()
    expect(rows.every((row) => row.status === 'pending' && row.attempts === 0)).toBe(true)
    expect(rows.map((row) => row.lastError)).toContainEqual(
      expect.stringContaining('не принял токен'),
    )
    // Канал на паузе — его сообщения не берутся вовсе
    expect((await pass(new Date(), { paused: new Set(['telegram']) })).claimed).toBe(0)
    // Ожил — уходят оба
    expect((await pass(new Date())).sent).toBe(2)
  })

  it('удалили заявку — удалились и уведомления о ней; очистка по сроку', async () => {
    await submitLead(api, siteId)
    const [row] = await rowsOf()
    await api.db.delete(leads).where(eq(leads.id, row?.leadId ?? ''))
    expect(await rowsOf()).toEqual([])

    await submitLead(api, siteId)
    await pass(new Date())
    const repo = notificationOutboxRepo(api.db)
    expect(await repo.cleanup({ now: new Date(), retentionDays: 30 })).toBe(0)
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
    expect(await repo.cleanup({ now: later, retentionDays: 30 })).toBe(1)
  })

  it('сбой канала в обработчике — пауза канала растёт: 1 мин, потом 3 мин', async () => {
    // Часы обработчика впереди настоящих: сообщение заявки (время — настоящее) уже пора слать
    let clock = Date.now() + 10 * 60_000
    const log: string[] = []
    const worker = startNotificationWorker({
      db: api.db,
      channels: api.notifications.channels,
      secretBox: api.secretBox,
      readiness: () => api.notifyDeps().readiness,
      maxAttempts: 3,
      retentionDays: 30,
      // Сам по таймеру обработчик в тесте не проснётся: только wake и свои часы
      intervalMs: 60_000,
      cleanupEveryMs: Number.POSITIVE_INFINITY,
      now: () => new Date(clock),
      log: (message) => log.push(message),
    })
    const round = async () => {
      worker.wake()
      await expect.poll(() => worker.busy()).toBe(false)
    }
    try {
      await round()
      const before = fake.messagesTo(chatId).length
      await submitLead(api, siteId)
      fake.failNext({ status: 401, description: 'Unauthorized' }, chatId)
      await round()
      expect(log.at(-1)).toContain('следующая попытка через 60 с')
      // Минуту канал выжидает: сообщение не берётся, хотя в очереди оно готово
      clock += 59_000
      await round()
      expect(fake.messagesTo(chatId)).toHaveLength(before)
      expect((await rowsOf())[0]).toMatchObject({ status: 'pending', attempts: 0 })

      // Пауза вышла, но канал снова не отвечает — следующая пауза втрое длиннее
      clock += 2_000
      fake.failNext({ status: 401, description: 'Unauthorized' }, chatId)
      await round()
      expect(log.at(-1)).toContain('следующая попытка через 180 с')
      clock += 179_000
      await round()
      expect(fake.messagesTo(chatId)).toHaveLength(before)

      clock += 2_000
      await round()
      expect(fake.messagesTo(chatId)).toHaveLength(before + 1)
      expect((await rowsOf())[0]).toMatchObject({ status: 'sent', attempts: 1 })
    } finally {
      await worker.stop()
    }
  })

  it('пауза снимается только с канала, который сам отправил, и после «Проверить» у него', async () => {
    // Второй канал через ту же очередь: «почта», у которой своя отправка. Он шлёт, пока
    // Telegram выжидает, — и паузу Telegram это снимать не должно
    const delivered: string[] = []
    const channels = {
      ...api.notifications.channels,
      email: {
        ...api.notifications.channels.email,
        send: async (_config: unknown, address: string) => {
          delivered.push(address)
          return { messageId: String(delivered.length) }
        },
      },
    }
    let clock = Date.now() + 10 * 60_000
    const log: string[] = []
    const worker = startNotificationWorker({
      db: api.db,
      channels,
      secretBox: api.secretBox,
      readiness: () => api.notifyDeps().readiness,
      maxAttempts: 3,
      retentionDays: 30,
      intervalMs: 60_000,
      cleanupEveryMs: Number.POSITIVE_INFINITY,
      now: () => new Date(clock),
      log: (message) => log.push(message),
    })
    const round = async (reset?: boolean | 'telegram') => {
      worker.wake(reset)
      await expect.poll(() => worker.busy()).toBe(false)
    }
    try {
      await round()
      const before = fake.messagesTo(chatId).length
      await submitLead(api, siteId)
      fake.failNext({ status: 401, description: 'Unauthorized' }, chatId)
      await round()
      expect(log.at(-1)).toContain('следующая попытка через 60 с')

      await enqueueNotifications(
        { tx: api.db, now: new Date() },
        'email',
        {
          event: 'notification.test',
          data: {
            siteName: 'Сайт',
            sentAt: new Date().toISOString(),
            by: 'Владелец',
            byEmail: 'owner@example.ru',
          },
        },
        [{ address: 'ops@example.ru' }],
      )
      clock += 10_000
      await round()
      expect(delivered).toEqual(['ops@example.ru'])
      clock += 10_000
      await round()
      // Почта отправила, а Telegram всё ещё выжидает свою минуту
      expect(fake.messagesTo(chatId)).toHaveLength(before)

      // «Проверить» Telegram прошла — его пауза снята, сообщение уходит сразу
      await round('telegram')
      expect(fake.messagesTo(chatId)).toHaveLength(before + 1)
    } finally {
      await worker.stop()
    }
  })

  it('обработчик в процессе: wake отправляет сразу, stop дожидается', async () => {
    const worker = startNotificationWorker({
      db: api.db,
      channels: api.notifications.channels,
      secretBox: api.secretBox,
      readiness: () => api.notifyDeps().readiness,
      maxAttempts: 3,
      retentionDays: 30,
      intervalMs: 60_000,
    })
    try {
      const before = fake.messagesTo(chatId).length
      await submitLead(api, siteId)
      worker.wake()
      await expect.poll(() => fake.messagesTo(chatId).length).toBe(before + 1)
    } finally {
      await worker.stop()
    }
  })
})
