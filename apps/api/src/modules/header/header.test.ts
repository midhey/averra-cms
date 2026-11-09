import {
  defaultHeader,
  demoSiteId,
  type Header,
  type HeaderTargetPage,
  LOOK_LOCKED_CODE,
} from '@averra/schema'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pages, sites } from '../../db/schema'
import type { SitePublisher } from '../../publish/queue'
import { createTestApi } from '../../testing'
import { headerRepo } from './repo'

// Шапка сайта и меню: черновик (PUT), публикация (POST /publish) с проверкой целей меню против
// опубликованного, снимок для сборки, логотип из медиатеки и права. Демо-сайт: главная
// опубликована с блоками hero, benefits и contact

type Headers = Record<string, string>
type View = {
  draft: Header
  published: Header | null
  unpublished: boolean
  targets?: HeaderTargetPage[]
  contacts?: { phone: string; address: string } | null
}
type Problem = {
  error: { code: string; message: string; issues: { path: string; message: string }[] }
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
const url = `/api/sites/${demoSiteId}/header`
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })
const read = (headers: Headers = owner.headers) => app.request(url, { headers })
const save = (body: unknown, headers: Headers = owner.headers) =>
  app.request(url, { method: 'PUT', headers: json(headers), body: JSON.stringify(body) })
const publish = (headers: Headers = owner.headers) =>
  app.request(`${url}/publish`, { method: 'POST', headers })

async function ok(res: Response) {
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as View
}

const problemOf = async (res: Response) => ((await res.json()) as Problem).error

async function snapshotHeader() {
  const res = await app.request(`/api/sites/${demoSiteId}/snapshot`)
  return ((await res.json()) as { site: { header: Header | null } }).site.header
}

const menu = [
  { label: 'Почему мы', page: 'index', block: 'benefits' },
  { label: 'Связаться', page: 'index', block: 'contact' },
]

beforeEach(async () => {
  await db
    .update(sites)
    .set({ headerDraft: null, headerPublished: null })
    .where(eq(sites.id, demoSiteId))
  await db.delete(pages).where(eq(pages.slug, 'akcii'))
  requested.length = 0
})

describe('шапка до публикации', () => {
  it('сайт до шага шапки: черновик по умолчанию, на сайте шапки нет', async () => {
    const view = await ok(await read())
    expect(view.draft).toEqual(defaultHeader)
    expect(view.published).toBeNull()
    expect(view.unpublished).toBe(true)
    expect(await snapshotHeader()).toBeNull()
  })

  it('цели меню — страницы с блоками: что в черновике и что на сайте', async () => {
    const view = await ok(await read())
    const main = view.targets?.find((page) => page.slug === 'index')
    expect(main).toMatchObject({ published: true, hideHeader: false, overlay: false })
    expect(main?.blocks.map((block) => block.id)).toEqual(['hero', 'benefits', 'contact'])
    expect(main?.blocks[1]).toEqual({
      id: 'benefits',
      type: 'features',
      label: 'Почему выбирают нас',
      draft: true,
      published: true,
    })
  })

  it('подпись цели без разметки *акцента*: звёздочек в списке «Куда ведёт» нет', async () => {
    const [main] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.siteId, demoSiteId), eq(pages.slug, 'index')))
    if (!main) throw new Error('Нет главной')
    const draft = main.draft as {
      blocks: { id: string; type: string; props: { title?: string } }[]
    }
    const withAccent = {
      ...draft,
      blocks: draft.blocks.map((block) =>
        block.id === 'benefits'
          ? {
              ...block,
              props: { ...block.props, title: 'Английский, *который вписывается* в жизнь' },
            }
          : block,
      ),
    }
    await db
      .update(pages)
      .set({ draft: withAccent as typeof main.draft })
      .where(eq(pages.id, main.id))
    try {
      const view = await ok(await read())
      const label = view.targets
        ?.find((page) => page.slug === 'index')
        ?.blocks.find((block) => block.id === 'benefits')?.label
      expect(label).toBe('Английский, который вписывается в жизнь')
    } finally {
      await db.update(pages).set({ draft: main.draft }).where(eq(pages.id, main.id))
    }
  })

  it('телефон и адрес организации — людям для предпросмотра, токену — нет', async () => {
    expect((await ok(await read())).contacts).toEqual({ phone: '', address: '' })
    const { token } = await api.createToken()
    const view = await ok(await read({ authorization: `Bearer ${token}` }))
    expect(view.contacts).toBeNull()
  })

  it('главная не опубликована — контактов нет и людям: на сайте их ещё нет', async () => {
    const [main] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.siteId, demoSiteId), eq(pages.slug, 'index')))
    if (!main) throw new Error('Нет главной')
    await db
      .update(pages)
      .set({ published: null, publishedTitle: null })
      .where(eq(pages.id, main.id))
    try {
      const editor = await api.loginAs('editor')
      expect((await ok(await read(editor.headers))).contacts).toBeNull()
      expect((await ok(await read())).contacts).toBeNull()
    } finally {
      await db
        .update(pages)
        .set({ published: main.published, publishedTitle: main.publishedTitle })
        .where(eq(pages.id, main.id))
    }
  })
})

