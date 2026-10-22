import { inspect } from 'node:util'
import { PROXY_UNPARSED } from '@averra/schema'
import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  mailOutbox,
  notificationChannels,
  notificationOutbox,
  notificationRecipients,
  sites,
} from '../../db/schema'
import { memoryMailer } from '../../mail/memory-mailer'
import { channelSecretContext } from '../../notifications/channel'
import {
  bindChat,
  fakeTelegram,
  jsonHeaders,
  saveBot,
  siteWithForm,
  submitLead,
  TEST_BOT_TOKEN,
} from '../../notifications/testing/scenario'
import { createTestApi, sendNotifications, sendQueue, TEST_PASSWORD } from '../../testing'
import { RECIPIENT_CHANGES } from './routes'

// Раздел «Уведомления» настоящими запросами, как их шлёт админка: бот Telegram (токен только на
// запись, с паролем владельца), получатели заявок (владелец и клиент) и служебные (владелец),
// привязка чата, проверка каналов. Telegram — фейковый Bot API в памяти

const fake = await fakeTelegram()
const mailer = memoryMailer()
const api = await createTestApi({ mail: mailer, telegramApiUrl: fake.url })
afterAll(async () => {
  await api.close()
  await fake.close()
})

const owner = await api.loginAs('owner')

describe('бот Telegram: токен только на запись', () => {
  it('без пароля владельца не сохраняется; с паролем — проверка getMe, токен нигде не виден', async () => {
    const wrong = await saveBot(api, owner.headers, { currentPassword: 'не тот пароль' })
    expect(wrong.status).toBe(403)

    const saved = await saveBot(api, owner.headers)
    expect(saved.status).toBe(200)
    const text = await saved.text()
    expect(text).not.toContain(TEST_BOT_TOKEN)
    expect(JSON.parse(text)).toMatchObject({
      channels: expect.arrayContaining([
        expect.objectContaining({
          kind: 'telegram',
          ready: true,
          details: {
            bot: { username: 'averra_test_bot', name: 'Averra Test' },
            proxy: null,
            token: 'set',
          },
        }),
      ]),
    })
    expect(fake.calls).toContain('getMe')

    // В базе — только зашифрованным, в формате SecretBox
    const [row] = await api.db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.kind, 'telegram'))
    expect(row?.secretEncrypted).toMatch(/^v1\./)
    expect(row?.secretEncrypted).not.toContain(TEST_BOT_TOKEN)
    expect(JSON.stringify(row?.settings)).not.toContain(TEST_BOT_TOKEN)

    const view = await api.app.request('/api/notifications', { headers: owner.headers })
    expect(await view.text()).not.toContain(TEST_BOT_TOKEN)
  })

  it('токен, который Telegram не принял, не сохраняется: ошибка у поля', async () => {
    const res = await saveBot(api, owner.headers, {
      token: '7000001:AAOtherTokenNotKnownToFakeTelegram_xyz',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { issues: [{ path: 'token', message: expect.stringContaining('не принял токен') }] },
    })
  })

  it('недоступный прокси — ошибка у поля прокси, про прокси и по-русски', async () => {
    const res = await saveBot(api, owner.headers, {
      proxy: 'socks5://user:secret-pass@127.0.0.1:9',
    })
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain('"path":"proxy"')
    expect(body).toContain('через прокси:')
    expect(body).not.toContain('secret-pass')
  })

  it('спецсимволы в пароле прокси без %-кодов — 400 у поля; пароля нет ни в ответе, ни в журнале', async () => {
    const printed: string[] = []
    const spies = (['log', 'error', 'warn', 'info'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        printed.push(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg))).join(' '))
      }),
    )
    try {
      for (const [proxy, secret] of [
        // URL прочёл бы # как начало фрагмента, ? — как начало запроса: раньше это был 500
        ['socks5://user:pa#ssw0rd@127.0.0.1:1080', 'ssw0rd'],
        ['http://user:se?cret@127.0.0.1:3128', 'se?cret'],
        ['socks5://user:pa%zz@127.0.0.1:1080', 'pa%zz'],
        ['http://user#x:topsecret@127.0.0.1:3128', 'topsecret'],
        // Схема такое пропускает, URL — нет: ловит сверка в API, до сети
        ['http://user:hidden-pass@[1:2]:3128', 'hidden-pass'],
      ] as const) {
        const res = await saveBot(api, owner.headers, { proxy })
        expect(res.status, proxy).toBe(400)
        const body = await res.text()
        expect(body, proxy).toContain('"path":"proxy"')
        expect(body, proxy).toContain('%-кодами')
        expect(body, proxy).not.toContain(secret)
      }
      // Виноват хост, а не пароль: текст называет и хост, а не только %-коды логина и пароля
      const res = await saveBot(api, owner.headers, { proxy: 'http://user:pass@[1:2]:3128' })
      const body = (await res.json()) as { error: { issues: { message: string }[] } }
      expect(body.error.issues[0]?.message).toBe(PROXY_UNPARSED)
      expect(PROXY_UNPARSED).toContain('IPv6 — в квадратных скобках')
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
    expect(printed.join('\n')).not.toMatch(/ssw0rd|se\?cret|pa%zz|topsecret|hidden-pass/)
    // Прежний бот на месте: неудачное сохранение ничего не поменяло
    const view = await api.app.request('/api/notifications', { headers: owner.headers })
    expect(await view.text()).toContain('averra_test_bot')
  })

  it('пустой токен — оставить сохранённый', async () => {
    const res = await saveBot(api, owner.headers, { token: '' })
    expect(res.status).toBe(200)
  })

  it('клиенту, редактору и токену API настройки бота недоступны', async () => {
    const client = await api.loginAs('client')
    const editor = await api.loginAs('editor')
    const { token } = await api.createToken()
    for (const headers of [client.headers, editor.headers, { authorization: `Bearer ${token}` }]) {
      expect((await api.app.request('/api/notifications', { headers })).status).toBe(403)
      expect((await saveBot(api, headers)).status).toBe(403)
      const service = await api.app.request('/api/notifications/service/email', {
        method: 'PUT',
        headers: jsonHeaders(headers),
        body: JSON.stringify({ recipients: [] }),
      })
      expect(service.status).toBe(403)
    }
  })
})

