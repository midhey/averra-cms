import { type InstallationStatus, ServiceEventId } from '@averra/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mailOutbox, notificationWatch } from '../db/schema'
import { createTestApi } from '../testing'
import { renderNotification } from './events'
import {
  PUBLIC_CHECK_INTERVAL_MS,
  PUBLIC_REMINDER_MS,
  type PublicReading,
  publicChecks,
  runPublicWatch,
} from './public-watch'
import { jsonHeaders } from './testing/scenario'
import { runServiceWatch } from './watch'

const api = await createTestApi()
const owner = await api.loginAs('owner')
const now = new Date('2026-11-16T12:00:00.000Z')
const context = { installation: 'Ремонт', adminUrl: 'https://admin.remont.ru' }
const targets = [{ target: 'site' as const, url: 'https://remont.ru/' }]
const healthy: PublicReading = {
  available: true,
  status: 200,
  fingerprint: 'first',
  certificate: { state: 'valid', expiresAt: '2027-02-16T12:00:00.000Z' },
}
const down: PublicReading = { ...healthy, available: false, status: 503 }
const at = (round: number) => new Date(now.getTime() + round * PUBLIC_CHECK_INTERVAL_MS)
const probe = vi.fn(async (): Promise<PublicReading> => healthy)
const round = (date: Date) =>
  runPublicWatch({
    db: api.db,
    deps: api.notifyDeps(),
    targets,
    probe,
    context,
    now: date,
  })

afterAll(() => api.close())
beforeEach(async () => {
  await api.db.delete(notificationWatch)
  await api.db.delete(mailOutbox)
  probe.mockReset().mockResolvedValue(healthy)
  const response = await api.app.request('/api/notifications/service/email', {
    method: 'PUT',
    headers: jsonHeaders(owner.headers),
    body: JSON.stringify({
      recipients: [{ address: 'ops@studio.ru', events: ServiceEventId.options }],
    }),
  })
  expect(response.status).toBe(200)
})

