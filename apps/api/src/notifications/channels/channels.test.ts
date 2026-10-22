import { NotificationChannelKind } from '@averra/schema'
import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { mailOutbox, notificationChannels, notificationOutbox } from '../../db/schema'
import { channelsView } from '../../modules/notifications/service'
import { createTestApi } from '../../testing'
import type { ChannelConfig, NotificationChannel } from '../channel'
import { notificationEvents } from '../events'
import { notifyTargets } from '../notify'
import { enqueueNotifications } from '../outbox'
import { changeLeadRecipients, leadNotificationSummary } from '../recipients'
import { notificationSettingsRepo } from '../settings'
import { emailChannel } from './email'
import { createChannels } from './index'
import { telegramChannel } from './telegram'

// Интерфейс канала и реестр: каждый вид канала из схемы — адаптер с тем же интерфейсом. Почта —
// поверх очереди писем (письмо своим шаблоном или общим «Уведомлением»), Telegram — в очередь
// уведомлений. Ядро (notifyTargets) ставит в канал только то, что он готов и согласен везти

const api = await createTestApi()
afterAll(api.close)

const noTelegram = () => {
  throw new Error('Telegram в этом тесте не нужен')
}

const config = (overrides: Partial<ChannelConfig> = {}): ChannelConfig => ({
  enabled: true,
  settings: {},
  secret: { state: 'none' },
  ...overrides,
})

const leadData = notificationEvents['lead.new'].schema.parse({
  siteName: 'Ремонт',
  formTitle: 'Заявка',
  pagePath: '/',
  fields: [{ label: 'Имя', value: 'Анна' }],
  createdAt: '2026-10-20T10:00:00.000Z',
  url: 'https://admin.example.ru/leads/1',
  replyTo: 'anna@example.ru',
})

const diskData = {
  state: 'raised',
  installation: 'Ремонт',
  url: 'https://admin.example.ru/status',
  disk: 'данные',
  free: '0,5 ГБ',
} as const

describe('реестр каналов', () => {
  it('каждый вид канала из схемы — адаптер с полным интерфейсом', () => {
    const channels = createChannels({ telegram: noTelegram })
    expect(Object.keys(channels).sort()).toEqual([...NotificationChannelKind.options].sort())
    for (const [kind, channel] of Object.entries(channels) as [string, NotificationChannel][]) {
      expect(channel.kind).toBe(kind)
      expect(channel.title).toBeTruthy()
      expect(typeof channel.ready).toBe('function')
      expect(typeof channel.enqueue).toBe('function')
      expect(typeof channel.check).toBe('function')
      expect(typeof channel.describe).toBe('function')
      expect(typeof channel.label).toBe('function')
      // У почты своих настроек нет, у Telegram без бота они не полны
      expect(channel.settings.safeParse({}).success).toBe(channel.kind === 'email')
    }
    // Почта своей отправки не имеет — её везёт очередь писем; Telegram отправляет сам
    expect(channels.email.send).toBeUndefined()
    expect(channels.telegram.send).toBeTypeOf('function')
  })

  it('готовность: выключен, почта процесса выключена, бот не настроен', () => {
    const mailOn = { mailEnabled: true, mailReason: null }
    expect(emailChannel.ready(config(), mailOn)).toEqual({ ok: true })
    expect(emailChannel.ready(config({ enabled: false }), mailOn).ok).toBe(false)
    expect(
      emailChannel.ready(config(), { mailEnabled: false, mailReason: 'SMTP не задан' }),
    ).toEqual({
      ok: false,
      reason: 'SMTP не задан',
    })
    const telegram = telegramChannel(noTelegram)
    expect(telegram.ready(config(), mailOn)).toEqual({
      ok: false,
      reason: 'Бот Telegram не настроен',
    })
    expect(
      telegram.ready(
        config({
          settings: { botId: 1, botUsername: 'bot', botName: 'Бот', proxy: null },
          secret: { state: 'unreadable', reason: 'ключ сменился' },
        }),
        mailOn,
      ),
    ).toEqual({ ok: false, reason: 'ключ сменился' })
  })

  it('адрес получателя проверяется схемой канала', () => {
    expect(emailChannel.address.parse('Boss@Example.ru')).toBe('boss@example.ru')
    expect(emailChannel.address.safeParse('a@b.ru\nBcc: x@y.ru').success).toBe(false)
    const telegram = telegramChannel(noTelegram)
    expect(telegram.address.safeParse('-100123').success).toBe(true)
    expect(telegram.address.safeParse('@channel').success).toBe(false)
  })
})