describe('получатели заявок: владелец и клиент', () => {
  it('клиент привязывает чат и меняет адреса; редактор и токен API — 403', async () => {
    const siteId = await siteWithForm(api, owner.headers, 'Сайт клиента')
    const client = await api.loginAs('client', siteId)
    const editor = await api.loginAs('editor', siteId)
    const { token } = await api.createToken(siteId)

    const put = (headers: Record<string, string>, addresses: string[]) =>
      api.app.request(`/api/sites/${siteId}/notifications/email`, {
        method: 'PUT',
        headers: jsonHeaders(headers),
        body: JSON.stringify({ addresses }),
      })
    expect((await put(client.headers, ['sales@client.ru'])).status).toBe(200)
    expect((await put(editor.headers, ['x@evil.ru'])).status).toBe(403)
    const bearer = await put({ authorization: `Bearer ${token}` }, ['x@evil.ru'])
    expect(bearer.status).toBe(403)

    const { chat } = await bindChat(api, fake, client.headers, {
      siteId,
      chat: { id: -100777, type: 'group', title: 'Отдел продаж' },
    })
    const view = await api.app.request(`/api/sites/${siteId}/notifications`, {
      headers: client.headers,
    })
    const body = (await view.json()) as {
      recipients: { channel: string; address: string; label: string | null; events: string[] }[]
      summary: { targets: string[] }
    }
    expect(body.recipients).toEqual([
      expect.objectContaining({
        channel: 'email',
        address: 'sales@client.ru',
        events: ['lead.new'],
      }),
      expect.objectContaining({
        channel: 'telegram',
        address: String(chat.id),
        label: 'Отдел продаж',
      }),
    ])
    expect(body.summary.targets).toEqual(['sales@client.ru', 'Telegram «Отдел продаж»'])
    // Бот ответил в чат, что он привязан
    expect(fake.messagesTo(String(chat.id)).at(-1)?.text).toContain('уведомления о новых заявках')

    // Устаревшая колонка сайта держит адреса почты — для отката на прежнюю версию API
    const [site] = await api.db.select().from(sites).where(eq(sites.id, siteId))
    expect(site?.leadRecipients).toEqual(['sales@client.ru'])
  })

  it('заявка уходит и письмом, и в Telegram; текст из формы не ломает разметку', async () => {
    const siteId = await siteWithForm(api, owner.headers, 'Ремонт <b>&</b>')
    await api.app.request(`/api/sites/${siteId}/notifications/email`, {
      method: 'PUT',
      headers: jsonHeaders(owner.headers),
      body: JSON.stringify({ addresses: ['manager@remont.ru'] }),
    })
    const { chat } = await bindChat(api, fake, owner.headers, {
      siteId,
      chat: { id: 4242, type: 'private', first_name: 'Менеджер' },
    })
    const res = await submitLead(api, siteId, { comment: '<script>alert(1)</script> & co' })
    expect(res.status).toBe(200)

    await sendQueue(api)
    await sendNotifications(api)
    const mail = mailer.sent.find(
      (sent) => sent.to === 'manager@remont.ru' && sent.subject.startsWith('Новая заявка'),
    )
    expect(mail?.subject).toBe('Новая заявка с сайта «Ремонт <b>&</b>»')
    const message = fake.messagesTo(String(chat.id)).at(-1)
    expect(message?.parseMode).toBe('HTML')
    expect(message?.text).toContain('<b>Новая заявка с сайта «Ремонт &lt;b&gt;&amp;&lt;/b&gt;»</b>')
    expect(message?.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co')
    expect(message?.text).toMatch(/Заявка в админке: http:\/\/localhost:5173\/leads\/[0-9a-f-]{36}/)
    // Отправленное сообщение больше не хранит данных заявки
    const rows = await api.db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.siteId, siteId))
    expect(rows.every((row) => row.status === 'sent' && row.data === null)).toBe(true)
  })

  it('привязка и отвязка чата — уведомление владельцам и прежним получателям', async () => {
    const siteId = await siteWithForm(api, owner.headers, 'Сайт с чатами')
    const client = await api.loginAs('client', siteId)
    await api.app.request(`/api/sites/${siteId}/notifications/email`, {
      method: 'PUT',
      headers: jsonHeaders(client.headers),
      body: JSON.stringify({ addresses: ['old@client.ru'] }),
    })
    const notices = async () =>
      api.db
        .select()
        .from(mailOutbox)
        .where(
          and(eq(mailOutbox.siteId, siteId), eq(mailOutbox.template, 'lead-recipients-changed')),
        )
    const { chat } = await bindChat(api, fake, client.headers, {
      siteId,
      chat: { id: 9001, type: 'private', first_name: 'Чужой' },
    })
    // Письма о привязке узнаём по данным: без ORDER BY база порядок строк не обещает
    const bound = (await notices()).filter((mail) =>
      ((mail.data as { targets?: string[] }).targets ?? []).includes('Telegram «Чужой»'),
    )
    expect(bound.map((mail) => mail.recipient)).toEqual(
      expect.arrayContaining([owner.user.email, 'old@client.ru']),
    )
    // Получателей называет их канал: письмо не знает, какие каналы бывают
    expect(bound[0]?.data).toMatchObject({
      targets: ['old@client.ru', 'Telegram «Чужой»'],
      changedByEmail: client.user.email,
    })

    // Заявка пришла, но в Telegram ещё не ушла — и чат отвязали: ждущее сообщение с её
    // персональными данными удаляется вместе с ним, в отвязанный чат оно не уйдёт
    expect((await submitLead(api, siteId)).status).toBe(200)
    const pendingLead = () =>
      api.db
        .select()
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.address, String(chat.id)),
            eq(notificationOutbox.event, 'lead.new'),
          ),
        )
    expect(await pendingLead()).toHaveLength(1)

    // Отвязали — узнаёт и сам отвязанный чат (он был среди получателей)
    const [row] = await api.db
      .select()
      .from(notificationRecipients)
      .where(eq(notificationRecipients.address, String(chat.id)))
    const removed = await api.app.request(
      `/api/sites/${siteId}/notifications/recipients/${row?.id}`,
      {
        method: 'DELETE',
        headers: client.headers,
      },
    )
    expect(removed.status).toBe(204)
    expect(await pendingLead()).toEqual([])
    await sendNotifications(api)
    const texts = fake.messagesTo(String(chat.id)).map((message) => message.text)
    expect(texts.at(-1)).toContain('получатели уведомлений о заявках изменены')
    expect(texts.some((text) => text.includes('Новая заявка'))).toBe(false)
  })

  it('почта выключена флажком — о смене получателей владельцы всё равно узнают', async () => {
    const siteId = await siteWithForm(api, owner.headers, 'Сайт без почтовых уведомлений')
    const client = await api.loginAs('client', siteId)
    const toggle = (enabled: boolean) =>
      api.app.request('/api/notifications/channels/email', {
        method: 'PUT',
        headers: jsonHeaders(owner.headers),
        body: JSON.stringify({ enabled }),
      })
    expect((await toggle(false)).status).toBe(200)
    try {
      const res = await api.app.request(`/api/sites/${siteId}/notifications/email`, {
        method: 'PUT',
        headers: jsonHeaders(client.headers),
        body: JSON.stringify({ addresses: ['elsewhere@client.ru'] }),
      })
      expect(res.status).toBe(200)
      const letters = await api.db
        .select()
        .from(mailOutbox)
        .where(
          and(eq(mailOutbox.siteId, siteId), eq(mailOutbox.template, 'lead-recipients-changed')),
        )
      expect(letters.map((letter) => letter.recipient)).toContain(owner.user.email)
      // А сами заявки по выключенной почте не уходят
      expect((await submitLead(api, siteId)).status).toBe(200)
      const leads = await api.db
        .select()
        .from(mailOutbox)
        .where(and(eq(mailOutbox.siteId, siteId), eq(mailOutbox.template, 'lead-new')))
      expect(leads).toEqual([])
    } finally {
      expect((await toggle(true)).status).toBe(200)
    }
  })

  it('смена адресов ограничена по частоте: иначе это рассылка писем на чужие адреса', async () => {
    const siteId = await siteWithForm(api, owner.headers, 'Сайт с частой сменой')
    const client = await api.loginAs('client', siteId)
    const put = (addresses: string[]) =>
      api.app.request(`/api/sites/${siteId}/notifications/email`, {
        method: 'PUT',
        headers: jsonHeaders(client.headers),
        body: JSON.stringify({ addresses }),
      })
    for (let index = 0; index < RECIPIENT_CHANGES.max; index += 1) {
      expect((await put([`a${index % 2}@client.ru`])).status).toBe(200)
    }
    const limited = await put(['victim@example.ru'])
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ error: { code: 'rate_limited' } })
    // Счёт — на человека и сайт: владелец того же сайта меняет как обычно
    expect(
      (
        await api.app.request(`/api/sites/${siteId}/notifications/email`, {
          method: 'PUT',
          headers: jsonHeaders(owner.headers),
          body: JSON.stringify({ addresses: ['boss@client.ru'] }),
        })
      ).status,
    ).toBe(200)
  })

  it('«Проверить» у заявок без получателей — владельцам письмом, как ушла бы заявка', async () => {
    const siteId = await siteWithForm(api, owner.headers, 'Сайт без получателей')
    const res = await api.app.request(`/api/sites/${siteId}/notifications/test`, {
      method: 'POST',
      headers: owner.headers,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ queued: 1, fallback: true })
    const [letter] = await api.db
      .select()
      .from(mailOutbox)
      .where(and(eq(mailOutbox.siteId, siteId), eq(mailOutbox.template, 'notification')))
    expect(letter?.recipient).toBe(owner.user.email)
  })

  it('опрос Telegram не идёт (webhook у бота) — экран привязки видит причину', async () => {
    const siteId = await siteWithForm(api, owner.headers, 'Сайт с webhook')
    const res = await api.app.request(`/api/sites/${siteId}/notifications/telegram/link`, {
      method: 'POST',
      headers: owner.headers,
    })
    const link = (await res.json()) as { id: string }
    const status = async () =>
      (await (
        await api.app.request(`/api/sites/${siteId}/notifications/telegram/link/${link.id}`, {
          headers: owner.headers,
        })
      ).json()) as { status: string; problem: string | null }
    fake.failUpdates({
      status: 409,
      description: "Conflict: can't use getUpdates method while webhook is active",
    })
    try {
      await expect(api.binder.pollOnce()).rejects.toThrow('webhook')
      const waiting = await status()
      expect(waiting.status).toBe('waiting')
      expect(waiting.problem).toContain('у бота настроен webhook')
    } finally {
      fake.failUpdates(undefined)
    }
    await api.binder.pollOnce()
    expect((await status()).problem).toBeNull()
  })

  it('код клиента не открывает служебные: чужой сайт — 404, служебные — 403', async () => {
    const siteId = await siteWithForm(api, owner.headers, 'Ещё сайт')
    const client = await api.loginAs('client', siteId)
    const stranger = await api.loginAs('client')
    const foreign = await api.app.request(`/api/sites/${siteId}/notifications/telegram/link`, {
      method: 'POST',
      headers: stranger.headers,
    })
    expect(foreign.status).toBe(404)
    const service = await api.app.request('/api/notifications/service/telegram/link', {
      method: 'POST',
      headers: client.headers,
    })
    expect(service.status).toBe(403)
  })
})