describe('публичный HTTPS: переходы и сохранённое состояние', () => {
  it('два процесса не считают один круг двумя сбоями и не дублируют уведомление', async () => {
    probe.mockResolvedValue(down)
    const first = await Promise.all([round(at(0)), round(at(0))])
    expect(first.map((result) => result.queued)).toEqual([0, 0])
    expect(await publicChecks(api.db)).toMatchObject([{ failures: 1 }])
    const second = await Promise.all([round(at(1)), round(at(1))])
    expect(second.reduce((sum, result) => sum + result.queued, 0)).toBe(1)
    expect(await publicChecks(api.db)).toMatchObject([{ failures: 2 }])
  })

  it('два отдельных круга, напоминание через 6 часов и одно восстановление', async () => {
    probe.mockResolvedValue(down)
    expect(await round(at(0))).toEqual({ queued: 0 })
    // Перезапуск или второй процесс между кругами не превращает один сбой в два.
    expect(await round(new Date(now.getTime() + 60_000))).toEqual({ queued: 0 })
    expect(probe).toHaveBeenCalledTimes(1)
    expect(await round(at(1))).toEqual({ queued: 1 })
    expect(await round(at(2))).toEqual({ queued: 0 })
    const reminder = new Date(at(1).getTime() + PUBLIC_REMINDER_MS)
    expect(await round(new Date(reminder.getTime() - PUBLIC_CHECK_INTERVAL_MS))).toEqual({
      queued: 0,
    })
    expect(await round(reminder)).toEqual({ queued: 1 })
    probe.mockResolvedValue(healthy)
    expect(await round(new Date(reminder.getTime() + PUBLIC_CHECK_INTERVAL_MS))).toEqual({
      queued: 1,
    })
    expect(await round(new Date(reminder.getTime() + 2 * PUBLIC_CHECK_INTERVAL_MS))).toEqual({
      queued: 0,
    })
    expect(await publicChecks(api.db)).toMatchObject([{ available: true, failures: 0 }])
    const messages = await api.db.select().from(mailOutbox)
    expect(messages).toHaveLength(3)
    expect(messages.every((message) => message.recipient === 'ops@studio.ru')).toBe(true)
    expect(JSON.stringify(messages.map((message) => message.data))).toContain('снова работает')
  })

  it('разовый сбой снимается успехом, новый сбой снова ждёт двух кругов', async () => {
    probe.mockResolvedValueOnce(down).mockResolvedValueOnce(healthy).mockResolvedValue(down)
    expect(await round(at(0))).toEqual({ queued: 0 })
    expect(await round(at(1))).toEqual({ queued: 0 })
    expect(await round(at(2))).toEqual({ queued: 0 })
    expect(await round(at(3))).toEqual({ queued: 1 })
  })

  it('предупреждения 14 и 3 дня не повторяются, новый сертификат сбрасывает отметки', async () => {
    probe.mockResolvedValue({
      ...healthy,
      certificate: {
        state: 'valid',
        expiresAt: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
      },
    })
    expect(await round(at(0))).toEqual({ queued: 1 })
    expect(await round(at(1))).toEqual({ queued: 0 })
    const three = new Date(now.getTime() + 11 * 86_400_000)
    expect(await round(three)).toEqual({ queued: 1 })
    expect(await round(new Date(three.getTime() + PUBLIC_CHECK_INTERVAL_MS))).toEqual({ queued: 0 })
    probe.mockResolvedValue({
      ...healthy,
      fingerprint: 'renewed',
      certificate: {
        state: 'valid',
        expiresAt: new Date(three.getTime() + 10 * 86_400_000).toISOString(),
      },
    })
    expect(await round(new Date(three.getTime() + 2 * PUBLIC_CHECK_INTERVAL_MS))).toEqual({
      queued: 1,
    })
  })

  it('недействительный сертификат — один раз; DNS и таймаут не объявляют сертификат плохим', async () => {
    probe.mockResolvedValue({ ...healthy, certificate: { state: 'unknown', expiresAt: null } })
    expect(await round(at(0))).toEqual({ queued: 0 })
    probe.mockResolvedValue({
      ...healthy,
      certificate: { state: 'invalid', expiresAt: now.toISOString() },
    })
    expect(await round(at(1))).toEqual({ queued: 1 })
    expect(await round(at(2))).toEqual({ queued: 0 })
    probe.mockResolvedValue(healthy)
    expect(await round(at(3))).toEqual({ queued: 0 })
    probe.mockResolvedValue({ ...healthy, certificate: { state: 'invalid', expiresAt: null } })
    expect(await round(at(4))).toEqual({ queued: 1 })
  })

  it('сертификат при первом запуске на двух днях сразу даёт срочное предупреждение', async () => {
    probe.mockResolvedValue({
      ...healthy,
      certificate: {
        state: 'valid',
        expiresAt: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
      },
    })
    expect(await round(at(0))).toEqual({ queued: 1 })
    expect(await round(at(1))).toEqual({ queued: 0 })
  })

  it('нет получателей — состояние есть, уведомление дождётся подписки', async () => {
    await api.app.request('/api/notifications/service/email', {
      method: 'PUT',
      headers: jsonHeaders(owner.headers),
      body: JSON.stringify({ recipients: [] }),
    })
    probe.mockResolvedValue(down)
    expect(await round(at(0))).toEqual({ queued: 0 })
    expect(await round(at(1))).toEqual({ queued: 0 })
    await api.app.request('/api/notifications/service/email', {
      method: 'PUT',
      headers: jsonHeaders(owner.headers),
      body: JSON.stringify({ recipients: [{ address: 'ops@studio.ru', events: ['site.down'] }] }),
    })
    expect(await round(at(2))).toEqual({ queued: 1 })
  })

  it('ошибка постановки откатывает переход; админка проверяется даже при сбое сайта', async () => {
    const onFailure = vi.fn()
    const deps = api.notifyDeps()
    const enqueue = vi
      .spyOn(deps.channels.email, 'enqueue')
      .mockRejectedValueOnce(new Error('очередь'))
    const result = await runPublicWatch({
      db: api.db,
      deps,
      context,
      now,
      onFailure,
      targets: [...targets, { target: 'admin', url: 'https://admin.remont.ru/api/health' }],
      probe: async () => ({ ...healthy, certificate: { state: 'invalid', expiresAt: null } }),
    })
    enqueue.mockRestore()
    expect(result.queued).toBe(1)
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(await publicChecks(api.db)).toMatchObject([{ target: 'admin' }])
    probe.mockResolvedValue({ ...healthy, certificate: { state: 'invalid', expiresAt: null } })
    expect(await round(at(1))).toEqual({ queued: 1 })
  })

  it('обычный наблюдатель не удаляет публичный снимок', async () => {
    await round(at(0))
    await runServiceWatch(api.db, api.notifyDeps(), { signals: [], unknown: () => false }, now)
    expect(await publicChecks(api.db)).toHaveLength(1)
  })

  it('маршрут состояния отдаёт снимок без внутренних отметок и без сетевого запроса', async () => {
    await round(at(0))
    const response = await api.app.request('/api/status', { headers: owner.headers })
    const status = (await response.json()) as InstallationStatus
    expect(status.publicChecks).toEqual([
      {
        target: 'site',
        checkedAt: now.toISOString(),
        available: true,
        status: 200,
        failures: 0,
        certificate: healthy.certificate,
      },
    ])
    expect(JSON.stringify(status)).not.toContain('fingerprint')
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('флажок только владельцу, строгий ввод, выключение останавливает сеть и сохраняет снимок', async () => {
    for (const role of ['editor', 'client'] as const) {
      const { headers } = await api.loginAs(role)
      expect(
        (
          await api.app.request('/api/notifications/service/monitoring', {
            method: 'PUT',
            headers: jsonHeaders(headers),
            body: JSON.stringify({ enabled: false }),
          })
        ).status,
      ).toBe(403)
    }
    const { token } = await api.createToken()
    expect(
      (
        await api.app.request('/api/notifications/service/monitoring', {
          method: 'PUT',
          headers: jsonHeaders({ authorization: `Bearer ${token}` }),
          body: JSON.stringify({ enabled: false }),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await api.app.request('/api/notifications/service/monitoring', {
          method: 'PUT',
          headers: jsonHeaders(owner.headers),
          body: JSON.stringify({ enabled: false, extra: true }),
        })
      ).status,
    ).toBe(400)
    await round(at(0))
    expect(
      (
        await api.app.request('/api/notifications/service/monitoring', {
          method: 'PUT',
          headers: jsonHeaders(owner.headers),
          body: JSON.stringify({ enabled: false }),
        })
      ).status,
    ).toBe(200)
    expect(await round(at(1))).toEqual({ queued: 0 })
    expect(probe).toHaveBeenCalledTimes(1)
    const settings = await (
      await api.app.request('/api/notifications', { headers: owner.headers })
    ).json()
    expect(settings).toMatchObject({ monitoringEnabled: false })
    expect(await publicChecks(api.db)).toHaveLength(1)
    expect(
      await api.db
        .select()
        .from(notificationWatch)
        .where(eq(notificationWatch.key, 'public:settings')),
    ).toHaveLength(1)
  })
})

describe('сообщения публичных проверок', () => {
  it('служебные события передают цель, срок и восстановление', () => {
    const base = {
      installation: 'Ремонт',
      url: 'https://admin.remont.ru/status',
      target: 'сайт',
      state: 'raised',
    }
    expect(renderNotification('site.down', { ...base, reminder: true }).title).toContain(
      'всё ещё не отвечает',
    )
    expect(
      renderNotification('site.down', { ...base, state: 'resolved', reminder: false }).title,
    ).toContain('снова работает')
    expect(
      renderNotification('certificate.expiring', { ...base, days: 3, expiresAt: now.toISOString() })
        .title,
    ).toContain('через 3 дн.')
    expect(renderNotification('certificate.invalid', base).title).toContain('недействителен')
  })
})
