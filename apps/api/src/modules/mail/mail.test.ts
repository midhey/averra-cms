import { afterAll, describe, expect, it } from 'vitest'
import { MailSendError } from '../../mail/mailer'
import { memoryMailer } from '../../mail/memory-mailer'
import { enqueueMail } from '../../mail/outbox'
import { processOutbox } from '../../mail/worker'
import { createTestApi, type TestApi } from '../../testing'

// Почта в админке: состояние, очередь, повтор и предпросмотр — только владельцу

const api = await createTestApi()
const { app, loginAs } = api
afterAll(api.close)

const owner = await loginAs('owner')
const editor = await loginAs('editor')
const client = await loginAs('client')

const get = (path: string, headers: Record<string, string>, testApp = app) =>
  testApp.request(`/api/mail${path}`, { headers })
const post = (path: string, headers: Record<string, string>) =>
  app.request(`/api/mail${path}`, { method: 'POST', headers })

const testMail = (to: string) => ({
  template: 'mail-test' as const,
  data: { sentAt: new Date().toISOString(), provider: 'тест' },
  to,
})

describe('права', () => {
  it('без входа — 401', async () => {
    expect((await get('', {})).status).toBe(401)
    expect((await get('/outbox', {})).status).toBe(401)
  })

  it('редактор, клиент и токен — 403: почта общая для всех сайтов', async () => {
    const { token } = await api.createToken()
    for (const headers of [editor.headers, client.headers, { authorization: `Bearer ${token}` }]) {
      for (const path of ['', '/outbox', '/templates/mail-test/preview']) {
        const res = await get(path, headers)
        expect(res.status, path).toBe(403)
        expect(await res.json()).toEqual({
          error: {
            code: 'forbidden',
            message: 'Почту смотрит и настраивает только владелец админки',
          },
        })
      }
      expect((await post(`/outbox/${crypto.randomUUID()}/retry`, headers)).status).toBe(403)
    }
  })
})

describe('состояние', () => {
  it('владелец видит, что почта включена, провайдера и шаблоны', async () => {
    const res = await get('', owner.headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: {
        enabled: true,
        provider: { kind: 'memory', from: { address: 'noreply@averra.test', name: 'Averra CMS' } },
      },
      settings: { maxAttempts: 3, retentionDays: 30 },
      // Почта не уходит наружу (в памяти): ссылки на localhost никому не помешают
      linkWarning: null,
      templates: [
        expect.objectContaining({ id: 'mail-test', title: 'Проверка почты' }),
        expect.objectContaining({ id: 'password-reset', title: 'Сброс пароля' }),
        expect.objectContaining({ id: 'invitation', title: 'Приглашение на сайт' }),
        expect.objectContaining({
          id: 'mail-settings-changed',
          title: 'Настройки почты изменены',
        }),
        expect.objectContaining({ id: 'lead-new', title: 'Новая заявка' }),
        expect.objectContaining({ id: 'lead-received', title: 'Заявка получена' }),
        expect.objectContaining({
          id: 'lead-recipients-changed',
          title: 'Получатели уведомлений о заявках изменены',
        }),
        expect.objectContaining({ id: 'notification', title: 'Уведомление' }),
      ],
    })
  })

  it('SMTP из окружения показывается без пароля', async () => {
    const password = 'smtp-very-secret-password'
    const smtpApi = await createTestApi({
      envSmtp: {
        host: 'smtp.example.ru',
        port: 465,
        security: 'tls',
        user: 'noreply@example.ru',
        password,
        from: { address: 'noreply@example.ru', name: 'Averra CMS' },
      },
    })
    try {
      const { headers } = await smtpApi.loginAs('owner')
      const res = await get('', headers, smtpApi.app)
      const text = await res.text()
      expect(JSON.parse(text).status).toEqual({
        enabled: true,
        provider: {
          kind: 'smtp',
          host: 'smtp.example.ru',
          port: 465,
          security: 'tls',
          user: 'noreply@example.ru',
          from: { address: 'noreply@example.ru', name: 'Averra CMS' },
        },
      })
      expect(text).not.toContain(password)
      // Ссылки в письмах ведут на localhost (ADMIN_URL тестов), а письма уходят по SMTP наружу
      expect(JSON.parse(text).linkWarning).toBe(
        'Ссылки в письмах (сброс пароля, приглашения) ведут на http://localhost:5173 — адрес ' +
          'этого компьютера, а письма уходят по SMTP: адресат на другом компьютере такую ссылку ' +
          'не откроет. На сервере задайте ADMIN_URL — адрес админки снаружи — и перезапустите API',
      )
    } finally {
      await smtpApi.close()
    }
  })

  it('выключенная почта: API работает и честно говорит почему', async () => {
    const offApi: TestApi = await createTestApi({ mail: 'off' })
    try {
      const { headers } = await offApi.loginAs('owner')
      const res = await get('', headers, offApi.app)
      expect(res.status).toBe(200)
      expect(((await res.json()) as { status: unknown }).status).toEqual({
        enabled: false,
        reason: 'Почта не настроена (тест)',
      })
      expect((await offApi.app.request('/api/health')).status).toBe(200)
    } finally {
      await offApi.close()
    }
  })
})

