import { afterAll, describe, expect, it } from 'vitest'
import { createPublishQueue, type SitePublisher } from '../../publish/queue'
import { createTestApi } from '../../testing'

// Публикация заводит сборку сайта на сервере, экран сайта видит её состояние и может собрать
// заново. Сама сборка здесь — подделка: её поведение проверяют тесты src/publish

type Headers = Record<string, string>
/** Ответ GET …/build: последняя сборка и версия на сайте */
type BuildView = { latest: Record<string, unknown> | null; live: Record<string, unknown> | null }
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })

/** Издатель, который только запоминает, какие сайты просили пересобрать */
function recordingPublisher() {
  const requested: string[] = []
  const publisher: SitePublisher = {
    request: async (siteId) => {
      requested.push(siteId)
    },
  }
  return { publisher, requested }
}

const recorder = recordingPublisher()
const api = await createTestApi({ publisher: recorder.publisher })
afterAll(api.close)
const page = (slug: string) => `/api/sites/${api.demoSiteId}/pages/${slug}`

describe('публикация заводит сборку сайта', () => {
  it('«Опубликовать» ставит сайт в очередь сборки', async () => {
    const { headers } = await api.loginAs('editor')
    recorder.requested.length = 0
    const res = await api.app.request(`${page('index')}/publish`, { method: 'POST', headers })
    expect(res.status).toBe(200)
    expect(recorder.requested).toEqual([api.demoSiteId])
  })

  it('удаление опубликованной страницы пересобирает сайт, неопубликованной — нет', async () => {
    const { headers } = await api.loginAs('owner')
    for (const slug of ['draft-only', 'on-site']) {
      const created = await api.app.request(`/api/sites/${api.demoSiteId}/pages`, {
        method: 'POST',
        headers: json(headers),
        body: JSON.stringify({ slug, title: slug }),
      })
      expect(created.status).toBe(201)
    }
    await api.app.request(`${page('on-site')}/publish`, { method: 'POST', headers })
    recorder.requested.length = 0

    expect((await api.app.request(page('draft-only'), { method: 'DELETE', headers })).status).toBe(
      204,
    )
    expect(recorder.requested).toEqual([])
    expect((await api.app.request(page('on-site'), { method: 'DELETE', headers })).status).toBe(204)
    expect(recorder.requested).toEqual([api.demoSiteId])
  })

  it('сбой постановки в очередь не отменяет публикацию', async () => {
    const logs: string[] = []
    const failing = await createTestApi({
      log: (line) => logs.push(line),
      publisher: {
        request: async () => {
          throw new Error('база недоступна')
        },
      },
    })
    try {
      const { headers } = await failing.loginAs('owner')
      const res = await failing.app.request(
        `/api/sites/${failing.demoSiteId}/pages/index/publish`,
        { method: 'POST', headers },
      )
      expect(res.status).toBe(200)
      expect(logs.some((line) => line.includes('не удалось поставить сборку в очередь'))).toBe(true)
    } finally {
      await failing.close()
    }
  })
})

describe('состояние сборки и «Собрать заново»', () => {
  it('без PUBLISH_DIR сборка выключена: экран это знает, «собрать» — 409', async () => {
    const api = await createTestApi()
    try {
      const { headers } = await api.loginAs('owner')
      const url = `/api/sites/${api.demoSiteId}/build`
      const res = await api.app.request(url, { headers })
      expect(await res.json()).toEqual({ enabled: false, latest: null, live: null })
      const rebuild = await api.app.request(url, { method: 'POST', headers })
      expect(rebuild.status).toBe(409)
      expect(await rebuild.json()).toMatchObject({ error: { code: 'publish_disabled' } })
    } finally {
      await api.close()
    }
  })

  it('показывает последнюю сборку и версию на сайте; упавшая сборка видна с причиной', async () => {
    let fail = false
    const holder: { queue?: ReturnType<typeof createPublishQueue> } = {}
    const api = await createTestApi({
      publisher: { request: (siteId) => holder.queue?.request(siteId) ?? Promise.resolve() },
    })
    try {
      let counter = 0
      holder.queue = createPublishQueue({
        db: api.db,
        log: () => {},
        build: async () => {
          if (fail) throw new Error('Сборка упала (код выхода 1):\nблок «hero» без заголовка')
          return { release: `20261016T08000${++counter}Z-abcdef`, peakRssBytes: 380 * 2 ** 20 }
        },
      })
      const { headers } = await api.loginAs('owner')
      const url = `/api/sites/${api.demoSiteId}/build`

      const before = await api.app.request(url, { headers })
      expect(await before.json()).toEqual({ enabled: true, latest: null, live: null })

      const queued = await api.app.request(url, { method: 'POST', headers })
      expect(queued.status).toBe(202)
      await holder.queue.idle()
      const ok = (await (await api.app.request(url, { headers })).json()) as BuildView
      expect(ok.latest).toMatchObject({
        status: 'succeeded',
        release: '20261016T080001Z-abcdef',
        peakRssBytes: 380 * 2 ** 20,
        error: null,
      })
      expect(ok.live).toEqual(ok.latest)

      fail = true
      await api.app.request(`/api/sites/${api.demoSiteId}/pages/index/publish`, {
        method: 'POST',
        headers,
      })
      await holder.queue.idle()
      const failed = (await (await api.app.request(url, { headers })).json()) as BuildView
      expect(failed.latest).toMatchObject({
        status: 'failed',
        error: 'Сборка упала (код выхода 1):\nблок «hero» без заголовка',
        release: null,
      })
      // На сайте осталась прежняя версия — её и показывает live
      expect(failed.live).toMatchObject({ release: '20261016T080001Z-abcdef' })
    } finally {
      await api.close()
    }
  })

  it('смотреть может любой, кто видит сайт, а собирать — кто публикует', async () => {
    const recorder = recordingPublisher()
    const api = await createTestApi({ publisher: recorder.publisher })
    try {
      const url = `/api/sites/${api.demoSiteId}/build`
      const client = await api.loginAs('client')
      expect((await api.app.request(url, { headers: client.headers })).status).toBe(200)
      expect((await api.app.request(url, { method: 'POST', headers: client.headers })).status).toBe(
        403,
      )
      const editor = await api.loginAs('editor')
      expect((await api.app.request(url, { method: 'POST', headers: editor.headers })).status).toBe(
        202,
      )
      const token = await api.createToken()
      expect(
        (
          await api.app.request(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${token.token}` },
          })
        ).status,
      ).toBe(202)
      // Чужой сайт — 404, как везде: редактор другого сайта демо-сайта не видит
      // API сайтов не создаёт (одна установка — один сайт): сайт кладётся в базу напрямую
      const otherId = await api.createSite('Чужой')
      const stranger = await api.loginAs('editor', otherId)
      expect((await api.app.request(url, { headers: stranger.headers })).status).toBe(404)
      expect(recorder.requested).toEqual([api.demoSiteId, api.demoSiteId])
      // Без входа — 401: маршрут не в списке открытых
      expect((await api.app.request(url)).status).toBe(401)
    } finally {
      await api.close()
    }
  })
})
