import { demoPage, demoPageTitle, type PageContentInput } from '@cms/schema'
import { eq } from 'drizzle-orm'
import { testClient } from 'hono/testing'
import { afterAll, describe, expect, it } from 'vitest'
import { pageRevisions } from '../../db/schema'
import { createTestApi } from '../../testing'
import { sitesRepo } from '../sites/repo'

// История публикаций: что пишет публикация, что отдаёт API и что делает возврат в черновик.
// Каждый тест заводит свой сайт, чтобы номера версий не зависели от соседей

const api = await createTestApi()
const { app, db, close, loginAs } = api
afterAll(close)

const owner = await loginAs('owner')
const client = (headers: Record<string, string>) =>
  testClient(app, undefined, undefined, { headers }).api.sites
const asOwner = client(owner.headers)

const missingId = '00000000-0000-4000-8000-000000000000'

const contentWith = (title: string): PageContentInput => ({
  blocks: [{ id: 'hero', type: 'hero', props: { title } }],
})

async function newSite(name = 'Сайт с историей') {
  const res = await asOwner.$post({ json: { name } })
  if (res.status !== 201) throw new Error(`Ожидали 201, пришёл ${res.status}`)
  return (await res.json()).id
}

type Sites = ReturnType<typeof client>

/** Помощники страницы siteId/slug от имени того, чей клиент передан */
function pageOf(sites: Sites, siteId: string, slug: string) {
  const param = { siteId, slug }
  const page = sites[':siteId'].pages[':slug']
  const revisions = page.revisions
  return {
    param,
    save: (title: string, content: PageContentInput = contentWith(title)) =>
      page.$put({ param, json: { title, content } }),
    publish: () => page.publish.$post({ param }),
    get: async () => {
      const res = await page.$get({ param })
      if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
      return res.json()
    },
    list: () => revisions.$get({ param }),
    revisions: async () => {
      const res = await revisions.$get({ param })
      if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
      return res.json()
    },
    revision: (revisionId: string) =>
      revisions[':revisionId'].$get({ param: { ...param, revisionId } }),
    /** Содержимое версии: черновик после возврата должен совпасть с ним */
    content: async (revisionId: string) => {
      const res = await revisions[':revisionId'].$get({ param: { ...param, revisionId } })
      if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
      return (await res.json()).content
    },
    restore: (revisionId: string) =>
      revisions[':revisionId'].restore.$post({ param: { ...param, revisionId } }),
  }
}

/** Сохранить и опубликовать заголовок title с первым экраном того же текста */
async function publishVersion(page: ReturnType<typeof pageOf>, title: string) {
  expect((await page.save(title)).status).toBe(200)
  expect((await page.publish()).status).toBe(200)
}

async function snapshotTitles(siteId: string) {
  const res = await asOwner[':siteId'].snapshot.$get({ param: { siteId } })
  if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
  return (await res.json()).pages.map(({ slug, title, content }) => ({
    slug,
    title,
    hero: content.blocks[0]?.props,
  }))
}

