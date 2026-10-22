import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { notificationLinkCodes, notificationRecipients } from '../../db/schema'
import { sha256 } from '../../secrets'
import { createTestApi } from '../../testing'
import { notificationSettingsRepo } from '../settings'
import { startFakeTelegram } from '../testing/fake-telegram'
import { fakeTelegram, saveBot, siteWithForm, TEST_BOT_TOKEN } from '../testing/scenario'
import { chatLabel, issueLinkCode, LINK_TTL_MS, newLinkCode, telegramBinder } from './binder'

// Привязка чата без ввода chat id: одноразовый код из админки, «Старт» в Telegram, опрос
// getUpdates. Код работает один раз, живёт 15 минут, чужой код ничего не привязывает, а код
// получателей заявок не открывает служебные

const fake = await fakeTelegram()
const api = await createTestApi({ telegramApiUrl: fake.url })
afterAll(async () => {
  await api.close()
  await fake.close()
})
const owner = await api.loginAs('owner')
expect((await saveBot(api, owner.headers)).status).toBe(200)
const siteId = await siteWithForm(api, owner.headers)

let chatCount = 0
const nextChat = () => 880000 + ++chatCount

async function issue(path: string, headers = owner.headers) {
  const res = await api.app.request(path, { method: 'POST', headers })
  expect(res.status).toBe(201)
  return (await res.json()) as {
    id: string
    code: string
    expiresAt: string
    links: { chat: string; group: string }
  }
}

const leadLink = () => issue(`/api/sites/${siteId}/notifications/telegram/link`)
const serviceLink = () => issue('/api/notifications/service/telegram/link')

const chatsOf = (address: number) =>
  api.db
    .select()
    .from(notificationRecipients)
    .where(eq(notificationRecipients.address, String(address)))

