import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BackupRun, InstallationStatus } from '@averra/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { DEV_AUTH_SECRET } from '../../config'
import { mailOutbox, siteBuilds } from '../../db/schema'
import { hostStatus, STATE_FILES } from '../../status/host'
import { createTestApi, TEST_PASSWORD } from '../../testing'

// GET /api/status: состояние установки — только владельцу, без секретов. Файлы состояния
// пишет deploy/averra.sh на сервере; здесь они в своей временной папке

const stateDir = join(tmpdir(), `averra-state-${randomUUID()}`)
mkdirSync(stateDir, { recursive: true })
const disksDir = join(tmpdir(), `averra-disk-${randomUUID()}`)
mkdirSync(disksDir, { recursive: true })

const api = await createTestApi({
  version: '0.7.0',
  host: hostStatus({ stateDir, disks: [{ label: 'данные', path: disksDir }] }),
  // Публикация на сервере включена: в состоянии видны сборки
  publisher: { request: async () => {} },
})
afterAll(async () => {
  await api.close()
  rmSync(stateDir, { recursive: true, force: true })
  rmSync(disksDir, { recursive: true, force: true })
})

const backup = (overrides: Partial<BackupRun> = {}): BackupRun => ({
  name: '20261016-033000-scheduled',
  kind: 'scheduled',
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  finishedAt: new Date().toISOString(),
  ok: true,
  verified: true,
  dbBytes: 12_345,
  mediaBytes: 67_890,
  remote: 'off',
  error: null,
  ...overrides,
})

async function status(headers: Record<string, string>) {
  const res = await api.app.request('/api/status', { headers })
  expect(res.status).toBe(200)
  return { res, body: (await res.json()) as InstallationStatus }
}

describe('GET /api/status: права', () => {
  it('без входа — 401, участник и токен — 403, владелец — 200', async () => {
    expect((await api.app.request('/api/status')).status).toBe(401)
    for (const role of ['editor', 'client'] as const) {
      const { headers } = await api.loginAs(role)
      const res = await api.app.request('/api/status', { headers })
      expect(res.status, role).toBe(403)
      expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } })
    }
    const { token } = await api.createToken()
    const byToken = await api.app.request('/api/status', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(byToken.status).toBe(403)
    const { headers } = await api.loginAs('owner')
    const { res } = await status(headers)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('версии нет в открытых маршрутах здоровья', async () => {
    for (const path of ['/api/health', '/api/health/ready']) {
      const text = await (await api.app.request(path)).text()
      expect(text, path).not.toContain('0.7.0')
    }
  })
})

