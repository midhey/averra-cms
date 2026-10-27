import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type InstallationStatus,
  type ReleaseCheck,
  UPDATE_START_TIMEOUT_MS,
  type UpdateRun,
} from '@averra/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mailOutbox, notificationRecipients } from '../../db/schema'
import { hostStatus, REQUEST_FILE, STATE_FILES } from '../../status/host'
import { createTestApi } from '../../testing'

// «Обновить до X» из админки: API только кладёт файл-заявку в папку заявок (её разбирает и
// выполняет averra.sh на хосте). Здесь — кто может, когда отказ и что лежит в файле. Файлы
// состояния, которые пишет хост, — в своей временной папке

const root = join(tmpdir(), `averra-update-${randomUUID()}`)
const stateDir = join(root, 'state')
const requestsDir = join(root, 'requests')
const logs: string[] = []

const api = await createTestApi({
  version: '0.6.0',
  host: hostStatus({ stateDir, requestsDir, disks: [] }),
  log: (line) => logs.push(line),
})
afterAll(async () => {
  await api.close()
  rmSync(root, { recursive: true, force: true })
})

const requestPath = join(requestsDir, REQUEST_FILE)

function hostState(file: keyof typeof STATE_FILES, value: unknown) {
  writeFileSync(join(stateDir, STATE_FILES[file]), JSON.stringify(value))
}

const check = (overrides: Partial<ReleaseCheck> = {}): ReleaseCheck => ({
  checkedAt: new Date().toISOString(),
  current: '0.6.0',
  ok: true,
  error: null,
  adminUpdate: true,
  requestsWatched: true,
  ...overrides,
})

/** Сервер установлен install.sh, проверка нашла 0.7.0, заявок и обновлений нет */
beforeEach(() => {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(stateDir, { recursive: true })
  mkdirSync(requestsDir, { recursive: true })
  hostState('releaseCheck', check())
  hostState('releaseLatest', {
    version: '0.7.0',
    publishedAt: '2026-10-20T10:00:00Z',
    notes: 'Новое в 0.7.0',
  })
  logs.length = 0
})

const owner = await api.loginAs('owner')

const request = (headers: Record<string, string>, version = '0.7.0') =>
  api.app.request('/api/status/update', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ version }),
  })

async function status() {
  const res = await api.app.request('/api/status', { headers: owner.headers })
  expect(res.status).toBe(200)
  return (await res.json()) as InstallationStatus
}

describe('GET /api/status: новая версия', () => {
  it('установлена 0.6.0, доступна 0.7.0 с заметками и временем проверки', async () => {
    const { release } = await status()
    expect(release).toMatchObject({
      mode: 'ready',
      available: '0.7.0',
      latest: { version: '0.7.0', notes: 'Новое в 0.7.0' },
      check: { ok: true, adminUpdate: true },
      pending: null,
      request: null,
      unreadable: false,
    })
  })

  it('последняя найденная не новее установленной — доступной нет', async () => {
    hostState('releaseLatest', { version: '0.6.0', publishedAt: null, notes: '' })
    expect((await status()).release.available).toBeNull()
  })

  it('нет хостовой части, выключено на сервере, нет папки заявок — режим и без кнопки', async () => {
    rmSync(join(stateDir, STATE_FILES.releaseCheck))
    expect((await status()).release.mode).toBe('no-host')
    hostState('releaseCheck', check({ adminUpdate: false }))
    expect((await status()).release.mode).toBe('disabled')
    // Заявки некому забирать (нет systemd или path-юнит выключен) — кнопки нет
    hostState('releaseCheck', check({ requestsWatched: false }))
    expect((await status()).release.mode).toBe('no-watcher')
    hostState('releaseCheck', check())
    rmSync(requestsDir, { recursive: true })
    expect((await status()).release.mode).toBe('no-requests')
  })

  it('не удалось проверить — причина видна, найденный раньше релиз остаётся', async () => {
    hostState(
      'releaseCheck',
      check({ ok: false, error: 'не удалось связаться с источником релизов' }),
    )
    const { release } = await status()
    expect(release.check).toMatchObject({ ok: false, error: expect.stringContaining('связаться') })
    expect(release.available).toBe('0.7.0')
  })

  it('битый файл релиза — «не читается», а не 500', async () => {
    writeFileSync(join(stateDir, STATE_FILES.releaseLatest), '{"version":"0.7.0; reboot"}')
    const { release } = await status()
    expect(release).toMatchObject({ latest: null, available: null, unreadable: true })
  })
})