describe('привязка чата Telegram', () => {
  it('код — ссылка на бота, в базе только хеш; «Старт» привязывает чат и бот отвечает', async () => {
    const link = await leadLink()
    expect(link.code).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(link.links).toEqual({
      chat: `https://t.me/averra_test_bot?start=${link.code}`,
      group: `https://t.me/averra_test_bot?startgroup=${link.code}`,
    })
    expect(api.notificationWakes.binds).toBeGreaterThan(0)
    const [stored] = await api.db
      .select()
      .from(notificationLinkCodes)
      .where(eq(notificationLinkCodes.id, link.id))
    expect(stored?.codeHash).toBe(await sha256(link.code))
    expect(JSON.stringify(stored)).not.toContain(link.code)

    const id = nextChat()
    fake.pushStart(link.code, { id, type: 'private', first_name: 'Анна', last_name: 'Петрова' })
    expect(await api.binder.pollOnce()).toBe('polled')
    expect(await chatsOf(id)).toEqual([
      expect.objectContaining({
        siteId,
        channel: 'telegram',
        label: 'Анна Петрова',
        events: ['lead.new'],
      }),
    ])
    expect(fake.messagesTo(String(id)).at(-1)?.text).toContain('уведомления о новых заявках')

    const state = await api.app.request(
      `/api/sites/${siteId}/notifications/telegram/link/${link.id}`,
      { headers: owner.headers },
    )
    expect(await state.json()).toMatchObject({
      status: 'bound',
      recipient: { label: 'Анна Петрова' },
    })
  })

  it('код одноразовый: второй чат с тем же кодом не привязывается', async () => {
    const link = await leadLink()
    const first = nextChat()
    const second = nextChat()
    fake.pushStart(link.code, { id: first, type: 'private', first_name: 'Первый' })
    fake.pushStart(link.code, { id: second, type: 'private', first_name: 'Второй' })
    await api.binder.pollOnce()
    expect(await chatsOf(first)).toHaveLength(1)
    expect(await chatsOf(second)).toEqual([])
    expect(fake.messagesTo(String(second)).at(-1)?.text).toContain('Код не подошёл')
  })

  it('чат уже привязан — код не тратится: его можно открыть в другом чате', async () => {
    const id = nextChat()
    const first = await leadLink()
    expect(await api.binder.bind(first.code, { id, type: 'private', first_name: 'Ира' })).toContain(
      'Готово',
    )
    const second = await leadLink()
    expect(await api.binder.bind(second.code, { id, type: 'private' })).toContain('уже получает')
    const state = async () =>
      (await (
        await api.app.request(`/api/sites/${siteId}/notifications/telegram/link/${second.id}`, {
          headers: owner.headers,
        })
      ).json()) as { status: string }
    // Админка ждёт дальше, а не говорит «код истёк или уже использован»
    expect((await state()).status).toBe('waiting')
    const other = nextChat()
    expect(await api.binder.bind(second.code, { id: other, type: 'private' })).toContain('Готово')
    expect(await chatsOf(other)).toHaveLength(1)
    expect((await state()).status).toBe('bound')
  })

  it('чужой и истёкший код не привязывают', async () => {
    const stranger = nextChat()
    // Код, которого установка не выдавала, — хоть и правильного вида
    expect(await api.binder.bind(newLinkCode(), { id: stranger, type: 'private' })).toContain(
      'Код не подошёл',
    )
    const link = await leadLink()
    const expired = telegramBinder({
      db: api.db,
      deps: api.notifyDeps,
      telegram: api.notifications.telegram,
      now: () => new Date(Date.now() + LINK_TTL_MS + 1000),
    })
    expect(await expired.bind(link.code, { id: stranger, type: 'private' })).toContain(
      'Код не подошёл',
    )
    expect(await chatsOf(stranger)).toEqual([])
  })

  it('группа: команда с именем бота; чужому боту — мимо', async () => {
    const link = await serviceLink()
    const other = nextChat()
    fake.pushUpdate({
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        text: `/start@another_bot ${link.code}`,
        chat: { id: other, type: 'group', title: 'Чужая' },
      },
    })
    await api.binder.pollOnce()
    expect(await chatsOf(other)).toEqual([])

    const group = -nextChat()
    fake.pushStart(link.code, { id: group, type: 'supergroup', title: 'Студия: дежурные' }, true)
    await api.binder.pollOnce()
    expect(await chatsOf(group)).toEqual([
      expect.objectContaining({
        siteId: null,
        label: 'Студия: дежурные',
        events: ['backup.failed', 'disk.low', 'build.failed', 'mail.down'],
      }),
    ])
  })

  it('код клиента ведёт только к заявкам его сайта', async () => {
    const client = await api.loginAs('client', siteId)
    const link = await issue(`/api/sites/${siteId}/notifications/telegram/link`, client.headers)
    const id = nextChat()
    fake.pushStart(link.code, { id, type: 'private', first_name: 'Клиент' })
    await api.binder.pollOnce()
    const [row] = await chatsOf(id)
    expect(row).toMatchObject({ siteId, events: ['lead.new'] })
  })

  it('старое «Старт» без кода — подсказка, а давно отправленное — тишина', async () => {
    const link = await leadLink()
    const id = nextChat()
    fake.pushStart(undefined, { id, type: 'private' })
    const old = nextChat()
    fake.pushUpdate({
      message: {
        message_id: 2,
        date: Math.floor((Date.now() - LINK_TTL_MS * 2) / 1000),
        text: `/start ${link.code}`,
        chat: { id: old, type: 'private' },
      },
    })
    await api.binder.pollOnce()
    expect(fake.messagesTo(String(id)).at(-1)?.text).toContain('Привязать чат')
    expect(fake.messagesTo(String(old))).toEqual([])
    expect(await chatsOf(old)).toEqual([])
  })

  it('ответ бота экранирован: «<» и «&» в названии сайта — текст, а не разметка', async () => {
    const tricky = await siteWithForm(api, owner.headers, 'Окна <i>& Двери')
    const link = await issue(`/api/sites/${tricky}/notifications/telegram/link`)
    const id = nextChat()
    fake.pushStart(link.code, { id, type: 'private', first_name: 'Ира' })
    await api.binder.pollOnce()
    const reply = fake.messagesTo(String(id)).at(-1)
    expect(reply?.parseMode).toBe('HTML')
    expect(reply?.text).toContain('«Окна &lt;i&gt;&amp; Двери»')
    expect(reply?.text).not.toContain('<i>')
  })

  it('без живых кодов Telegram не опрашивается', async () => {
    await api.db.update(notificationLinkCodes).set({ usedAt: new Date() })
    const calls = fake.calls.length
    expect(await api.binder.pollOnce()).toBe('idle')
    // Только подтверждение обработанного (timeout 0), не длинный опрос
    expect(fake.calls.slice(calls).every((call) => call === 'getUpdates')).toBe(true)
    expect(await api.binder.pollOnce()).toBe('idle')
  })

  it('название чата: группа, имя, логин или id', () => {
    expect(chatLabel({ id: 1, type: 'group', title: 'Продажи' })).toBe('Продажи')
    expect(chatLabel({ id: 1, type: 'private', username: 'anna' })).toBe('@anna')
    expect(chatLabel({ id: 7, type: 'private' })).toBe('Чат 7')
  })
})