describe('черновик и публикация', () => {
  it('сохранение меняет только черновик: снимок прежний, сборки нет', async () => {
    const view = await ok(await save({ layout: 'double', menu }))
    expect(view.draft).toMatchObject({ layout: 'double', sticky: true, menu })
    expect(view.published).toBeNull()
    expect(requested).toEqual([])
    expect(await snapshotHeader()).toBeNull()
  })

  it('публикация: шапка — в снимок сборки, сайт пересобирается', async () => {
    const button = { label: 'Написать', page: 'index', block: 'contact' }
    await ok(await save({ layout: 'center', condense: true, phone: true, button, menu }))
    const view = await ok(await publish())
    expect(view.published).toMatchObject({ layout: 'center', condense: true, button, menu })
    expect(view.unpublished).toBe(false)
    expect(requested).toEqual([demoSiteId])
    expect(await snapshotHeader()).toEqual(view.published)
    const [row] = await db.select().from(sites).where(eq(sites.id, demoSiteId))
    expect(row?.headerDraft).toBeNull()
  })

  it('убрать шапку с сайта: на сайте её нет, настройки остаются черновиком', async () => {
    await ok(await save({ layout: 'minimal' }))
    await ok(await publish())
    requested.length = 0
    const view = await ok(await app.request(url, { method: 'DELETE', headers: owner.headers }))
    expect(view.published).toBeNull()
    expect(view.draft.layout).toBe('minimal')
    expect(requested).toEqual([demoSiteId])
    expect(await snapshotHeader()).toBeNull()
    // Шапки и так не было — пересобирать нечего
    requested.length = 0
    await ok(await app.request(url, { method: 'DELETE', headers: owner.headers }))
    expect(requested).toEqual([])
    const editor = await api.loginAs('editor')
    expect((await app.request(url, { method: 'DELETE', headers: editor.headers })).status).toBe(403)
  })

  it('черновик может вести на неопубликованную страницу — публикация с ним 409', async () => {
    await app.request(`/api/sites/${demoSiteId}/pages`, {
      method: 'POST',
      headers: json(owner.headers),
      body: JSON.stringify({ slug: 'akcii', title: 'Акции', template: 'hero' }),
    })
    await ok(await save({ menu: [...menu, { label: 'Акции', page: 'akcii' }] }))
    const res = await publish()
    expect(res.status).toBe(409)
    const problem = await problemOf(res)
    expect(problem.message).toBe(
      'Шапку не опубликовать. Пункт меню «Акции»: страница «Акции» не опубликована — опубликуйте её или выберите другую',
    )
    expect(problem.issues.map((issue) => issue.path)).toEqual(['menu.2.page'])
    expect(requested).toEqual([])
    expect(await snapshotHeader()).toBeNull()
  })

  it('страницу из меню или кнопки шапки не удалить — 409 с тем, что на неё ведёт', async () => {
    const pageUrl = `/api/sites/${demoSiteId}/pages/akcii`
    await app.request(`/api/sites/${demoSiteId}/pages`, {
      method: 'POST',
      headers: json(owner.headers),
      body: JSON.stringify({ slug: 'akcii', title: 'Акции', template: 'hero' }),
    })
    await ok(
      await save({
        menu: [{ label: 'Акции', page: 'akcii' }],
        button: { label: 'Скидка', page: 'akcii' },
      }),
    )
    const res = await app.request(pageUrl, { method: 'DELETE', headers: owner.headers })
    expect(res.status).toBe(409)
    expect((await problemOf(res)).message).toBe(
      'Страница в шапке сайта: пункт меню «Акции», кнопка «Скидка». Уберите её оттуда в разделе «Шапка и подвал» и опубликуйте шапку, тогда страницу можно будет удалить',
    )
    // Убрали из шапки — удаляется
    await ok(await save({ menu }))
    expect((await app.request(pageUrl, { method: 'DELETE', headers: owner.headers })).status).toBe(
      204,
    )
  })

  it('блок, которого нет на опубликованной странице, — 409 с путём до пункта', async () => {
    await app.request(`/api/sites/${demoSiteId}/pages/akcii`, {
      method: 'PUT',
      headers: json(owner.headers),
      body: JSON.stringify({ title: 'Акции', content: { blocks: [] } }),
    })
    await app.request(`/api/sites/${demoSiteId}/pages/akcii/publish`, {
      method: 'POST',
      headers: owner.headers,
    })
    await db
      .update(pages)
      .set({
        draft: { blocks: [{ id: 'sale', type: 'text', props: { body: 'Скидки' } }] } as never,
      })
      .where(eq(pages.slug, 'akcii'))
    await ok(await save({ menu: [{ label: 'Скидки', page: 'akcii', block: 'sale' }] }))
    const res = await publish()
    expect(res.status).toBe(409)
    expect((await problemOf(res)).issues).toEqual([
      {
        path: 'menu.0.block',
        message:
          'Пункт меню «Скидки»: блока #sale нет на опубликованной странице «Акции» — опубликуйте страницу или выберите другой блок',
      },
    ])
  })

  it('страницы нет вовсе — сохранить нельзя: 409 с путём', async () => {
    const res = await save({ button: { label: 'Блог', page: 'blog' } })
    expect(res.status).toBe(409)
    expect((await problemOf(res)).issues).toEqual([
      { path: 'button.page', message: 'Кнопка «Блог»: страницы /blog/ нет — выберите другую' },
    ])
  })

  it('схема: внешняя ссылка, 9 пунктов и сборка без липкости — 400', async () => {
    const outside = await save({ menu: [{ label: 'ВК', page: 'https://vk.com' }] })
    expect(outside.status).toBe(400)
    const nine = Array.from({ length: 9 }, () => ({ label: 'Главная', page: 'index' }))
    expect((await save({ menu: nine })).status).toBe(400)
    const res = await save({ sticky: false, condense: true })
    expect(res.status).toBe(400)
    expect((await problemOf(res)).issues.map((issue) => issue.path)).toEqual(['condense'])
  })
})

