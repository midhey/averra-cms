import { asc, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { siteBuilds } from '../db/schema'
import { BUILDS_KEPT, buildsRepo, INTERRUPTED_BUILD } from '../modules/builds/repo'
import { createTestApi, type TestApi } from '../testing'
import { BuildFailure, type BuildResult, createPublishQueue, type SiteBuild } from './queue'

// Очередь сборок: по одной на установку, без параллельных сборок одного сайта, повторная
// публикация во время сборки — ещё одна сборка после, во время ожидания — та же. Журнал в базе

const apis: TestApi[] = []
afterEach(async () => {
  for (const api of apis.splice(0)) await api.close()
})

async function setup() {
  const api = await createTestApi()
  apis.push(api)
  const owner = await api.loginAs('owner')
  const created = await api.app.request('/api/sites', {
    method: 'POST',
    headers: { ...owner.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Второй' }),
  })
  const { id: secondSiteId } = (await created.json()) as { id: string }
  return { api, siteId: api.demoSiteId, secondSiteId }
}

/** Сборка-подделка, которую тест отпускает сам: видно, сколько сборок идёт одновременно */
function controlledBuild() {
  const started: string[] = []
  let running = 0
  let maxRunning = 0
  const pending: { siteId: string; finish: (result?: Error) => void }[] = []
  let counter = 0
  const build: SiteBuild = (siteId, signal) => {
    started.push(siteId)
    running += 1
    maxRunning = Math.max(maxRunning, running)
    return new Promise<BuildResult>((resolve, reject) => {
      const finish = (error?: Error) => {
        running -= 1
        if (error) reject(error)
        else resolve({ release: `r${++counter}`, peakRssBytes: 1000 })
      }
      signal.addEventListener('abort', () => finish(new Error('прервана')))
      pending.push({ siteId, finish })
    })
  }
  /** Отпустить самую раннюю идущую сборку и дождаться, пока очередь возьмёт следующую */
  async function release(error?: Error) {
    await waitFor(() => pending.length > 0)
    pending.shift()?.finish(error)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return { build, started, release, maxRunning: () => maxRunning, pending }
}

async function waitFor(condition: () => boolean, ms = 2000) {
  const deadline = Date.now() + ms
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Не дождались')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const journal = (api: TestApi, siteId: string) =>
  api.db
    .select({ status: siteBuilds.status, release: siteBuilds.release, error: siteBuilds.error })
    .from(siteBuilds)
    .where(eq(siteBuilds.siteId, siteId))
    .orderBy(asc(siteBuilds.requestedAt))

describe('очередь сборок сайтов', () => {
  it('удачная сборка пишет в журнал релиз и пик памяти', async () => {
    const { api, siteId } = await setup()
    const control = controlledBuild()
    const queue = createPublishQueue({ db: api.db, build: control.build, log: () => {} })
    await queue.request(siteId)
    expect(await buildsRepo(api.db).latest(siteId)).toMatchObject({ status: 'running' })
    await control.release()
    await queue.idle()
    expect(await buildsRepo(api.db).latest(siteId)).toMatchObject({
      status: 'succeeded',
      release: 'r1',
      peakRssBytes: 1000,
      startedAt: expect.any(Date),
      finishedAt: expect.any(Date),
    })
  })

  it('сборки идут по одной: два сайта и повторные публикации не собираются параллельно', async () => {
    const { api, siteId, secondSiteId } = await setup()
    const control = controlledBuild()
    const queue = createPublishQueue({ db: api.db, build: control.build, log: () => {} })
    await queue.request(siteId)
    await queue.request(secondSiteId)
    await queue.request(siteId)
    await queue.request(siteId)
    for (let i = 0; i < 3; i += 1) await control.release()
    await queue.idle()
    expect(control.maxRunning()).toBe(1)
    // Сайт 1 собирается, сайт 2 ждёт; две публикации сайта 1 во время сборки — одна сборка после
    expect(control.started).toEqual([siteId, secondSiteId, siteId])
    expect((await journal(api, siteId)).map((row) => row.status)).toEqual([
      'succeeded',
      'succeeded',
    ])
  })

  it('публикация, пока сборка сайта ждёт очереди, новой сборки не заводит', async () => {
    const { api, siteId, secondSiteId } = await setup()
    const control = controlledBuild()
    const queue = createPublishQueue({ db: api.db, build: control.build, log: () => {} })
    await queue.request(secondSiteId)
    // Сайт 1 ждёт, пока собирается сайт 2: три публикации — одна ждущая сборка
    await queue.request(siteId)
    await queue.request(siteId)
    await queue.request(siteId)
    const queued = await api.db.select().from(siteBuilds).where(eq(siteBuilds.siteId, siteId))
    expect(queued.map((row) => row.status)).toEqual(['queued'])
    await control.release()
    await control.release()
    await queue.idle()
    expect(control.started).toEqual([secondSiteId, siteId])
  })

  it('упавшая сборка видна в журнале с причиной, очередь идёт дальше', async () => {
    const { api, siteId, secondSiteId } = await setup()
    const control = controlledBuild()
    const logs: string[] = []
    const queue = createPublishQueue({
      db: api.db,
      build: control.build,
      log: (line) => logs.push(line),
    })
    await queue.request(siteId)
    await queue.request(secondSiteId)
    await control.release(new BuildFailure('Сборка упала (код выхода 1):\nошибка в блоке', 5000))
    await control.release()
    await queue.idle()
    expect(await buildsRepo(api.db).latest(siteId)).toMatchObject({
      status: 'failed',
      error: 'Сборка упала (код выхода 1):\nошибка в блоке',
      peakRssBytes: 5000,
      release: null,
    })
    expect(await buildsRepo(api.db).latest(secondSiteId)).toMatchObject({ status: 'succeeded' })
    expect(logs.some((line) => line.includes('на сайте прежняя версия'))).toBe(true)
    // Версия на сайте — последняя удачная, а не упавшая
    expect(await buildsRepo(api.db).lastSucceeded(siteId)).toBeUndefined()
  })

  it('журнал сайта хранит последние сборки, старые удаляются', async () => {
    const { api, siteId } = await setup()
    let tick = 0
    const queue = createPublishQueue({
      db: api.db,
      build: async () => ({ release: `r${tick}` }),
      log: () => {},
      now: () => new Date(Date.UTC(2026, 9, 16, 8, 0, tick++)),
    })
    for (let i = 0; i < BUILDS_KEPT + 3; i += 1) {
      await queue.request(siteId)
      await queue.idle()
    }
    expect(await journal(api, siteId)).toHaveLength(BUILDS_KEPT)
  })

  it('после перезапуска API шедшая сборка помечается прерванной, и сайт собирается заново', async () => {
    const { api, siteId, secondSiteId } = await setup()
    // Прежний API: сборка сайта 1 шла, сайт 2 ждал — и API остановили
    const before = controlledBuild()
    const old = createPublishQueue({ db: api.db, build: before.build, log: () => {} })
    await old.request(siteId)
    await old.request(secondSiteId)
    await waitFor(() => before.pending.length === 1)
    await old.stop()
    expect((await journal(api, siteId)).map((row) => row.status)).toEqual(['running'])

    const after = controlledBuild()
    const queue = createPublishQueue({ db: api.db, build: after.build, log: () => {} })
    expect((await queue.recover()).sort()).toEqual([siteId, secondSiteId].sort())
    await after.release()
    await after.release()
    await queue.idle()
    expect(after.started).toEqual([siteId, secondSiteId])
    expect(await journal(api, siteId)).toEqual([
      { status: 'failed', release: null, error: INTERRUPTED_BUILD },
      { status: 'succeeded', release: 'r1', error: null },
    ])
  })

  it('публикация раньше recover: сборка, идущая в этом процессе, не считается прерванной', async () => {
    const { api, siteId } = await setup()
    const control = controlledBuild()
    const logs: string[] = []
    const queue = createPublishQueue({
      db: api.db,
      build: control.build,
      log: (line) => logs.push(line),
    })
    // Сервер уже слушает порт, публикация пришла и сборка пошла, а recover — следом
    await queue.request(siteId)
    await waitFor(() => control.pending.length === 1)
    expect(await queue.recover()).toEqual([])
    await control.release()
    await queue.idle()
    expect(control.started).toEqual([siteId])
    expect(await journal(api, siteId)).toEqual([
      { status: 'succeeded', release: 'r1', error: null },
    ])
    expect(logs.some((line) => line.includes('не удалось записать журнал'))).toBe(false)
  })

  it('старт в два шага: пометка прерванных до приёма запросов, очередь — после', async () => {
    const { api, siteId } = await setup()
    const before = controlledBuild()
    const old = createPublishQueue({ db: api.db, build: before.build, log: () => {} })
    await old.request(siteId)
    await waitFor(() => before.pending.length === 1)
    await old.stop()

    const after = controlledBuild()
    const queue = createPublishQueue({ db: api.db, build: after.build, log: () => {} })
    // Шаг 1 — до serve(): прерванная прошлым API сборка помечена
    const sites = await queue.markInterrupted()
    expect(sites).toEqual([siteId])
    // Между шагами пришла публикация: её сборка идёт и шагом 2 не задета
    await queue.request(siteId)
    await waitFor(() => after.pending.length === 1)
    await queue.resume(sites)
    await after.release()
    await after.release()
    await queue.idle()
    const rows = await journal(api, siteId)
    expect(rows[0]).toEqual({ status: 'failed', release: null, error: INTERRUPTED_BUILD })
    expect(rows.slice(1).every((row) => row.status === 'succeeded')).toBe(true)
  })

  it('recover ставит в очередь и опубликованные сайты без собранной версии', async () => {
    const { api, siteId } = await setup()
    const control = controlledBuild()
    const queue = createPublishQueue({ db: api.db, build: control.build, log: () => {} })
    expect(await queue.recover([siteId])).toEqual([])
    await control.release()
    await queue.idle()
    expect(control.started).toEqual([siteId])
  })

  it('остановка прерывает идущую сборку и не берёт новых', async () => {
    const { api, siteId } = await setup()
    const control = controlledBuild()
    const queue = createPublishQueue({ db: api.db, build: control.build, log: () => {} })
    await queue.request(siteId)
    await waitFor(() => control.pending.length === 1)
    await queue.stop()
    await queue.request(siteId)
    expect(control.started).toEqual([siteId])
  })
})