// Второй бот на том же фейковом Bot API: смена бота в настройках канала
const OTHER_TOKEN = '7000002:AAOtherBotTokenForTestsOnly_abcdefghij'

describe('опрос между сеансами привязки', async () => {
  const fake2 = await startFakeTelegram({
    token: TEST_BOT_TOKEN,
    pollWaitMs: 50,
    otherBots: [
      { token: OTHER_TOKEN, bot: { id: 7000002, username: 'averra_other_bot', name: 'Другой' } },
    ],
  })
  const api2 = await createTestApi({ telegramApiUrl: fake2.url })
  afterAll(async () => {
    await api2.close()
    await fake2.close()
  })
  const owner2 = await api2.loginAs('owner')
  expect((await saveBot(api2, owner2.headers)).status).toBe(200)
  const site2 = await siteWithForm(api2, owner2.headers)
  const logs: string[] = []
  // Свой binder: у него свой курсор, и журнал виден тесту
  const binder = telegramBinder({
    db: api2.db,
    deps: api2.notifyDeps,
    telegram: api2.notifications.telegram,
    pollTimeoutSec: 1,
    log: (message) => logs.push(message),
  })
  const link = async () => {
    const res = await api2.app.request(`/api/sites/${site2}/notifications/telegram/link`, {
      method: 'POST',
      headers: owner2.headers,
    })
    expect(res.status).toBe(201)
    return (await res.json()) as { id: string; code: string }
  }
  const chatsOf2 = (address: number) =>
    api2.db
      .select()
      .from(notificationRecipients)
      .where(eq(notificationRecipients.address, String(address)))

  it('после простоя Telegram выбрал id меньше прежнего — «Старт» всё равно доходит', async () => {
    const first = await link()
    fake2.pushStart(first.code, { id: 9101, type: 'private' }, false, { updateId: 900000500 })
    expect(await binder.pollOnce()).toBe('polled')
    expect(await chatsOf2(9101)).toHaveLength(1)
    // Кодов нет — сеанс кончился, обработанное подтверждено
    expect(await binder.pollOnce()).toBe('idle')
    expect(fake2.pending()).toEqual([])

    // Неделя без обновлений: следующий id Telegram выбрал случайно, и он меньше прежнего
    const second = await link()
    fake2.pushStart(second.code, { id: 9102, type: 'private' }, false, { updateId: 120000000 })
    expect(await binder.pollOnce()).toBe('polled')
    expect(await chatsOf2(9102)).toHaveLength(1)
    expect(fake2.messagesTo('9102').at(-1)?.text).toContain('Готово')
    expect(await binder.pollOnce()).toBe('idle')
  })

  it('сменили бота посреди сеанса: offset прежнего к новому не относится', async () => {
    const before = await link()
    const after = await link()
    fake2.pushStart(before.code, { id: 9201, type: 'private' }, false, { updateId: 900000600 })
    expect(await binder.pollOnce()).toBe('polled')
    expect(await chatsOf2(9201)).toHaveLength(1)
    // Код after ещё жив — сеанс идёт, а бот уже другой: его id начинаются с малых чисел
    expect((await saveBot(api2, owner2.headers, { token: OTHER_TOKEN })).status).toBe(200)
    fake2.pushStart(after.code, { id: 9202, type: 'private' }, false, { token: OTHER_TOKEN })
    expect(await binder.pollOnce()).toBe('polled')
    expect(await chatsOf2(9202)).toHaveLength(1)
    expect(await binder.pollOnce()).toBe('idle')
    expect(fake2.pending(OTHER_TOKEN)).toEqual([])
  })

  it('подтверждение не прошло — один раз в журнал, без повторов; дубль не обрабатывается', async () => {
    const first = await link()
    fake2.pushStart(first.code, { id: 9301, type: 'private' }, false, { token: OTHER_TOKEN })
    expect(await binder.pollOnce()).toBe('polled')
    expect(fake2.messagesTo('9301')).toHaveLength(1)

    fake2.failUpdates({ status: 502, description: 'Bad Gateway' })
    logs.length = 0
    const calls = fake2.calls.length
    // Кодов нет: подтверждение падает, но это не сбой опроса — цикл не крутится каждые 5 с
    expect(await binder.pollOnce()).toBe('idle')
    expect(logs).toEqual([expect.stringContaining('не удалось подтвердить')])
    expect(await binder.pollOnce()).toBe('idle')
    expect(fake2.calls.length - calls).toBe(1)
    fake2.failUpdates(undefined)

    // Следующий сеанс без offset получает неподтверждённое «Старт» снова — и молчит о нём
    const second = await link()
    fake2.pushStart(second.code, { id: 9302, type: 'private' }, false, { token: OTHER_TOKEN })
    expect(await binder.pollOnce()).toBe('polled')
    expect(await chatsOf2(9302)).toHaveLength(1)
    expect(fake2.messagesTo('9301')).toHaveLength(1)
    expect(fake2.messagesTo('9301')[0]?.text).toContain('Готово')
  })
})