describe('служебные события: владелец', () => {
  it('адреса с событиями, чат и события чата, отвязка', async () => {
    const saved = await api.app.request('/api/notifications/service/email', {
      method: 'PUT',
      headers: jsonHeaders(owner.headers),
      body: JSON.stringify({
        recipients: [{ address: 'Ops@Studio.ru', events: ['backup.failed', 'disk.low'] }],
      }),
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({
      recipients: [
        { channel: 'email', address: 'ops@studio.ru', events: ['backup.failed', 'disk.low'] },
      ],
    })
    const { chat } = await bindChat(api, fake, owner.headers, {
      chat: { id: 31337, type: 'private', first_name: 'Студия' },
    })
    expect(fake.messagesTo(String(chat.id)).at(-1)?.text).toContain('служебные уведомления')
    const view = (await (
      await api.app.request('/api/notifications', { headers: owner.headers })
    ).json()) as {
      recipients: { id: string; channel: string; events: string[] }[]
    }
    const chatRow = view.recipients.find((row) => row.channel === 'telegram')
    expect(chatRow?.events).toEqual(['backup.failed', 'disk.low', 'build.failed', 'mail.down'])

    const patched = await api.app.request(`/api/notifications/service/recipients/${chatRow?.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.headers),
      body: JSON.stringify({ events: ['mail.down'] }),
    })
    expect(patched.status).toBe(200)
    // «Новая заявка» служебному получателю не положена
    const lead = await api.app.request(`/api/notifications/service/recipients/${chatRow?.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.headers),
      body: JSON.stringify({ events: ['lead.new'] }),
    })
    expect(lead.status).toBe(400)
    const removed = await api.app.request(`/api/notifications/service/recipients/${chatRow?.id}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(removed.status).toBe(204)
  })

  it('«Проверить» Telegram: подключение, имя бота и сообщение в каждый чат', async () => {
    const res = await api.app.request('/api/notifications/channels/telegram/check', {
      method: 'POST',
      headers: owner.headers,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      steps: { step: string; ok: boolean; message: string }[]
    }
    expect(body.steps[0]).toMatchObject({
      ok: true,
      message: 'Telegram отвечает, бот @averra_test_bot',
    })
    expect(body.steps.length).toBeGreaterThan(1)
    // Проверка прошла — обработчик снимает паузу Telegram, а не ждёт её конца
    expect(api.notificationWakes.resets.at(-1)).toBe('telegram')
  })

  it('«Проверить» почту — письмо себе через очередь писем', async () => {
    const res = await api.app.request('/api/notifications/channels/email/check', {
      method: 'POST',
      headers: owner.headers,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      steps: [{ step: 'Письмо', ok: true, message: expect.stringContaining(owner.user.email) }],
    })
  })

  it('выключенный Telegram не получает новых сообщений, включённый — снова получает', async () => {
    const toggle = (enabled: boolean) =>
      api.app.request('/api/notifications/channels/telegram', {
        method: 'PUT',
        headers: jsonHeaders(owner.headers),
        body: JSON.stringify({ enabled }),
      })
    expect((await toggle(false)).status).toBe(200)
    const siteId = await siteWithForm(api, owner.headers, 'Выключенный канал')
    await bindChat(api, fake, owner.headers, { siteId, chat: { id: 777, type: 'private' } })
      .then(() => {
        throw new Error('Привязка при выключенном канале не должна выдавать код')
      })
      .catch((error: Error) => expect(error.message).toContain('409'))
    expect((await toggle(true)).status).toBe(200)
  })

  it('смена бота отвязывает чаты прежнего; удаление бота — с паролем', async () => {
    await api.db
      .update(notificationChannels)
      .set({
        settings: { botId: 1, botUsername: 'old_bot', botName: 'Старый', proxy: null },
      })
      .where(eq(notificationChannels.kind, 'telegram'))
    // Сайты, у которых есть чаты, и сообщение, которое прежний бот ещё не отправил
    const withChats = await api.db
      .selectDistinct({ siteId: notificationRecipients.siteId })
      .from(notificationRecipients)
      .where(eq(notificationRecipients.channel, 'telegram'))
    const leadSites = withChats.flatMap((row) => (row.siteId ? [row.siteId] : []))
    expect(leadSites.length).toBeGreaterThan(0)
    expect((await submitLead(api, leadSites[0] ?? '')).status).toBe(200)
    const lettersBefore = (await api.db.select().from(mailOutbox)).length
    const outboxBefore = (await api.db.select().from(notificationOutbox)).map((row) => row.id)

    const res = await saveBot(api, owner.headers)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { dropped: number }).dropped).toBeGreaterThan(0)
    const chats = await api.db
      .select()
      .from(notificationRecipients)
      .where(eq(notificationRecipients.channel, 'telegram'))
    expect(chats).toEqual([])
    // Ждущие сообщения прежнего бота удалены, прежним чатам ничего не поставлено: новый бот
    // им не доставит
    const outbox = await api.db.select().from(notificationOutbox)
    expect(outbox.filter((row) => row.status === 'pending')).toEqual([])
    expect(outbox.filter((row) => !outboxBefore.includes(row.id))).toEqual([])
    // О смене — по одному письму на сайт каждому адресату, не по письму на каждый чат
    const letters = (await api.db.select().from(mailOutbox))
      .slice(lettersBefore)
      .filter((row) => row.template === 'lead-recipients-changed')
    const pairs = letters.map((row) => `${row.siteId}:${row.recipient}`)
    expect(new Set(pairs).size).toBe(pairs.length)
    expect(new Set(letters.map((row) => row.siteId))).toEqual(new Set(leadSites))
    expect(api.notificationWakes.count).toBeGreaterThan(0)

    const noPassword = await api.app.request('/api/notifications/telegram', {
      method: 'DELETE',
      headers: jsonHeaders(owner.headers),
      body: JSON.stringify({ currentPassword: 'нет' }),
    })
    expect(noPassword.status).toBe(403)
    const removed = await api.app.request('/api/notifications/telegram', {
      method: 'DELETE',
      headers: jsonHeaders(owner.headers),
      body: JSON.stringify({ currentPassword: TEST_PASSWORD }),
    })
    expect(removed.status).toBe(200)
    const [row] = await api.db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.kind, 'telegram'))
    expect(row?.secretEncrypted).toBeNull()
  })
})

describe('без ключа шифрования', () => {
  it('бота не сохранить: понятная причина', async () => {
    const noKey = await createTestApi({ mailKey: null, telegramApiUrl: fake.url })
    try {
      const keyOwner = await noKey.loginAs('owner')
      const res = await saveBot(noKey, keyOwner.headers)
      expect(res.status).toBe(409)
      expect(await res.text()).toContain('MAIL_ENCRYPTION_KEY')
    } finally {
      await noKey.close()
    }
  })
})

describe('клиент не видит адрес прокси', async () => {
  const fake5 = await fakeTelegram()
  const api5 = await createTestApi({ mail: memoryMailer(), telegramApiUrl: fake5.url })
  afterAll(async () => {
    await api5.close()
    await fake5.close()
  })
  const owner5 = await api5.loginAs('owner')
  expect((await saveBot(api5, owner5.headers)).status).toBe(200)
  const siteId = await siteWithForm(api5, owner5.headers)
  const client = await api5.loginAs('client', siteId)
  await bindChat(api5, fake5, owner5.headers, { siteId, chat: { id: 7070, type: 'private' } })
  // Прокси перестал отвечать: в секрете канала — прокси с логином на закрытом порту
  const secretBox = api5.secretBox
  if (!secretBox) throw new Error('В тестах есть ключ шифрования')
  await api5.db
    .update(notificationChannels)
    .set({
      secretEncrypted: secretBox.encrypt(
        JSON.stringify({
          token: TEST_BOT_TOKEN,
          proxy: 'socks5://proxy-login:proxy-pass@127.0.0.1:9',
        }),
        channelSecretContext('telegram'),
      ),
    })
    .where(eq(notificationChannels.kind, 'telegram'))

  it('у ссылки привязки и в сводке заявок — «через прокси», но без хоста, порта и логина', async () => {
    expect((await submitLead(api5, siteId)).status).toBe(200)
    const sent = await sendNotifications(api5)
    expect(sent.down.has('telegram')).toBe(true)
    // Сообщение ждёт дольше 15 минут — сводка предупреждает с последней ошибкой
    await api5.db
      .update(notificationOutbox)
      .set({ createdAt: new Date(Date.now() - 20 * 60 * 1000) })
    const issued = await api5.app.request(`/api/sites/${siteId}/notifications/telegram/link`, {
      method: 'POST',
      headers: client.headers,
    })
    const link = (await issued.json()) as { id: string }
    await expect(api5.binder.pollOnce()).rejects.toThrow('через прокси')

    const views = await Promise.all(
      [
        `/api/sites/${siteId}/notifications/telegram/link/${link.id}`,
        `/api/sites/${siteId}/notifications`,
        `/api/sites/${siteId}/leads`,
      ].map(async (path) => {
        const res = await api5.app.request(path, { headers: client.headers })
        expect(res.status, path).toBe(200)
        return res.text()
      }),
    )
    for (const text of views) {
      expect(text).toContain('через прокси')
      for (const part of ['proxy-login', 'proxy-pass', '127.0.0.1', 'socks5://']) {
        expect(text).not.toContain(part)
      }
    }
  })
})