describe('публикация пишет историю', () => {
  it('две публикации → две версии, возврат первой меняет только черновик', async () => {
    const siteId = await newSite()
    const page = pageOf(asOwner, siteId, 'index')

    await publishVersion(page, 'Первая')
    await publishVersion(page, 'Вторая')

    const list = await page.revisions()
    expect(list).toEqual([
      {
        id: expect.any(String),
        version: 2,
        title: 'Вторая',
        publishedAt: expect.any(String),
        author: { kind: 'user', name: owner.user.name },
      },
      expect.objectContaining({ version: 1, title: 'Первая' }),
    ])
    const [second, first] = list
    if (!first || !second) throw new Error('Нет версий')
    expect(Date.parse(second.publishedAt)).toBeGreaterThanOrEqual(Date.parse(first.publishedAt))
    // Время версии — время публикации страницы
    expect((await page.get()).publishedAt).toBe(second.publishedAt)

    const viewed = await page.revision(first.id)
    expect(viewed.status).toBe(200)
    expect(await viewed.json()).toMatchObject({
      id: first.id,
      version: 1,
      title: 'Первая',
      content: { blocks: [{ id: 'hero', type: 'hero', props: { title: 'Первая' } }] },
    })

    const restored = await page.restore(first.id)
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({
      title: 'Первая',
      draft: { blocks: [{ props: { title: 'Первая' } }] },
      publishedTitle: 'Вторая',
      published: { blocks: [{ props: { title: 'Вторая' } }] },
    })

    const after = await page.get()
    expect(after.title).toBe('Первая')
    expect(after.draft).toEqual(await page.content(first.id))
    expect(after.publishedTitle).toBe('Вторая')
    expect(after.publishedAt).toBe(second.publishedAt)
    expect(await snapshotTitles(siteId)).toEqual([
      { slug: 'index', title: 'Вторая', hero: expect.objectContaining({ title: 'Вторая' }) },
    ])
    // Возврат — не публикация: история та же, а в списке страниц видны неопубликованные правки
    expect(await page.revisions()).toEqual(list)
    const pages = await asOwner[':siteId'].pages.$get({ param: { siteId } })
    expect(await pages.json()).toEqual([
      expect.objectContaining({ slug: 'index', hasUnpublishedChanges: true }),
    ])

    // Опубликованная после возврата версия становится третьей, а не переписывает первую
    expect((await page.publish()).status).toBe(200)
    expect((await page.revisions()).map(({ version, title }) => ({ version, title }))).toEqual([
      { version: 3, title: 'Первая' },
      { version: 2, title: 'Вторая' },
      { version: 1, title: 'Первая' },
    ])
  })

  it('каждая публикация — новая версия, даже без изменений', async () => {
    const siteId = await newSite()
    const page = pageOf(asOwner, siteId, 'index')
    await publishVersion(page, 'Одно и то же')
    expect((await page.publish()).status).toBe(200)
    expect((await page.revisions()).map((r) => r.version)).toEqual([2, 1])
  })

  it('история у каждой страницы своя', async () => {
    const siteId = await newSite()
    const main = pageOf(asOwner, siteId, 'index')
    const other = pageOf(asOwner, siteId, 'o-nas')
    await publishVersion(main, 'Главная')
    await publishVersion(other, 'О нас')
    await publishVersion(other, 'О нас 2')
    expect((await main.revisions()).map((r) => r.title)).toEqual(['Главная'])
    expect((await other.revisions()).map((r) => r.version)).toEqual([2, 1])
  })

  it('черновик без публикации в историю не попадает', async () => {
    const siteId = await newSite()
    const page = pageOf(asOwner, siteId, 'index')
    expect((await page.save('Только черновик')).status).toBe(200)
    expect(await page.revisions()).toEqual([])
  })

  it('публикация токеном — автор с названием токена', async () => {
    const siteId = await newSite()
    const { token } = await api.createToken(siteId, 'mcp')
    const page = pageOf(client({ authorization: `Bearer ${token}` }), siteId, 'index')
    await publishVersion(page, 'Из MCP')
    expect((await page.revisions())[0]?.author).toEqual({ kind: 'token', name: 'mcp' })
  })

  it('сбой записи версии откатывает и публикацию', async () => {
    const siteId = await newSite()
    const page = pageOf(asOwner, siteId, 'index')
    await publishVersion(page, 'На сайте')
    expect((await page.save('Не опубликуется')).status).toBe(200)

    // Токена с таким id нет: вставка версии нарушит внешний ключ уже после UPDATE страницы
    const ghost = { kind: 'token', tokenId: missingId, siteId } as const
    await expect(sitesRepo(db).publish(siteId, 'index', ghost)).rejects.toThrow()

    const after = await page.get()
    expect(after.publishedTitle).toBe('На сайте')
    expect(after.published).toEqual(await page.content((await page.revisions())[0]?.id ?? ''))
    expect((await page.revisions()).map((r) => r.version)).toEqual([1])
  })

  it('удаление страницы удаляет историю: та же страница заново начинает с версии 1', async () => {
    const siteId = await newSite()
    const page = pageOf(asOwner, siteId, 'akcii')
    await publishVersion(page, 'Акции')
    await publishVersion(page, 'Акции 2')
    const oldId = (await page.revisions())[0]?.id ?? ''

    const removed = await asOwner[':siteId'].pages[':slug'].$delete({ param: page.param })
    expect(removed.status).toBe(204)
    expect(await db.select().from(pageRevisions).where(eq(pageRevisions.id, oldId))).toEqual([])

    await publishVersion(page, 'Акции заново')
    expect((await page.revisions()).map(({ version, title }) => ({ version, title }))).toEqual([
      { version: 1, title: 'Акции заново' },
    ])
    expect((await page.restore(oldId)).status).toBe(404)
  })

  it('демо-главная свежей базы уже с версией 1 без автора', async () => {
    const fresh = await createTestApi()
    try {
      const { headers } = await fresh.loginAs('owner')
      const sites = testClient(fresh.app, undefined, undefined, { headers }).api.sites
      const page = pageOf(sites, fresh.demoSiteId, 'index')
      const [only, ...rest] = await page.revisions()
      expect(rest).toEqual([])
      expect(only).toMatchObject({ version: 1, title: demoPageTitle, author: null })
      const viewed = await page.revision(only?.id ?? '')
      expect(await viewed.json()).toMatchObject({ content: { blocks: demoPage.blocks } })
    } finally {
      await fresh.close()
    }
  })
})