describe('логотип', () => {
  async function uploadLogo() {
    const body = new FormData()
    body.append(
      'file',
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40"/></svg>',
        ],
        'logo.svg',
        { type: 'image/svg+xml' },
      ),
    )
    const res = await app.request(`/api/sites/${demoSiteId}/media`, {
      method: 'POST',
      headers: owner.headers,
      body,
    })
    expect(res.status, await res.clone().text()).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  it('SVG из медиатеки сайта можно; в снимке — его варианты; удалить его нельзя', async () => {
    const logo = await uploadLogo()
    await ok(await save({ logo }))
    await ok(await publish())
    const snapshot = await app.request(`/api/sites/${demoSiteId}/snapshot`)
    const { media } = (await snapshot.json()) as { media: Record<string, unknown> }
    expect(media[logo]).toBeDefined()
    const res = await app.request(`/api/sites/${demoSiteId}/media/${logo}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(res.status).toBe(409)
    expect((await problemOf(res)).message).toMatch(/логотип шапки сайта/)
  })

  it('логотип «Текст» сохраняется без картинки — файл не держится и удаляется', async () => {
    const logo = await uploadLogo()
    await ok(await save({ logo }))
    const saved = await ok(await save({ brand: 'text', logo, logoMark: 'Ре' }))
    expect(saved.draft).toMatchObject({ brand: 'text', logo: null, logoMark: 'Ре' })
    const res = await app.request(`/api/sites/${demoSiteId}/media/${logo}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(res.status, await res.clone().text()).toBe(204)
  })

  it('картинки нет в медиатеке — 409 у поля logo', async () => {
    const res = await save({ logo: 'b0000000-0000-4000-8000-00000000abcd' })
    expect(res.status).toBe(409)
    expect((await problemOf(res)).issues.map((issue) => issue.path)).toEqual(['logo'])
  })
})

describe('права', () => {
  it('меняют владелец и администратор сайта; редактор — только читает', async () => {
    const admin = await api.loginAs('client')
    expect((await save({ menu }, admin.headers)).status).toBe(200)
    expect((await publish(admin.headers)).status).toBe(200)

    const editor = await api.loginAs('editor')
    expect((await read(editor.headers)).status).toBe(200)
    expect((await save({ menu }, editor.headers)).status).toBe(403)
    expect((await publish(editor.headers)).status).toBe(403)
  })

  it('токен API шапку читает, но не меняет', async () => {
    const { token } = await api.createToken()
    const bearer = { authorization: `Bearer ${token}` }
    expect((await read(bearer)).status).toBe(200)
    const res = await save({ menu }, bearer)
    expect(res.status).toBe(403)
    expect((await problemOf(res)).message).toBe(
      'Шапку, меню и подвал сайта меняют в админке: токену API они доступны только для чтения',
    )
    expect((await publish(bearer)).status).toBe(403)
  })

  it('без входа — 401, чужой сайт — 404', async () => {
    expect((await app.request(url)).status).toBe(401)
    const other = await api.createSite()
    const editor = await api.loginAs('editor')
    const res = await app.request(`/api/sites/${other}/header`, { headers: editor.headers })
    expect(res.status).toBe(404)
  })
})

