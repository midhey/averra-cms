import { type CustomBlockDraftInput, demoSiteId } from '@averra/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { customBlockRevisions, customBlocks, sites } from '../../db/schema'
import type { SitePublisher } from '../../publish/queue'
import { createTestApi } from '../../testing'

// Свой JS: скрипт сайта (черновик, публикация, права) и скрипт своего блока (хранение отдельно от
// определения, публикация, снимок рендерера). Решение — «Решения → Свой JS на сайте»

type Headers = Record<string, string>
type ScriptState = {
  draft: { script: string; origins: string[] }
  published: { script: string; origins: string[] }
  unpublished: boolean
  problems: { part: string; level: string }[]
}

const requested: string[] = []
const publisher: SitePublisher = {
  request: async (siteId) => {
    requested.push(siteId)
  },
}
const api = await createTestApi({ publisher })
afterAll(api.close)
const { app, db } = api

const owner = await api.loginAs('owner')
const editor = await api.loginAs('editor')
const client = await api.loginAs('client')
const plain = { authorization: `Bearer ${(await api.createToken()).token}` }
const granted = await api.createToken(demoSiteId, 'mcp с правом', { blocksDraft: true })
const withGrant = { authorization: `Bearer ${granted.token}` }

const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })
const request = (method: string, path: string, body?: unknown, headers: Headers = owner.headers) =>
  app.request(`/api/sites/${demoSiteId}${path}`, {
    method,
    headers: body === undefined ? headers : json(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function ok<T>(res: Response, status = 200) {
  expect(res.status, await res.clone().text()).toBe(status)
  return (await res.json()) as T
}

const snapshot = async () =>
  ok<{
    site: { script: { script: string; origins: string[] } }
    customBlocks: Record<string, { script?: string }>
  }>(await app.request(`/api/sites/${demoSiteId}/snapshot`))

beforeEach(async () => {
  await db.update(sites).set({ scriptDraft: null, scriptPublished: null })
  await db.delete(customBlocks)
  requested.length = 0
})

describe('скрипт сайта', () => {
  const script = { script: "document.documentElement.dataset.js = 'yes'", origins: [] }

  it('черновик → публикация → снимок; сайт пересобирается', async () => {
    const empty = await ok<ScriptState>(await request('GET', '/script'))
    expect(empty).toMatchObject({ draft: { script: '', origins: [] }, unpublished: false })

    const saved = await ok<ScriptState>(
      await request('PUT', '/script', { ...script, origins: ['HTTPS://Widget.Example.ru/'] }),
    )
    expect(saved.draft.origins).toEqual(['https://widget.example.ru'])
    expect(saved.unpublished).toBe(true)
    expect((await snapshot()).site.script).toEqual({ script: '', origins: [] })

    const published = await ok<ScriptState>(
      await request('POST', '/script/publish', { draft: saved.draft }),
    )
    expect(published.unpublished).toBe(false)
    expect(requested).toEqual([demoSiteId])
    expect((await snapshot()).site.script).toEqual(saved.draft)
  })

  it('черновик с ошибкой разбора сохраняется, но не публикуется', async () => {
    const saved = await ok<ScriptState>(await request('PUT', '/script', { script: 'const = 1' }))
    expect(saved.problems).toContainEqual(expect.objectContaining({ level: 'error' }))
    const res = await request('POST', '/script/publish', { draft: saved.draft })
    expect(res.status).toBe(400)
    expect(requested).toEqual([])
  })

  it('черновик поменяли после того, как человек его видел, — 409', async () => {
    const seen = await ok<ScriptState>(await request('PUT', '/script', script))
    await ok(await request('PUT', '/script', { script: 'console.log(1)' }, withGrant))
    expect((await request('POST', '/script/publish', { draft: seen.draft })).status).toBe(409)
  })

  it('домен с лишним знаком не попадает в CSP: 400', async () => {
    for (const origin of [
      "https://a.ru 'unsafe-inline'",
      'https://a.ru; script-src *',
      'http://a.ru',
    ]) {
      expect((await request('PUT', '/script', { script: '', origins: [origin] })).status).toBe(400)
    }
  })

  it('отмена черновика: снова как на сайте', async () => {
    const saved = await ok<ScriptState>(await request('PUT', '/script', script))
    await ok(await request('POST', '/script/publish', { draft: saved.draft }))
    await ok(await request('PUT', '/script', { script: 'другое()' }))
    const discarded = await ok<ScriptState>(await request('DELETE', '/script'))
    expect(discarded).toMatchObject({ draft: script, unpublished: false })
  })

  it('права: администратор сайта и редактор — нет; токен — черновик по праву, публикация — никогда', async () => {
    for (const who of [client.headers, editor.headers]) {
      expect((await request('GET', '/script', undefined, who)).status).toBe(403)
      expect((await request('PUT', '/script', script, who)).status).toBe(403)
      expect((await request('POST', '/script/publish', { draft: script }, who)).status).toBe(403)
    }
    // Токен без права «Черновики своих блоков»
    expect((await request('GET', '/script', undefined, plain)).status).toBe(403)
    expect((await request('PUT', '/script', script, plain)).status).toBe(403)
    // С правом — черновик да, публикация нет
    const saved = await ok<ScriptState>(await request('PUT', '/script', script, withGrant))
    const denied = await request('POST', '/script/publish', { draft: saved.draft }, withGrant)
    expect(denied.status).toBe(403)
    expect(await denied.text()).toContain('скрипт сайта только владелец')
    expect((await snapshot()).site.script.script).toBe('')
  })
})

describe('скрипт своего блока', () => {
  const block = (script: string): CustomBlockDraftInput => ({
    key: 'tabs',
    title: 'Вкладки',
    description: 'Вкладки со скриптом',
    fields: [{ type: 'text', name: 'title', label: 'Заголовок', required: true }],
    template: '<h2>{{ title }}</h2>',
    css: '',
    script,
    example: { title: 'Вкладки' },
  })
  const blocks = (path = '', method = 'GET', body?: unknown, headers?: Headers) =>
    request(method, `/custom-blocks${path}`, body, headers)

  it('хранится в своей колонке, JSON определения — без скрипта (откат его прочитает)', async () => {
    await ok(await blocks('', 'POST', { key: 'tabs', title: 'Вкладки' }), 201)
    const saved = await ok<{ draft: { script: string }; unpublished: boolean }>(
      await blocks('/tabs', 'PUT', block('blocks[0].dataset.ready = ""')),
    )
    expect(saved.draft.script).toBe('blocks[0].dataset.ready = ""')
    const [row] = await db.select().from(customBlocks).where(eq(customBlocks.key, 'tabs'))
    expect(row?.scriptDraft).toBe('blocks[0].dataset.ready = ""')
    expect(row?.draft).not.toHaveProperty('script')
  })

  it('публикация переносит скрипт на сайт и в историю; правка одного скрипта — «не опубликовано»', async () => {
    await ok(await blocks('', 'POST', { key: 'tabs', title: 'Вкладки' }), 201)
    const first = await ok<{ draft: unknown }>(
      await blocks('/tabs', 'PUT', block('console.log(1)')),
    )
    await ok(await blocks('/tabs/publish', 'POST', { draft: first.draft }))
    expect((await snapshot()).customBlocks.tabs?.script).toBe('console.log(1)')
    const [revision] = await db.select().from(customBlockRevisions)
    expect(revision?.definition).toMatchObject({ script: 'console.log(1)' })

    const edited = await ok<{ unpublished: boolean }>(
      await blocks('/tabs', 'PUT', block('console.log(2)')),
    )
    expect(edited.unpublished).toBe(true)
    expect((await snapshot()).customBlocks.tabs?.script).toBe('console.log(1)')
  })

  it('ошибка разбора скрипта не даёт опубликовать блок', async () => {
    await ok(await blocks('', 'POST', { key: 'tabs', title: 'Вкладки' }), 201)
    const saved = await ok<{ draft: unknown; problems: { part: string; level: string }[] }>(
      await blocks('/tabs', 'PUT', block('import x from "y"')),
    )
    expect(saved.problems).toContainEqual(
      expect.objectContaining({ part: 'script', level: 'error' }),
    )
    expect((await blocks('/tabs/publish', 'POST', { draft: saved.draft })).status).toBe(400)
  })

  it('токен с правом пишет скрипт в черновик, опубликовать не может', async () => {
    await ok(await blocks('', 'POST', { key: 'tabs', title: 'Вкладки' }, withGrant), 201)
    const saved = await ok<{ draft: unknown }>(
      await blocks('/tabs', 'PUT', block('console.log(1)'), withGrant),
    )
    expect((await blocks('/tabs/publish', 'POST', { draft: saved.draft }, withGrant)).status).toBe(
      403,
    )
    expect((await blocks('/tabs', 'PUT', block('x()'), client.headers)).status).toBe(403)
    expect((await blocks('/tabs', 'PUT', block('x()'), editor.headers)).status).toBe(403)
  })
})
