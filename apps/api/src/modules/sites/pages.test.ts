import { hero, type PageContentInput } from '@averra/schema'
import { defaultTheme } from '@averra/tokens'
import { testClient } from 'hono/testing'
import { afterAll, describe, expect, it } from 'vitest'
import { pages as pagesTable } from '../../db/schema'
import { createTestApi } from '../../testing'

// Создание сайтов, список, создание и удаление страниц.
// Каждый тест заводит свой сайт: тесты не зависят ни от демо-сайта, ни друг от друга

const { app, db, close, loginAs } = await createTestApi()
// Права ролей проверяет auth/access.test.ts, здесь — сами сайты и страницы глазами владельца
const owner = await loginAs('owner')
const sites = testClient(app, undefined, undefined, { headers: owner.headers }).api.sites
const [demo] = await (await sites.$get()).json()
if (!demo) throw new Error('Демо-сайт не создался')

afterAll(close)

const missingSiteId = '00000000-0000-4000-8000-000000000000'

const otherContent: PageContentInput = {
  blocks: [
    {
      id: 'cta',
      type: 'cta',
      props: { title: 'Звоните', button: { label: 'Позвонить', href: 'tel:+70000000000' } },
    },
  ],
}

async function newSite(name = 'Тестовый сайт') {
  const res = await sites.$post({ json: { name } })
  if (res.status !== 201) throw new Error(`Ожидали 201, пришёл ${res.status}`)
  return res.json()
}

async function listPages(siteId: string) {
  const res = await sites[':siteId'].pages.$get({ param: { siteId } })
  if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
  return res.json()
}

const slugsOf = async (siteId: string) => (await listPages(siteId)).map((page) => page.slug)

async function createPage(siteId: string, slug: string, template?: 'empty' | 'hero') {
  const res = await sites[':siteId'].pages.$post({
    param: { siteId },
    json: { slug, title: `Страница ${slug}`, template },
  })
  if (res.status !== 201) throw new Error(`Ожидали 201, пришёл ${res.status}`)
  return res.json()
}

async function getPage(siteId: string, slug: string) {
  const res = await sites[':siteId'].pages[':slug'].$get({ param: { siteId, slug } })
  if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
  return res.json()
}

async function publishedSlugs(siteId: string) {
  const res = await sites[':siteId'].snapshot.$get({ param: { siteId } })
  if (res.status !== 200) throw new Error(`Ожидали 200, пришёл ${res.status}`)
  return (await res.json()).pages.map((page) => page.slug)
}