describe('код тратится один раз и на уровне базы', async () => {
  const api3 = await createTestApi()
  afterAll(api3.close)
  const { user } = await api3.loginAs('owner')
  const repo = notificationSettingsRepo(api3.db)

  it('второй consumeLinkCode и истёкший код — ничего', async () => {
    const now = new Date()
    const { code } = await issueLinkCode(api3.db, { siteId: null, createdBy: user.id, now })
    const hash = await sha256(code)
    expect(await repo.consumeLinkCode(api3.db, hash, 'telegram', now)).toMatchObject({
      siteId: null,
      createdBy: user.id,
    })
    expect(await repo.consumeLinkCode(api3.db, hash, 'telegram', now)).toBeUndefined()

    const old = await issueLinkCode(api3.db, { siteId: null, createdBy: user.id, now })
    const later = new Date(now.getTime() + LINK_TTL_MS + 1000)
    expect(
      await repo.consumeLinkCode(api3.db, await sha256(old.code), 'telegram', later),
    ).toBeUndefined()
  })

  it('два «Старт» одним кодом одновременно — привязан один чат', async () => {
    const binder = telegramBinder({
      db: api3.db,
      deps: api3.notifyDeps,
      telegram: api3.notifications.telegram,
    })
    const { code } = await issueLinkCode(api3.db, {
      siteId: null,
      createdBy: user.id,
      now: new Date(),
    })
    // Оба успели «подсмотреть» живой код до того, как его потратили: решает UPDATE с условием
    const replies = await Promise.all([
      binder.bind(code, { id: 9401, type: 'private' }),
      binder.bind(code, { id: 9402, type: 'private' }),
    ])
    expect(replies.filter((reply) => reply.includes('Готово'))).toHaveLength(1)
    const rows = await api3.db
      .select()
      .from(notificationRecipients)
      .where(eq(notificationRecipients.channel, 'telegram'))
    expect(rows).toHaveLength(1)
  })
})