describe('POST /api/status/update: права', () => {
  it('без входа — 401; редактор, клиент и токен API — 403, заявки нет', async () => {
    expect((await request({})).status).toBe(401)
    for (const role of ['editor', 'client'] as const) {
      const { headers } = await api.loginAs(role)
      const res = await request(headers)
      expect(res.status, role).toBe(403)
      expect(await res.json()).toMatchObject({
        error: { code: 'forbidden', message: 'Обновить установку может только владелец' },
      })
    }
    const { token } = await api.createToken()
    const byToken = await request({ authorization: `Bearer ${token}` })
    expect(byToken.status).toBe(403)
    expect(await byToken.json()).toMatchObject({
      error: { message: expect.stringContaining('токену API нельзя') },
    })
    expect(existsSync(requestPath)).toBe(false)
  })
})

describe('POST /api/status/update: заявка', () => {
  it('владелец — 202 и файл-заявка ровно того вида, что ждёт averra.sh; в журнале — кто', async () => {
    const res = await request(owner.headers)
    expect(res.status).toBe(202)
    const body = (await res.json()) as { version: string; requestedAt: string }
    expect(body.version).toBe('0.7.0')
    const text = readFileSync(requestPath, 'utf8')
    // Тот же шаблон, что REQUEST_RE в deploy/averra.sh: поля и их порядок
    expect(text).toMatch(
      /^\{"version":"0\.7\.0","requestedAt":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z","requestedBy":"[0-9a-f-]{36}"\}\n$/,
    )
    expect(JSON.parse(text).requestedAt).toBe(body.requestedAt)
    // Временного файла не осталось: в папке только заявка
    expect(readdirNames()).toEqual([REQUEST_FILE])
    expect(logs.join('\n')).toContain('Обновление 0.6.0 → 0.7.0 запросил владелец')
    expect((await status()).release.pending).toEqual({
      version: '0.7.0',
      requestedAt: body.requestedAt,
    })
  })

  it('вторая заявка, пока первая не забрана, — 409; файл не перезаписан', async () => {
    expect((await request(owner.headers)).status).toBe(202)
    const first = readFileSync(requestPath, 'utf8')
    const again = await request(owner.headers)
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({
      error: { code: 'conflict', message: expect.stringContaining('уже отправлена') },
    })
    expect(readFileSync(requestPath, 'utf8')).toBe(first)
  })

  it('заявку хост не забрал за 10 минут — новая её заменяет, а не 409 навсегда', async () => {
    const old = new Date(Date.now() - UPDATE_START_TIMEOUT_MS - 60_000).toISOString()
    const stale = `${JSON.stringify({ version: '0.7.0', requestedAt: old, requestedBy: owner.user.id })}\n`
    writeFileSync(requestPath, stale)
    const { release } = await status()
    expect(release.pending).toEqual({ version: '0.7.0', requestedAt: old })
    const res = await request(owner.headers)
    expect(res.status).toBe(202)
    const body = (await res.json()) as { requestedAt: string }
    expect(JSON.parse(readFileSync(requestPath, 'utf8')).requestedAt).toBe(body.requestedAt)
    expect(readdirNames()).toEqual([REQUEST_FILE])
  })

  it('ломающий релиз, неудачный откат и откат до этой же версии — 409 без заявки', async () => {
    hostState('releaseLatest', {
      version: '0.7.0',
      publishedAt: null,
      breaking: true,
      notes: '⚠ BREAKING CHANGES',
    })
    const breaking = await request(owner.headers)
    expect(breaking.status).toBe(409)
    expect(await breaking.json()).toMatchObject({
      error: { code: 'update_unavailable', message: expect.stringContaining('шага на сервере') },
    })
    hostState('releaseLatest', { version: '0.7.0', publishedAt: null, notes: '' })
    hostState('updateLast', {
      from: '0.6.0',
      to: '0.6.5',
      startedAt: new Date(Date.now() - 600_000).toISOString(),
      finishedAt: new Date(Date.now() - 300_000).toISOString(),
      result: 'rollback-failed',
      step: 'rollback',
      dbRestored: false,
      keptDatabase: null,
      error: 'прежняя версия тоже не прошла проверку готовности',
    })
    const failed = await request(owner.headers)
    expect(failed.status).toBe(409)
    expect(await failed.json()).toMatchObject({
      error: { message: expect.stringContaining('неудачным откатом') },
    })
    // Обновление до этой же версии уже откатилось — повтор только со следующей версией
    hostState('updateLast', {
      from: '0.6.0',
      to: '0.7.0',
      startedAt: new Date(Date.now() - 600_000).toISOString(),
      finishedAt: new Date(Date.now() - 300_000).toISOString(),
      result: 'rolled-back',
      step: 'rollback',
      failedStep: 'migrate',
      dbRestored: false,
      keptDatabase: null,
      error: 'версия 0.7.0 не прошла проверку готовности',
    })
    const rolledBack = await request(owner.headers)
    expect(rolledBack.status).toBe(409)
    expect(await rolledBack.json()).toMatchObject({
      error: { code: 'update_unavailable', message: expect.stringContaining('уже откатилось') },
    })
    expect(existsSync(requestPath)).toBe(false)
  })

  it('идёт обновление — 409; хост принял заявку, а обновление ещё не началось — тоже 409', async () => {
    const running: UpdateRun = {
      from: '0.6.0',
      to: '0.7.0',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: 'in-progress',
      step: 'backup',
      failedStep: null,
      dbRestored: false,
      keptDatabase: null,
      error: null,
    }
    hostState('updateLast', running)
    const busy = await request(owner.headers)
    expect(busy.status).toBe(409)
    expect(await busy.json()).toMatchObject({
      error: { message: 'Уже идёт обновление до 0.7.0: дождитесь его итога' },
    })

    rmSync(join(stateDir, STATE_FILES.updateLast))
    hostState('updateRequest', {
      at: new Date().toISOString(),
      version: '0.7.0',
      requestedAt: new Date().toISOString(),
      result: 'accepted',
      error: null,
    })
    expect((await request(owner.headers)).status).toBe(409)
    expect(existsSync(requestPath)).toBe(false)
  })

  it('обновление «идёт» дольше часа (оборвалось) — новая заявка принимается: хост доведёт прерванное', async () => {
    hostState('updateLast', {
      from: '0.5.0',
      to: '0.6.0',
      startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      finishedAt: null,
      result: 'in-progress',
      dbRestored: false,
      keptDatabase: null,
      error: null,
    })
    expect((await request(owner.headers)).status).toBe(202)
  })

  it('не та версия, нет новой, кривая версия — отказ без заявки', async () => {
    const other = await request(owner.headers, '0.8.0')
    expect(other.status).toBe(409)
    expect(await other.json()).toMatchObject({
      error: { message: 'Доступна версия 0.7.0, а не 0.8.0: обновите страницу состояния' },
    })
    for (const version of ['0.7.0; reboot', 'v0.7.0', '../0.7.0', '']) {
      const res = await request(owner.headers, version)
      expect(res.status, version).toBe(400)
    }
    hostState('releaseLatest', { version: '0.6.0', publishedAt: null, notes: '' })
    const none = await request(owner.headers, '0.6.0')
    expect(none.status).toBe(409)
    expect(await none.json()).toMatchObject({
      error: { message: 'Новой версии нет: установлена 0.6.0' },
    })
    expect(existsSync(requestPath)).toBe(false)
  })

  it('нет хостовой части, выключено или нет папки заявок — 409 с понятным текстом', async () => {
    rmSync(join(stateDir, STATE_FILES.releaseCheck))
    const noHost = await request(owner.headers)
    expect(noHost.status).toBe(409)
    expect(await noHost.json()).toMatchObject({
      error: {
        code: 'update_unavailable',
        message: expect.stringContaining('только на сервере, установленном install.sh'),
      },
    })
    hostState('releaseCheck', check({ adminUpdate: false }))
    expect(await (await request(owner.headers)).json()).toMatchObject({
      error: { message: expect.stringContaining('ADMIN_UPDATE=off') },
    })
    hostState('releaseCheck', check({ requestsWatched: false }))
    expect(await (await request(owner.headers)).json()).toMatchObject({
      error: { code: 'update_unavailable', message: expect.stringContaining('некому забирать') },
    })
    hostState('releaseCheck', check())
    rmSync(requestsDir, { recursive: true })
    const noDir = await request(owner.headers)
    expect(noDir.status).toBe(409)
    expect(await noDir.json()).toMatchObject({
      error: { code: 'update_unavailable', message: expect.stringContaining('нет папки заявок') },
    })
  })

  it('API без хоста (разработка) — 409, а не 500', async () => {
    const dev = await createTestApi({ version: 'dev' })
    try {
      const { headers } = await dev.loginAs('owner')
      const res = await dev.app.request('/api/status/update', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ version: '0.7.0' }),
      })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ error: { code: 'update_unavailable' } })
      const body = (await (
        await dev.app.request('/api/status', { headers })
      ).json()) as InstallationStatus
      expect(body.release).toMatchObject({ mode: 'no-host', available: null })
    } finally {
      await dev.close()
    }
  })

  it('студия получает служебное уведомление: кто и до какой версии', async () => {
    await api.db.insert(notificationRecipients).values({
      siteId: null,
      channel: 'email',
      address: 'studio@example.test',
      events: ['update.requested'],
    })
    try {
      expect((await request(owner.headers)).status).toBe(202)
      const [mail] = await api.db
        .select()
        .from(mailOutbox)
        .where(eq(mailOutbox.recipient, 'studio@example.test'))
      const text = JSON.stringify(mail?.data)
      expect(text).toContain('запрошено обновление до 0.7.0')
      expect(text).toContain('0.6.0 → 0.7.0')
      expect(text).toContain(owner.user.email)
    } finally {
      await api.db
        .delete(notificationRecipients)
        .where(eq(notificationRecipients.address, 'studio@example.test'))
    }
  })
})

function readdirNames() {
  return readdirSync(requestsDir).sort()
}