/** Запрос в обход типизированного клиента: чтобы прислать то, что типы бы не пропустили */
const sendJson = (method: 'POST' | 'PUT', path: string, body: unknown) =>
  app.request(path, {
    method,
    headers: { ...owner.headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('создание сайта', () => {
  it('создаёт сайт с темой по умолчанию и пустой неопубликованной главной', async () => {
    const created = await newSite('  Студия йоги  ')
    expect(created.name).toBe('Студия йоги')
    expect(created.theme).toEqual(defaultTheme)

    const all = await (await sites.$get()).json()
    expect(all).toContainEqual({ id: created.id, name: 'Студия йоги' })
    // Новый сайт не встаёт перед демо: рендерер без CMS_SITE_ID берёт первый
    expect(all[0]?.id).toBe(demo.id)

    expect(await listPages(created.id)).toEqual([
      expect.objectContaining({
        slug: 'index',
        title: 'Студия йоги',
        publishedAt: null,
        hasUnpublishedChanges: true,
      }),
    ])
    expect((await getPage(created.id, 'index')).draft).toEqual({ blocks: [] })
    expect(await publishedSlugs(created.id)).toEqual([])
  })

  it('не создаёт сайт без названия или с лишними полями', async () => {
    const before = (await (await sites.$get()).json()).length

    const empty = await sites.$post({ json: { name: '   ' } })
    expect(empty.status).toBe(400)
    expect(await empty.json()).toMatchObject({
      error: { code: 'validation', issues: [{ path: 'name' }] },
    })

    const extra = await sendJson('POST', '/api/sites', { name: 'Сайт', theme: {} })
    expect(extra.status).toBe(400)

    expect((await (await sites.$get()).json()).length).toBe(before)
  })
})

describe('список страниц', () => {
  it('показывает, есть ли у страницы неопубликованные изменения', async () => {
    const site = await newSite()
    const param = { siteId: site.id, slug: 'o-nas' }
    const page = sites[':siteId'].pages[':slug']
    const row = async () => (await listPages(site.id)).find((p) => p.slug === 'o-nas')

    await createPage(site.id, 'o-nas', 'hero')
    expect(await row()).toMatchObject({ hasUnpublishedChanges: true, publishedAt: null })

    await page.publish.$post({ param })
    const published = await row()
    expect(published?.hasUnpublishedChanges).toBe(false)
    expect(Number.isNaN(Date.parse(published?.publishedAt ?? ''))).toBe(false)

    // То же содержимое, сохранённое ещё раз с ключами в другом порядке, — не изменение
    const { title, draft } = await getPage(site.id, 'o-nas')
    const reversed = (value: object) => Object.fromEntries(Object.entries(value).reverse())
    const reordered = reversed({ blocks: draft.blocks.map(reversed) })
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(draft))
    const resaved = await sendJson('PUT', `/api/sites/${site.id}/pages/o-nas`, {
      title,
      content: reordered,
    })
    expect(resaved.status).toBe(200)
    expect((await row())?.hasUnpublishedChanges).toBe(false)

    // Правка только заголовка — тоже изменение: он публикуется вместе с блоками
    await page.$put({ param, json: { title: 'Новый заголовок', content: draft } })
    expect((await row())?.hasUnpublishedChanges).toBe(true)

    await page.publish.$post({ param })
    expect((await row())?.hasUnpublishedChanges).toBe(false)

    // И правка только блоков
    await page.$put({ param, json: { title: 'Новый заголовок', content: otherContent } })
    expect((await row())?.hasUnpublishedChanges).toBe(true)
  })

  it('ставит главную первой, остальные по адресу', async () => {
    const site = await newSite()
    await createPage(site.id, 'uslugi')
    await createPage(site.id, 'akcii')
    await createPage(site.id, 'z')
    expect(await slugsOf(site.id)).toEqual(['index', 'akcii', 'uslugi', 'z'])
  })

  it('показывает только страницы своего сайта', async () => {
    const first = await newSite()
    const second = await newSite()
    await createPage(first.id, 'tolko-tut')
    expect(await slugsOf(second.id)).toEqual(['index'])
  })

  it('демо-главная в списке опубликована и без изменений', async () => {
    const [main] = await listPages(demo.id)
    expect(main).toMatchObject({ slug: 'index', hasUnpublishedChanges: false })
    expect(main?.publishedAt).not.toBeNull()
  })

  it('отвечает 404 на несуществующий сайт и 400 на кривой id', async () => {
    const missing = await sites[':siteId'].pages.$get({ param: { siteId: missingSiteId } })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      error: { code: 'not_found', message: 'Сайт не найден' },
    })
    const bad = await sites[':siteId'].pages.$get({ param: { siteId: 'nope' } })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: { code: 'validation' } })
  })
})