describe('GET /api/status: содержимое', () => {
  it('версия, база, бэкап из файла, сборки, почта, диск и проблемы', async () => {
    writeFileSync(
      join(stateDir, STATE_FILES.backupLast),
      JSON.stringify(backup({ remote: 'failed' })),
    )
    writeFileSync(
      join(stateDir, STATE_FILES.backupLastOk),
      JSON.stringify(backup({ remote: 'failed' })),
    )
    const now = new Date()
    await api.db.insert(siteBuilds).values({
      siteId: api.demoSiteId,
      status: 'failed',
      error: 'сборщик упал',
      requestedAt: now,
      startedAt: now,
      finishedAt: now,
    })
    await api.db.insert(mailOutbox).values([
      {
        template: 'mail-test',
        recipient: 'a@example.test',
        status: 'failed',
        lastError: 'отказ',
        lastAttemptAt: now,
      },
      // Неделю назад и раньше — уже история
      {
        template: 'mail-test',
        recipient: 'b@example.test',
        status: 'failed',
        lastAttemptAt: new Date(now.getTime() - 8 * 24 * 3_600_000),
      },
      { template: 'mail-test', recipient: 'c@example.test', data: { to: 'x' } },
      // Сервер почты не принимает адрес отправителя: письмо возвращается в очередь с причиной
      // и попытку не тратит — в failed оно не уйдёт никогда, но почта не работает
      {
        template: 'mail-test',
        recipient: 'd@example.test',
        data: { to: 'x' },
        lastError: 'Сервер не принял адрес отправителя',
        createdAt: new Date(now.getTime() - 60 * 60_000),
      },
    ])

    const { headers } = await api.loginAs('owner')
    const { body } = await status(headers)
    expect(body.version).toBe('0.7.0')
    expect(body.db.up).toBe(true)
    expect(body.db.migrations).toBeGreaterThanOrEqual(15)
    expect(body.backup).toMatchObject({ enabled: true, unreadable: false })
    expect(body.backup.last?.name).toBe('20261016-033000-scheduled')
    expect(body.publish).toMatchObject({ enabled: true, failedSites: 1 })
    expect(body.publish.last).toMatchObject({ status: 'failed' })
    expect(body.mail).toMatchObject({ enabled: true, failedRecent: 1, pending: 2, failing: 1 })
    expect(body.mail.failingSince).toBe(new Date(now.getTime() - 60 * 60_000).toISOString())
    expect(body.disk).toHaveLength(1)
    expect(body.disk[0]?.label).toBe('данные')
    expect(body.disk[0]?.totalBytes).toBeGreaterThan(0)
    expect(body.problems.map((p) => p.code)).toEqual(
      expect.arrayContaining([
        'backup_remote_failed',
        'mail_failing',
        'mail_failed',
        'build_failed',
      ]),
    )
  })

  it('битый файл состояния — «не читается», а не 500; нет файлов — бэкапов не было', async () => {
    writeFileSync(join(stateDir, STATE_FILES.backupLast), '{"name": обрезано')
    writeFileSync(join(stateDir, STATE_FILES.backupLastOk), JSON.stringify({ name: '../x' }))
    const { headers } = await api.loginAs('owner')
    const broken = (await status(headers)).body
    expect(broken.backup).toMatchObject({ unreadable: true, last: null, lastOk: null })
    expect(broken.problems.map((p) => p.code)).toContain('backup_unreadable')

    rmSync(join(stateDir, STATE_FILES.backupLast))
    rmSync(join(stateDir, STATE_FILES.backupLastOk))
    const empty = (await status(headers)).body
    expect(empty.backup).toMatchObject({ enabled: true, unreadable: false, last: null })
    expect(empty.problems.map((p) => p.code)).toContain('backup_missing')
  })

  it('файл обновления битый или не по схеме — «не читается» (update_unreadable), а не тишина', async () => {
    const { headers } = await api.loginAs('owner')
    const run = {
      from: '0.6.0',
      to: '0.7.0',
      startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      finishedAt: new Date(Date.now() - 3_600_000).toISOString(),
      result: 'rolled-back',
      dbRestored: true,
      keptDatabase: 'averra_rolled_back_20261016_100000',
      error: 'версия 0.7.0 не прошла проверку готовности',
    }
    try {
      writeFileSync(join(stateDir, STATE_FILES.updateLast), JSON.stringify(run))
      const good = (await status(headers)).body
      expect(good.update).toMatchObject({ result: 'rolled-back' })
      expect(good.updateUnreadable).toBe(false)
      expect(good.problems.map((p) => p.code)).toContain('update_rolled_back')

      // Итог, которого эта версия не знает (записал более новый averra.sh), и обрезанный файл
      for (const text of [JSON.stringify({ ...run, result: 'paused' }), '{"from": обрезано']) {
        writeFileSync(join(stateDir, STATE_FILES.updateLast), text)
        const broken = (await status(headers)).body
        expect(broken.update).toBeNull()
        expect(broken.updateUnreadable).toBe(true)
        expect(broken.problems.map((p) => p.code)).toContain('update_unreadable')
      }

      // Обновление оборвалось: «идёт» уже два часа
      writeFileSync(
        join(stateDir, STATE_FILES.updateLast),
        JSON.stringify({ ...run, result: 'in-progress', finishedAt: null, keptDatabase: null }),
      )
      const interrupted = (await status(headers)).body
      expect(interrupted.update).toMatchObject({ result: 'in-progress', finishedAt: null })
      expect(interrupted.problems.map((p) => p.code)).toContain('update_interrupted')
    } finally {
      rmSync(join(stateDir, STATE_FILES.updateLast), { force: true })
    }
  })

  it('служебных баз в тестовой базе нет — список пуст, проблемы нет', async () => {
    const { headers } = await api.loginAs('owner')
    const { body } = await status(headers)
    expect(body.db.serviceDatabases).toEqual([])
    expect(body.problems.map((p) => p.code)).not.toContain('db_service_databases')
  })

  it('в ответе нет секретов, путей и адресов', async () => {
    const { headers } = await api.loginAs('owner')
    const { body } = await status(headers)
    const text = JSON.stringify(body)
    expect(text).not.toContain(DEV_AUTH_SECRET)
    expect(text).not.toContain(TEST_PASSWORD)
    expect(text).not.toContain(stateDir.replaceAll('\\', '\\\\'))
    expect(text).not.toContain(disksDir.replaceAll('\\', '\\\\'))
    expect(text).not.toContain(tmpdir().replaceAll('\\', '\\\\'))
    expect(text).not.toMatch(/@example\.test/)
  })

  it('без папки состояния (разработка) бэкапы не ведутся и не тревожат', async () => {
    const dev = await createTestApi()
    try {
      const { headers } = await dev.loginAs('owner')
      const res = await dev.app.request('/api/status', { headers })
      const body = (await res.json()) as InstallationStatus
      expect(body.version).toBe('dev')
      expect(body.backup.enabled).toBe(false)
      expect(body.publish.enabled).toBe(false)
      expect(body.problems.map((p) => p.code)).not.toContain('backup_missing')
    } finally {
      await dev.close()
    }
  })
})
