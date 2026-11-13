import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { mailOutbox, mailTemplateTexts, sites } from '../../db/schema'
import { memoryMailer } from '../../mail/memory-mailer'
import { enqueueMail } from '../../mail/outbox'
import { mailTemplates } from '../../mail/templates'
import { processOutbox } from '../../mail/worker'
import { createTestApi } from '../../testing'

const api = await createTestApi()
afterAll(api.close)
const owner = await api.loginAs('owner')
const client = await api.loginAs('client')
const editor = await api.loginAs('editor')
const { token } = await api.createToken(api.demoSiteId, 'Помощник')
const tokenHeaders = { authorization: `Bearer ${token}` }
const base = `/api/sites/${api.demoSiteId}/mail-templates`
const custom = {
  subject: 'Мы приняли заявку — {siteName}',
  preheader: 'Спасибо',
  body: 'Спасибо!\n\nМы свяжемся с вами.',
}
const request = (
  path: string,
  method: string,
  headers: Record<string, string> = owner.headers,
  body?: unknown,
) =>
  api.app.request(path, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe('шаблоны писем: права и уровни', () => {
  it('владелец и администратор сайта читают и публикуют; редактору недоступно', async () => {
    for (const headers of [owner.headers, client.headers]) {
      const res = await request(base, 'GET', headers)
      expect(res.status).toBe(200)
      expect(((await res.json()) as { id: string }[]).map((row) => row.id)).toEqual([
        'lead-new',
        'lead-received',
      ])
      expect((await request(`${base}/lead-received/publish`, 'POST', headers, custom)).status).toBe(
        200,
      )
      expect((await request(`${base}/lead-received`, 'DELETE', headers)).status).toBe(200)
    }
    for (const [path, method] of [
      [base, 'GET'],
      [`${base}/lead-received/draft`, 'PUT'],
      [`${base}/lead-received/publish`, 'POST'],
      [`${base}/lead-received/preview`, 'POST'],
    ]) {
      expect(
        (
          await request(
            path ?? '',
            method ?? 'GET',
            editor.headers,
            method === 'GET' ? undefined : custom,
          )
        ).status,
      ).toBe(403)
    }
  })

  it('токен с ролью editor пишет и отменяет черновик, смотрит только пример; публикует человек', async () => {
    expect((await request(`${base}/lead-received/draft`, 'PUT', tokenHeaders, custom)).status).toBe(
      200,
    )
    const res = await request(base, 'GET', tokenHeaders)
    expect(await res.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'lead-received',
          draft: custom,
          draftUpdatedBy: 'токен «Помощник»',
        }),
      ]),
    )
    const preview = await request(`${base}/lead-received/preview`, 'POST', tokenHeaders, custom)
    expect(preview.status).toBe(200)
    expect(((await preview.json()) as { subject: string }).subject).toContain('Мы приняли заявку')
    expect(
      (await request(`${base}/lead-received/publish`, 'POST', tokenHeaders, custom)).status,
    ).toBe(403)
    expect((await request(`${base}/lead-received`, 'DELETE', tokenHeaders)).status).toBe(403)
    expect((await request(`${base}/lead-received/draft`, 'DELETE', tokenHeaders)).status).toBe(200)
    expect(
      (
        await request(`${base}/lead-received/preview`, 'POST', tokenHeaders, {
          ...custom,
          data: { fields: [] },
        })
      ).status,
    ).toBe(400)
  })

  it('служебные — только владельцу; неверный уровень — 404; чужой сайт токену не виден', async () => {
    const res = await request('/api/mail/templates', 'GET')
    expect((await res.json()) as unknown[]).toHaveLength(6)
    for (const headers of [client.headers, editor.headers, tokenHeaders]) {
      expect((await request('/api/mail/templates', 'GET', headers)).status).toBe(403)
      expect(
        (await request('/api/mail/templates/password-reset/draft', 'PUT', headers, custom)).status,
      ).toBe(403)
      expect(
        (await request('/api/mail/templates/password-reset/preview', 'POST', headers, custom))
          .status,
      ).toBe(403)
    }
    expect(
      (await request(`${base}/password-reset/draft`, 'PUT', owner.headers, custom)).status,
    ).toBe(404)
    expect(
      (await request('/api/mail/templates/lead-new/publish', 'POST', owner.headers, custom)).status,
    ).toBe(404)
    expect(
      (await request(`/api/sites/${crypto.randomUUID()}/mail-templates`, 'GET', tokenHeaders))
        .status,
    ).toBe(404)
  })

  it('ошибка у поля, и обязательный блок не теряется', async () => {
    for (const [text, field] of [
      [{ ...custom, body: 'Без полей' }, 'body'],
      [{ ...custom, subject: '{unknown}', body: '{fields}' }, 'subject'],
    ] as const) {
      const res = await request(`${base}/lead-new/draft`, 'PUT', owner.headers, text)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({
        error: {
          code: 'validation',
          issues: expect.arrayContaining([expect.objectContaining({ path: field })]),
        },
      })
    }
  })
})