describe('создание страницы', () => {
  it('создаёт пустую страницу черновиком: на сайт она не попадает', async () => {
    const site = await newSite()
    const res = await sites[':siteId'].pages.$post({
      param: { siteId: site.id },
      json: { slug: 'kontakty', title: '  Контакты ' },
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      slug: 'kontakty',
      title: 'Контакты',
      draft: { blocks: [] },
      published: null,
      publishedAt: null,
    })
    expect(await slugsOf(site.id)).toEqual(['index', 'kontakty'])
    expect(await publishedSlugs(site.id)).toEqual([])
  })

  it('по шаблону hero кладёт первый экран из каталога; после публикации он на сайте', async () => {
    const site = await newSite()
    const page = await createPage(site.id, 'promo', 'hero')
    expect(page.draft.blocks).toEqual([
      { id: 'hero', type: 'hero', props: { variant: 'centered', ...hero.example } },
    ])

    await sites[':siteId'].pages[':slug'].publish.$post({
      param: { siteId: site.id, slug: 'promo' },
    })
    expect(await publishedSlugs(site.id)).toEqual(['promo'])
  })

  it('отвечает 409 на занятый адрес и показывает, какое поле поправить', async () => {
    const site = await newSite()
    await createPage(site.id, 'o-nas', 'hero')
    const res = await sites[':siteId'].pages.$post({
      param: { siteId: site.id },
      json: { slug: 'o-nas', title: 'Другая' },
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: {
        code: 'conflict',
        message: 'Страница с адресом «o-nas» уже есть',
        issues: [{ path: 'slug', message: 'Такой адрес уже есть' }],
      },
    })
    // Существующая страница не изменилась
    expect(await getPage(site.id, 'o-nas')).toMatchObject({
      title: 'Страница o-nas',
      draft: { blocks: [{ type: 'hero' }] },
    })

    // Главная у нового сайта уже есть, её адрес тоже занят
    const main = await sites[':siteId'].pages.$post({
      param: { siteId: site.id },
      json: { slug: 'index', title: 'Вторая главная' },
    })
    expect(main.status).toBe(409)
    expect((await getPage(site.id, 'index')).title).toBe('Тестовый сайт')
  })

  it('тот же адрес на другом сайте свободен', async () => {
    const first = await newSite()
    const second = await newSite()
    await createPage(first.id, 'o-nas')
    await expect(createPage(second.id, 'o-nas')).resolves.toMatchObject({ slug: 'o-nas' })
  })

  it.each([
    ['заглавные', 'O-Nas'],
    ['кириллица', 'о-нас'],
    ['висящий дефис', 'o-nas-'],
    ['пробел', 'o nas'],
    ['пустой', ''],
  ])('не принимает кривой адрес: %s', async (_, slug) => {
    const site = await newSite()
    const res = await sites[':siteId'].pages.$post({
      param: { siteId: site.id },
      json: { slug, title: 'Страница' },
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { code: 'validation', issues: [{ path: 'slug' }] },
    })
    expect(await slugsOf(site.id)).toEqual(['index'])
  })

  it('не принимает пустой заголовок, неизвестный шаблон и лишние поля', async () => {
    const site = await newSite()
    const res = await sendJson('POST', `/api/sites/${site.id}/pages`, {
      slug: 'a',
      title: ' ',
      template: 'blog',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { issues: { path: string; message: string }[] } }
    expect(body.error.issues.map((issue) => issue.path).sort()).toEqual(['template', 'title'])
    // Сообщения — те же, что админка показывает у поля до отправки (setupZodMessages)
    const titleIssue = body.error.issues.find((issue) => issue.path === 'title')
    expect(titleIssue?.message).toBe('Поле не может быть пустым')
    const templateIssue = body.error.issues.find((issue) => issue.path === 'template')
    expect(templateIssue?.message).toMatch(/^Неверный вариант/)

    const extra = await sendJson('POST', `/api/sites/${site.id}/pages`, {
      slug: 'a',
      title: 'А',
      content: { blocks: [] },
    })
    expect(extra.status).toBe(400)
    expect(await slugsOf(site.id)).toEqual(['index'])
  })

  it('отвечает 404, если сайта нет', async () => {
    const res = await sites[':siteId'].pages.$post({
      param: { siteId: missingSiteId },
      json: { slug: 'o-nas', title: 'О нас' },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})

describe('удаление страницы', () => {
  it('удаляет страницу: её нет ни в списке, ни на сайте', async () => {
    const site = await newSite()
    await createPage(site.id, 'akciya', 'hero')
    const param = { siteId: site.id, slug: 'akciya' }
    const page = sites[':siteId'].pages[':slug']
    await page.publish.$post({ param })
    expect(await publishedSlugs(site.id)).toEqual(['akciya'])

    const res = await page.$delete({ param })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')

    expect(await slugsOf(site.id)).toEqual(['index'])
    expect(await publishedSlugs(site.id)).toEqual([])
    expect((await page.$get({ param })).status).toBe(404)

    // Второй раз удалять нечего
    const again = await page.$delete({ param })
    expect(again.status).toBe(404)
    expect(await again.json()).toEqual({
      error: { code: 'not_found', message: 'Страница не найдена' },
    })
  })

  it('не удаляет главную', async () => {
    const res = await sites[':siteId'].pages[':slug'].$delete({
      param: { siteId: demo.id, slug: 'index' },
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: { code: 'conflict', message: 'Главную страницу удалить нельзя', issues: [] },
    })
    expect(await slugsOf(demo.id)).toContain('index')
    expect(await publishedSlugs(demo.id)).toContain('index')
  })

  it('удаляет только на своём сайте', async () => {
    const first = await newSite()
    const second = await newSite()
    await createPage(first.id, 'o-nas')
    await createPage(second.id, 'o-nas')
    const res = await sites[':siteId'].pages[':slug'].$delete({
      param: { siteId: first.id, slug: 'o-nas' },
    })
    expect(res.status).toBe(204)
    expect(await slugsOf(first.id)).toEqual(['index'])
    expect(await slugsOf(second.id)).toEqual(['index', 'o-nas'])
  })

  it('отвечает 404 на несуществующий сайт и 400 на кривой адрес', async () => {
    const missing = await sites[':siteId'].pages[':slug'].$delete({
      param: { siteId: missingSiteId, slug: 'o-nas' },
    })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      error: { code: 'not_found', message: 'Сайт не найден' },
    })

    const bad = await sites[':siteId'].pages[':slug'].$delete({
      param: { siteId: demo.id, slug: 'O_NAS' },
    })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({
      error: { code: 'validation', issues: [{ path: 'slug' }] },
    })
  })
})

describe('страницы со старыми адресами', () => {
  // До шага 2.1 PUT пускал адреса вроде «a-» и «--a». Такие страницы лежат в базе:
  // их кладём напрямую, как оставил бы старый API
  async function legacyPage(siteId: string, slug: string) {
    const content = { blocks: [] }
    await db.insert(pagesTable).values({ siteId, slug, title: `Старая ${slug}`, draft: content })
  }

  it('открываются, сохраняются, публикуются, видны в истории и удаляются', async () => {
    const site = await newSite()
    await legacyPage(site.id, 'a-')
    expect((await getPage(site.id, 'a-')).title).toBe('Старая a-')

    const saved = await sendJson('PUT', `/api/sites/${site.id}/pages/a-`, {
      title: 'Поправили',
      content: otherContent,
    })
    expect(saved.status).toBe(200)
    const published = await sites[':siteId'].pages[':slug'].publish.$post({
      param: { siteId: site.id, slug: 'a-' },
    })
    expect(published.status).toBe(200)
    const history = await app.request(`/api/sites/${site.id}/pages/a-/revisions`, {
      headers: owner.headers,
    })
    expect(history.status).toBe(200)

    const removed = await sites[':siteId'].pages[':slug'].$delete({
      param: { siteId: site.id, slug: 'a-' },
    })
    expect(removed.status).toBe(204)
    expect(await slugsOf(site.id)).toEqual(['index'])
  })

  it('новую страницу со старым адресом не создать ни POST, ни PUT', async () => {
    const site = await newSite()
    const put = await sendJson('PUT', `/api/sites/${site.id}/pages/--a`, {
      title: 'Новая',
      content: { blocks: [] },
    })
    expect(put.status).toBe(400)
    expect(await put.json()).toMatchObject({
      error: {
        code: 'validation',
        issues: [{ path: 'slug', message: expect.stringMatching(/^Только латиница/) }],
      },
    })
    const post = await sendJson('POST', `/api/sites/${site.id}/pages`, { slug: 'b-', title: 'Б' })
    expect(post.status).toBe(400)
    expect(await slugsOf(site.id)).toEqual(['index'])
  })
})