describe('ошибки', () => {
  it('нет страницы — 404 «Страница не найдена» на все три запроса', async () => {
    const siteId = await newSite()
    const page = pageOf(asOwner, siteId, 'net-takoi')
    const pageMissing = { error: { code: 'not_found', message: 'Страница не найдена' } }
    for (const res of [
      await page.list(),
      await page.revision(missingId),
      await page.restore(missingId),
    ]) {
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual(pageMissing)
    }
  })

  it('версия другой страницы или другого сайта — 404 «Версия не найдена»', async () => {
    const siteId = await newSite()
    const otherSiteId = await newSite('Другой сайт')
    const main = pageOf(asOwner, siteId, 'index')
    const other = pageOf(asOwner, siteId, 'drugaya')
    const foreign = pageOf(asOwner, otherSiteId, 'index')
    await publishVersion(other, 'Другая страница')
    await publishVersion(foreign, 'Другой сайт')
    await publishVersion(main, 'Главная')
    const otherId = (await other.revisions())[0]?.id ?? ''
    const foreignId = (await foreign.revisions())[0]?.id ?? ''

    const versionMissing = { error: { code: 'not_found', message: 'Версия не найдена' } }
    for (const id of [otherId, foreignId, missingId]) {
      for (const res of [await main.revision(id), await main.restore(id)]) {
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual(versionMissing)
      }
    }
    expect((await main.get()).title).toBe('Главная')
  })

  it('кривой id версии — 400 с путём до параметра', async () => {
    const siteId = await newSite()
    const page = pageOf(asOwner, siteId, 'index')
    for (const res of [await page.revision('nope'), await page.restore('nope')]) {
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({
        error: { code: 'validation', issues: [{ path: 'revisionId' }] },
      })
    }
  })

  it('версия, которую не пускают нынешние схемы, — 409, черновик не тронут', async () => {
    const siteId = await newSite()
    const page = pageOf(asOwner, siteId, 'index')
    await publishVersion(page, 'Старая')
    expect((await page.save('Черновик')).status).toBe(200)
    const [revision] = await page.revisions()
    if (!revision) throw new Error('Нет версии')
    // Так выглядел бы снимок, если бы схема блока с тех пор стала строже
    await db
      .update(pageRevisions)
      .set({ content: { blocks: [{ id: 'hero', type: 'hero', props: { title: '' } }] } as never })
      .where(eq(pageRevisions.id, revision.id))

    const res = await page.restore(revision.id)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: {
        code: 'conflict',
        message: 'Версия 1 не подходит под нынешние схемы блоков, вернуть её в черновик нельзя',
        issues: [{ path: 'content.blocks.0.props.title', message: expect.any(String) }],
      },
    })
    expect((await page.get()).title).toBe('Черновик')
  })
})

describe('права', () => {
  async function siteWithHistory() {
    const siteId = await newSite()
    const page = pageOf(asOwner, siteId, 'index')
    await publishVersion(page, 'Первая')
    await publishVersion(page, 'Вторая')
    const [, first] = await page.revisions()
    if (!first) throw new Error('Нет версий')
    return { siteId, firstId: first.id }
  }

  it('клиент смотрит историю и возвращает версию в черновик', async () => {
    const { siteId, firstId } = await siteWithHistory()
    const { headers } = await loginAs('client', siteId)
    const page = pageOf(client(headers), siteId, 'index')

    expect((await page.revisions()).map((r) => r.version)).toEqual([2, 1])
    expect((await page.revision(firstId)).status).toBe(200)
    expect((await page.restore(firstId)).status).toBe(200)
    expect((await page.get()).title).toBe('Первая')
    // А опубликовать возвращённое — уже не его дело
    expect((await page.publish()).status).toBe(403)
  })

  it('редактор и токен своего сайта — тоже', async () => {
    const { siteId, firstId } = await siteWithHistory()
    const editor = await loginAs('editor', siteId)
    const { token } = await api.createToken(siteId)
    for (const headers of [editor.headers, { authorization: `Bearer ${token}` }]) {
      const page = pageOf(client(headers), siteId, 'index')
      expect((await page.list()).status).toBe(200)
      expect((await page.restore(firstId)).status).toBe(200)
    }
  })

  it.each(['editor', 'client'] as const)(
    '%s чужого сайта получает 404 «Сайт не найден»',
    async (role) => {
      const { siteId, firstId } = await siteWithHistory()
      const { headers } = await loginAs(role)
      const page = pageOf(client(headers), siteId, 'index')
      for (const res of [
        await page.list(),
        await page.revision(firstId),
        await page.restore(firstId),
      ]) {
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({
          error: { code: 'not_found', message: 'Сайт не найден' },
        })
      }
      expect((await pageOf(asOwner, siteId, 'index').get()).title).toBe('Вторая')
    },
  )

  it('без входа — 401, возврат с cookie не из админки — 403', async () => {
    const { siteId, firstId } = await siteWithHistory()
    const anonymous = pageOf(client({}), siteId, 'index')
    for (const res of [
      await anonymous.list(),
      await anonymous.revision(firstId),
      await anonymous.restore(firstId),
    ]) {
      expect(res.status).toBe(401)
    }
    const foreignOrigin = { ...owner.headers, origin: 'https://evil.example' }
    expect((await pageOf(client(foreignOrigin), siteId, 'index').restore(firstId)).status).toBe(403)
    expect((await pageOf(asOwner, siteId, 'index').get()).title).toBe('Вторая')
  })
})
