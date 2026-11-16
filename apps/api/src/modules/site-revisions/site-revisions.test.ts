import { randomUUID } from 'node:crypto'
import {
  defaultFooter,
  defaultHeader,
  defaultTheme,
  demoSiteId,
  legacyTheme,
  themePresets,
} from '@averra/schema'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { siteRevisions, sites } from '../../db/schema'
import { createTestApi } from '../../testing'
import { SITE_REVISIONS_LIMIT, type SiteRevisionEntity } from './repo'

const builds: string[] = []
const api = await createTestApi({
  publisher: {
    request: async (id) => {
      builds.push(id)
    },
  },
})
afterAll(api.close)
const owner = await api.loginAs('owner')
const client = await api.loginAs('client')
const editor = await api.loginAs('editor')
const token = await api.createToken(demoSiteId, 'История', { blocksDraft: true })
const tokenHeaders = { authorization: `Bearer ${token.token}` }
const plainToken = await api.createToken()
type Headers = Record<string, string>
type State = { draft: Record<string, unknown>; published: Record<string, unknown> | null }
type Revision = {
  id: string
  version: number
  current: boolean
  publishedAt: string
  author: { kind: string; name: string } | null
}

const request = async (
  entity: SiteRevisionEntity,
  method = 'GET',
  suffix = '',
  body?: unknown,
  headers: Headers = owner.headers,
  siteId = demoSiteId,
) =>
  api.app.request(`/api/sites/${siteId}/${entity}${suffix}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
async function ok<T>(res: Response): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(200)
  return res.json() as Promise<T>
}
const state = (entity: SiteRevisionEntity) => request(entity).then(ok<State>)
const list = (entity: SiteRevisionEntity) =>
  request(entity, 'GET', '/revisions').then(ok<Revision[]>)
const save = (entity: SiteRevisionEntity, content: unknown) =>
  request(entity, 'PUT', '', content).then(ok<State>)
async function publish(entity: SiteRevisionEntity) {
  const body = entity === 'script' ? { draft: (await state(entity)).draft } : undefined
  return ok<State>(await request(entity, 'POST', '/publish', body))
}
const first = {
  header: {
    ...defaultHeader,
    logoText: 'Первая шапка',
    menu: [{ label: 'Главная', page: 'index' }],
  },
  footer: { ...defaultFooter, text: 'Первый подвал' },
  theme: themePresets.find((preset) => preset.id === 'night')?.theme ?? defaultTheme,
  script: { script: 'document.title = "Первая версия"', origins: ['https://widget.example.ru'] },
}
const second = {
  header: { ...defaultHeader, logoText: 'Вторая шапка' },
  footer: { ...defaultFooter, text: 'Второй подвал' },
  theme: defaultTheme,
  script: { script: 'document.title = "Вторая версия"', origins: [] },
}

beforeEach(async () => {
  await api.db.delete(siteRevisions)
  await api.db
    .update(sites)
    .set({
      headerPublished: null,
      headerDraft: null,
      footerPublished: null,
      footerDraft: null,
      theme: legacyTheme(defaultTheme),
      themePublished: null,
      themeDraft: null,
      scriptPublished: null,
      scriptDraft: null,
    })
    .where(eq(sites.id, demoSiteId))
  builds.length = 0
})

describe.each(['header', 'footer', 'theme', 'script'] as const)('история %s', (entity) => {
  it('пишет публикации с автором; возврат меняет только черновик, новая публикация получает новый номер', async () => {
    expect(await list(entity)).toEqual([])
    const initial = await save(entity, first[entity])
    expect(await list(entity)).toEqual([])
    await publish(entity)
    await save(entity, second[entity])
    const current = await publish(entity)
    const history = await list(entity)
    expect(history.map((revision) => [revision.version, revision.current])).toEqual([
      [2, true],
      [1, false],
    ])
    expect(history[0]?.author).toEqual({ kind: 'user', name: owner.user.name })
    expect(history[0]).not.toHaveProperty('content')
    expect(Number.isNaN(Date.parse(history[0]?.publishedAt ?? ''))).toBe(false)
    const version = history[1]
    if (!version) throw new Error('Нет первой версии')
    const stored = await api.db.select().from(siteRevisions).where(eq(siteRevisions.id, version.id))
    expect(stored[0]?.content).toEqual(initial.draft)
    builds.length = 0
    await request(entity, 'POST', `/revisions/${version.id}/restore`).then(ok)
    expect(await state(entity)).toMatchObject({
      draft: initial.draft,
      published: current.published,
    })
    expect(builds).toEqual([])
    expect(await list(entity)).toEqual(history)
    await publish(entity)
    expect((await state(entity)).published).toEqual(initial.draft)
    expect((await list(entity)).map((revision) => revision.version)).toEqual([3, 2, 1])
  })

  it('сохраняет последние 50 версий и продолжает нумерацию после очистки', async () => {
    await save(entity, first[entity])
    for (let i = 0; i < SITE_REVISIONS_LIMIT + 2; i++) await publish(entity)
    const history = await list(entity)
    expect(history).toHaveLength(SITE_REVISIONS_LIMIT)
    expect(history[0]?.version).toBe(52)
    expect(history.at(-1)?.version).toBe(3)
    const stored = await api.db
      .select()
      .from(siteRevisions)
      .where(and(eq(siteRevisions.siteId, demoSiteId), eq(siteRevisions.entity, entity)))
    expect(stored).toHaveLength(SITE_REVISIONS_LIMIT)
    await publish(entity)
    expect((await list(entity))[0]?.version).toBe(53)
  })

  it('проверяет роли и запрещает токену возврат даже с правом черновиков', async () => {
    await save(entity, first[entity])
    await publish(entity)
    const revision = (await list(entity))[0]
    if (!revision) throw new Error('Нет версии')
    expect(
      (
        await request(entity, 'GET', '/revisions', undefined, {
          authorization: `Bearer ${plainToken.token}`,
        })
      ).status,
    ).toBe(entity === 'script' ? 403 : 200)
    for (const headers of [owner.headers, tokenHeaders, client.headers, editor.headers]) {
      const readable = entity !== 'script' || headers === owner.headers || headers === tokenHeaders
      expect((await request(entity, 'GET', '/revisions', undefined, headers)).status).toBe(
        readable ? 200 : 403,
      )
    }
    for (const headers of [client.headers, editor.headers, tokenHeaders]) {
      const allowed = headers === client.headers && (entity === 'header' || entity === 'footer')
      expect(
        (await request(entity, 'POST', `/revisions/${revision.id}/restore`, undefined, headers))
          .status,
      ).toBe(allowed ? 200 : 403)
    }
    expect((await api.app.request(`/api/sites/${demoSiteId}/${entity}/revisions`)).status).toBe(401)
    const other = randomUUID()
    await api.db
      .insert(sites)
      .values({ id: other, name: 'Другой сайт', theme: legacyTheme(defaultTheme) })
    try {
      expect(
        (
          await request(
            entity,
            'POST',
            `/revisions/${revision.id}/restore`,
            undefined,
            owner.headers,
            other,
          )
        ).status,
      ).toBe(404)
      expect(
        (await request(entity, 'GET', '/revisions', undefined, tokenHeaders, other)).status,
      ).toBe(404)
    } finally {
      await api.db.delete(sites).where(eq(sites.id, other))
    }
    const different: SiteRevisionEntity = entity === 'header' ? 'theme' : 'header'
    expect((await request(different, 'POST', `/revisions/${revision.id}/restore`)).status).toBe(404)
  })

  it('ошибка записи истории отменяет публикацию в той же транзакции', async () => {
    const before = await state(entity)
    await save(entity, first[entity])
    await api.db.execute(
      sql`ALTER TABLE site_revisions ADD CONSTRAINT test_history_failure CHECK (version < 0)`,
    )
    try {
      const body = entity === 'script' ? { draft: (await state(entity)).draft } : undefined
      expect((await request(entity, 'POST', '/publish', body)).status).toBe(500)
      expect((await state(entity)).published).toEqual(before.published)
      expect(await list(entity)).toEqual([])
      expect(builds).toEqual([])
    } finally {
      await api.db.execute(sql`ALTER TABLE site_revisions DROP CONSTRAINT test_history_failure`)
    }
  })
})

it.each(['header', 'footer'] as const)(
  'возврат %s не обходит header.look; снятая публикация не помечена текущей',
  async (entity) => {
    await save(entity, first[entity])
    await publish(entity)
    const version = (await list(entity))[0]
    if (!version) throw new Error('Нет версии')
    const changed =
      entity === 'header'
        ? { ...first.header, sticky: !defaultHeader.sticky }
        : { ...first.footer, tone: 'accent' }
    const newer = await save(entity, changed)
    const denied = await request(
      entity,
      'POST',
      `/revisions/${version.id}/restore`,
      undefined,
      client.headers,
    )
    expect(denied.status).toBe(403)
    expect((await state(entity)).draft).toEqual(newer.draft)
    await request(entity, 'DELETE').then(ok)
    expect((await list(entity)).every((revision) => !revision.current)).toBe(true)
    await request(entity, 'POST', `/revisions/${version.id}/restore`).then(ok)
    expect((await state(entity)).published).toBeNull()
  },
)

it.each(['header', 'footer', 'theme', 'script'] as const)(
  'возврат %s проверяет нынешнюю схему без изменения черновика',
  async (entity) => {
    const current = await state(entity)
    const [revision] = await api.db
      .insert(siteRevisions)
      .values({ siteId: demoSiteId, entity, version: 1, content: { bad: true } })
      .returning()
    if (!revision) throw new Error('Нет версии')
    expect((await request(entity, 'POST', `/revisions/${revision.id}/restore`)).status).toBe(409)
    expect(await state(entity)).toEqual(current)
  },
)

it.each(['header', 'theme'] as const)(
  'возврат %s с удалённой картинкой не заменяет черновик',
  async (entity) => {
    const before = await state(entity)
    const content =
      entity === 'header'
        ? { ...defaultHeader, brand: 'image', logo: randomUUID() }
        : { ...defaultTheme, background: { mediaId: randomUUID(), size: 'tile' } }
    const [revision] = await api.db
      .insert(siteRevisions)
      .values({ siteId: demoSiteId, entity, version: 1, content })
      .returning()
    if (!revision) throw new Error('Нет версии')
    expect((await request(entity, 'POST', `/revisions/${revision.id}/restore`)).status).toBe(
      entity === 'header' ? 409 : 400,
    )
    expect(await state(entity)).toEqual(before)
  },
)

it.each(['header', 'footer'] as const)(
  'возврат %s с удалённым своим видом не заменяет черновик',
  async (entity) => {
    const before = await state(entity)
    const content = { ...first[entity], custom: { key: 'missing-chrome', props: {} } }
    const [revision] = await api.db
      .insert(siteRevisions)
      .values({ siteId: demoSiteId, entity, version: 1, content })
      .returning()
    if (!revision) throw new Error('Нет версии')
    expect((await request(entity, 'POST', `/revisions/${revision.id}/restore`)).status).toBe(409)
    expect(await state(entity)).toEqual(before)
  },
)