describe('публикация и снимок в очереди', () => {
  it('сайт изолирован; черновик не отправляется; снимок остаётся после новой публикации и сброса', async () => {
    const secondId = await api.createSite('Второй сайт')
    const [second] = await api.db.select().from(sites).where(eq(sites.id, secondId))
    if (!second) throw new Error('Нет сайта')
    await request(`${base}/lead-received`, 'DELETE')
    await request(`${base}/lead-received/draft`, 'PUT', tokenHeaders, custom)
    const standard = await enqueueMail(api.db, {
      template: 'lead-received',
      siteId: api.demoSiteId,
      data: { siteName: 'Первый' },
      to: 'a@example.ru',
    })
    const first = await api.db.select().from(mailOutbox).where(eq(mailOutbox.id, standard.id))
    expect(first[0]?.custom).toBeNull()
    await request(`${base}/lead-received/publish`, 'POST', owner.headers, custom)
    const queued = await api.db.transaction((tx) =>
      enqueueMail(tx, {
        template: 'lead-received',
        siteId: api.demoSiteId,
        data: { siteName: 'Первый' },
        to: 'b@example.ru',
      }),
    )
    const other = await enqueueMail(api.db, {
      template: 'lead-received',
      siteId: second.id,
      data: { siteName: second.name },
      to: 'c@example.ru',
    })
    expect(
      (await api.db.select().from(mailOutbox).where(eq(mailOutbox.id, other.id)))[0]?.custom,
    ).toBeNull()
    const preview = await request('/api/mail/templates/lead-received/preview', 'GET')
    expect(((await preview.json()) as { subject: string }).subject).toContain('Мы приняли заявку')
    await request(`${base}/lead-received/publish`, 'POST', owner.headers, {
      ...custom,
      subject: 'Новая версия',
    })
    await request(`${base}/lead-received`, 'DELETE')
    expect(await api.db.select().from(mailTemplateTexts)).toHaveLength(0)
    const mailer = memoryMailer()
    const result = await processOutbox({ db: api.db, mailer, maxAttempts: 3, retentionDays: 30 })
    expect(result.sent).toBe(3)
    expect(mailer.sent.find((mail) => mail.to === 'b@example.ru')?.subject).toBe(
      'Мы приняли заявку — Первый',
    )
    expect(
      (await api.db.select().from(mailOutbox).where(eq(mailOutbox.id, queued.id)))[0]?.status,
    ).toBe('sent')
  })

  it('свой текст, который не собирается с данными письма, не роняет действие: уходит стандартный', async () => {
    // На примере (короткое название) тема влезает в 200 символов, с названием в 80 — уже нет
    const long = { ...custom, subject: `${'Я'.repeat(170)} {siteName}` }
    expect(
      (await request(`${base}/lead-received/publish`, 'POST', owner.headers, long)).status,
    ).toBe(200)
    const queued = await enqueueMail(api.db, {
      template: 'lead-received',
      siteId: api.demoSiteId,
      data: { siteName: 'С'.repeat(80) },
      to: 'long@example.ru',
    })
    expect(
      (await api.db.select().from(mailOutbox).where(eq(mailOutbox.id, queued.id)))[0]?.custom,
    ).toBeNull()
    await request(`${base}/lead-received`, 'DELETE')
    // Письмо — только для проверки снимка: следующий тест считает отправленные
    await api.db.delete(mailOutbox).where(eq(mailOutbox.id, queued.id))
  })

  it('служебный опубликованный текст общий; кривые снимки уходят стандартным текстом с записью в лог', async () => {
    const text = { ...mailTemplates['password-reset'].defaultText, subject: 'Ваш новый пароль' }
    expect(
      (await request('/api/mail/templates/password-reset/publish', 'POST', owner.headers, text))
        .status,
    ).toBe(200)
    const queued = await enqueueMail(api.db, {
      template: 'password-reset',
      data: mailTemplates['password-reset'].example,
      to: 'd@example.ru',
    })
    expect(
      (await api.db.select().from(mailOutbox).where(eq(mailOutbox.id, queued.id)))[0]?.custom,
    ).toEqual(text)
    await api.db
      .update(mailOutbox)
      .set({ custom: { ...text, body: 'Ссылка потеряна' } })
      .where(eq(mailOutbox.id, queued.id))
    const log: string[] = []
    const mailer = memoryMailer()
    expect(
      (
        await processOutbox({
          db: api.db,
          mailer,
          maxAttempts: 3,
          retentionDays: 30,
          log: (line) => log.push(line),
        })
      ).sent,
    ).toBe(1)
    expect(mailer.sent[0]?.subject).toBe('Сброс пароля в Averra CMS')
    expect(log.join('\n')).toContain('снимок текста не прошёл проверку')
    await request('/api/mail/templates/password-reset', 'DELETE')
  })
})