describe('очередь', () => {
  it('показывает письма без данных: статус, попытки и ошибку', async () => {
    const to = `queue-${crypto.randomUUID().slice(0, 8)}@example.ru`
    const { id } = await enqueueMail(api.db, testMail(to))
    const res = await get('/outbox', owner.headers)
    expect(res.status).toBe(200)
    const items = (await res.json()) as Record<string, unknown>[]
    const item = items.find((row) => row.id === id)
    expect(item).toMatchObject({
      template: 'mail-test',
      recipient: to,
      status: 'pending',
      attempts: 0,
      lastError: null,
      sentAt: null,
    })
    // Данные письма — персональные: в список не идут
    expect(item).not.toHaveProperty('data')
    expect(item).not.toHaveProperty('claimId')
  })

  it('повтор: неотправленное — снова в очередь и будит обработчик; отправленное — 409', async () => {
    const to = `retry-${crypto.randomUUID().slice(0, 8)}@example.ru`
    const { id } = await enqueueMail(api.db, testMail(to))
    const failing = memoryMailer({
      beforeSend: (mail) => {
        if (mail.to === to) throw new MailSendError('Сервер не принял адрес получателя', true)
      },
    })
    await processOutbox({ db: api.db, mailer: failing, ...api.mailSettings })

    const wakes = api.mailWakes.count
    const res = await post(`/outbox/${id}/retry`, owner.headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'pending' })
    expect(api.mailWakes.count).toBe(wakes + 1)

    const items = (await (await get('/outbox', owner.headers)).json()) as Record<string, unknown>[]
    expect(items.find((row) => row.id === id)).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: 'Сервер не принял адрес получателя',
    })

    await processOutbox({ db: api.db, mailer: memoryMailer(), ...api.mailSettings })
    const again = await post(`/outbox/${id}/retry`, owner.headers)
    expect(again.status).toBe(409)
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('conflict')
  })

  it('письмо с одноразовой ссылкой после неудачи не повторить: 409 и canRetry: false', async () => {
    const to = `reset-${crypto.randomUUID().slice(0, 8)}@example.ru`
    const { id } = await enqueueMail(api.db, {
      template: 'password-reset',
      data: { name: 'Анна', url: 'https://admin.example.ru/reset?token=t0', expiresInMinutes: 60 },
      to,
    })
    const failing = memoryMailer({
      beforeSend: (mail) => {
        if (mail.to === to) throw new MailSendError('Сервер не принял адрес получателя', true)
      },
    })
    await processOutbox({ db: api.db, mailer: failing, ...api.mailSettings })

    const items = (await (await get('/outbox', owner.headers)).json()) as Record<string, unknown>[]
    expect(items.find((row) => row.id === id)).toMatchObject({ status: 'failed', canRetry: false })
    const res = await post(`/outbox/${id}/retry`, owner.headers)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('conflict')
    expect(body.error.message).toContain('одноразовой ссылкой')
  })

  it('нет такого письма — 404, кривой id — 400', async () => {
    expect((await post(`/outbox/${crypto.randomUUID()}/retry`, owner.headers)).status).toBe(404)
    expect((await post('/outbox/not-a-uuid/retry', owner.headers)).status).toBe(400)
  })
})

describe('предпросмотр', () => {
  it.each(['mail-test', 'password-reset', 'invitation', 'mail-settings-changed'])(
    '«%s»: тема, HTML и текст на примерных данных',
    async (template) => {
      const res = await get(`/templates/${template}/preview`, owner.headers)
      expect(res.status).toBe(200)
      const mail = (await res.json()) as { subject: string; html: string; text: string }
      expect(mail.subject.length).toBeGreaterThan(0)
      expect(mail.html).toContain('<html lang="ru">')
      expect(mail.text.length).toBeGreaterThan(0)
    },
  )

  it('неизвестный шаблон — 400', async () => {
    expect((await get('/templates/nope/preview', owner.headers)).status).toBe(400)
  })
})