describe('ядро знает каналы только через интерфейс', () => {
  // Канал, которого ядро не знает: адаптер с теми же методами. Его получателей называет он сам —
  // и в письме о смене получателей, и в сводке; вид в админке — его describe
  const pager: NotificationChannel = {
    kind: 'telegram',
    title: 'Пейджер',
    address: z.string().regex(/^[0-9]+$/),
    settings: z.object({ station: z.string() }),
    label: ({ address }) => `Пейджер ${address}`,
    describe: (stored) => ({ station: String(stored.settings.station ?? '') }),
    defaultEnabled: true,
    skips: [],
    ready: (stored) => (stored.enabled ? { ok: true } : { ok: false, reason: 'выключен' }),
    check: async (_, { recipients }) => ({
      ok: true,
      steps: recipients.map((recipient) => ({
        step: recipient.address,
        ok: true,
        message: 'пищит',
      })),
    }),
    enqueue: (context, item, targets) => enqueueNotifications(context, 'telegram', item, targets),
  }

  it('письмо о смене получателей, сводка и вид канала — словами адаптера', async () => {
    const channels = { ...createChannels({ telegram: noTelegram }), telegram: pager }
    const deps = { ...api.notifyDeps(), channels }
    const owner = await api.loginAs('owner')
    const siteId = await api.createSite('Сайт с пейджером')
    await api.db
      .insert(notificationChannels)
      .values({ kind: 'telegram', enabled: true, settings: { station: 'Север' } })
      .onConflictDoUpdate({
        target: notificationChannels.kind,
        set: { enabled: true, settings: { station: 'Север' } },
      })
    await changeLeadRecipients(api.db, deps, { siteId, actor: owner.user, now: new Date() }, (tx) =>
      notificationSettingsRepo(tx).addRecipient(tx, {
        siteId,
        channel: pager,
        address: '2024',
        events: ['lead.new'],
        createdBy: null,
        now: new Date(),
      }),
    )
    // Кривой адрес не ляжет: его проверяет схема канала
    await expect(
      notificationSettingsRepo(api.db).addRecipient(api.db, {
        siteId,
        channel: pager,
        address: 'не номер',
        events: ['lead.new'],
        createdBy: null,
        now: new Date(),
      }),
    ).rejects.toThrow('не прошёл проверку')
    const [letter] = await api.db
      .select()
      .from(mailOutbox)
      .where(and(eq(mailOutbox.siteId, siteId), eq(mailOutbox.template, 'lead-recipients-changed')))
    expect(letter?.data).toMatchObject({ targets: ['Пейджер 2024'] })
    expect((await leadNotificationSummary(api.db, deps, siteId)).targets).toEqual(['Пейджер 2024'])
    const view = await channelsView(api.db, deps)
    expect(view.find((channel) => channel.title === 'Пейджер')).toMatchObject({
      ready: true,
      details: { station: 'Север' },
    })
    await api.db.delete(notificationChannels).where(eq(notificationChannels.kind, 'telegram'))
  })
})

describe('канал «Почта»', () => {
  it('заявка — письмом lead-new с Reply-To, служебное — общим «Уведомлением»', async () => {
    await api.db.transaction(async (tx) => {
      await notifyTargets(tx, api.notifyDeps(), {
        event: 'lead.new',
        data: leadData,
        targets: [{ channel: 'email', address: 'manager@example.ru' }],
        now: new Date(),
      })
      await notifyTargets(tx, api.notifyDeps(), {
        event: 'disk.low',
        data: diskData,
        targets: [{ channel: 'email', address: 'ops@example.ru' }],
        now: new Date(),
      })
    })
    const [lead] = await api.db
      .select()
      .from(mailOutbox)
      .where(eq(mailOutbox.recipient, 'manager@example.ru'))
    expect(lead).toMatchObject({
      template: 'lead-new',
      data: expect.objectContaining({ replyTo: 'anna@example.ru' }),
    })
    const [disk] = await api.db
      .select()
      .from(mailOutbox)
      .where(eq(mailOutbox.recipient, 'ops@example.ru'))
    expect(disk).toMatchObject({
      template: 'notification',
      data: expect.objectContaining({ title: 'Ремонт: мало места на диске' }),
    })
  })

  it('«почта не работает» почтой не ставится; Telegram без бота — тоже нет', async () => {
    const queued = await api.db.transaction((tx) =>
      notifyTargets(tx, api.notifyDeps(), {
        event: 'mail.down',
        data: {
          state: 'raised',
          installation: 'Ремонт',
          url: 'https://admin.example.ru/mail',
          failing: 2,
        },
        targets: [
          { channel: 'email', address: 'ops@example.ru' },
          { channel: 'telegram', address: '123' },
        ],
        now: new Date(),
      }),
    )
    expect(queued).toBe(0)
    expect(await api.db.select().from(notificationOutbox)).toEqual([])
  })

  it('кривые данные события отклоняются до очереди', async () => {
    await expect(
      api.db.transaction((tx) =>
        notifyTargets(tx, api.notifyDeps(), {
          event: 'disk.low',
          data: { ...diskData, url: 'javascript:alert(1)' },
          targets: [{ channel: 'email', address: 'ops@example.ru' }],
          now: new Date(),
        }),
      ),
    ).rejects.toThrow('Данные уведомления «disk.low» не прошли проверку')
  })
})