describe('вид шапки — владельцу, тексты и ссылки — администратору сайта', () => {
  it('вид сверяется в самом сохранении: изменённый вид при запрете — отказ, в базе прежний черновик', async () => {
    const before = await ok(await save({ menu }))
    const changed = { ...before.draft, layout: 'minimal' as const }
    const result = await headerRepo(db).saveDraft(demoSiteId, changed, true)
    expect(result).toBe('look')
    expect((await ok(await read())).draft.layout).toBe(before.draft.layout)
    // Тексты при прежнем виде проходят и под запретом на вид
    const texts = { ...before.draft, logoText: 'Новый' }
    expect(await headerRepo(db).saveDraft(demoSiteId, texts, true)).toMatchObject({
      draft: { logoText: 'Новый' },
    })
  })

  it('администратор меняет подписи, логотип-текст и пункты; вид — 403', async () => {
    const admin = await api.loginAs('client', demoSiteId)
    const texts = {
      menu: [
        {
          label: 'Почему мы',
          mobileLabel: 'Почему выбирают нас',
          page: 'index',
          block: 'benefits',
        },
        { label: 'Telegram', url: 'https://t.me/remont' },
      ],
      button: { label: 'Рассчитать', mobileLabel: 'Расчёт', page: 'index', block: 'contact' },
      brand: 'text',
      logoMark: 'Р',
      logoText: 'Ремонт\nу Ивана',
      phone: true,
    }
    const saved = await save(texts, admin.headers)
    expect(saved.status, await saved.clone().text()).toBe(200)
    for (const look of [
      { layout: 'minimal' },
      { sticky: false },
      { overlay: true },
      { look: { mobileButton: 'row' } },
      { look: { divider: false } },
    ]) {
      const res = await save({ ...texts, ...look }, admin.headers)
      expect(res.status, JSON.stringify(look)).toBe(403)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(LOOK_LOCKED_CODE)
    }
    // Чужой вид — 403 раньше проверок 409: определения шапки с таким ключом нет
    const missing = await save(
      { ...texts, custom: { key: 'no-such-header', props: {} } },
      admin.headers,
    )
    expect(missing.status).toBe(403)
    // Владелец меняет вид, администратор дальше правит тексты при этом виде
    await ok(await save({ ...texts, look: { mobileButton: 'row', buttonShape: 'pill' } }))
    const again = await save(
      { ...texts, logoText: 'Ремонт', look: { mobileButton: 'row', buttonShape: 'pill' } },
      admin.headers,
    )
    expect(again.status).toBe(200)
  })

  it('внешний пункт публикуется без проверки страниц и идёт в снимок как есть', async () => {
    await ok(
      await save({
        menu: [{ label: 'Telegram', url: 'https://t.me/remont', newTab: false }],
        button: { label: 'Позвонить', url: 'tel:+73420000000' },
      }),
    )
    await ok(await publish())
    const header = await snapshotHeader()
    expect(header?.menu).toEqual([
      { label: 'Telegram', mobileLabel: '', url: 'https://t.me/remont', newTab: false },
    ])
    expect(header?.button).toMatchObject({ url: 'tel:+73420000000' })
  })

  it('«Открывать в окне» у кнопки и пункта доживает до ответа, черновика и снимка', async () => {
    const button = { label: 'Записаться', page: 'index', block: 'contact', window: true }
    const saved = await ok(await save({ menu: [{ ...menu[0], window: true }, menu[1]], button }))
    expect(saved.draft.button).toMatchObject({ window: true })
    expect(saved.draft.menu[0]).toMatchObject({ window: true })
    expect((await ok(await read())).draft.button).toMatchObject({ window: true })
    await ok(await publish())
    const header = await snapshotHeader()
    expect(header?.button).toMatchObject({ window: true })
    expect(header?.menu[0]).toMatchObject({ window: true })
    expect(header?.menu[1]).not.toHaveProperty('window')
  })

  it('кривая внешняя ссылка — 400 с ошибкой у поля', async () => {
    const res = await save({ menu: [{ label: 'X', url: 'javascript:alert(1)' }] })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('menu.0.url')
  })
})
