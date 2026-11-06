import { randomUUID } from 'node:crypto'
import { demoSiteId } from '@averra/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { customBlocks, media, sites } from '../../db/schema'
import { createTestApi } from '../../testing'

// Свои шапка и подвал: свой блок с местом «шапка» или «подвал». Место задают при создании и не
// меняют, на страницу такой блок не ставится; в шапке и подвале его выбирает владелец, тексты его
// полей правит администратор сайта; публикуется только опубликованное определение с подходящими
// полями; выбранный вид не удалить; снимок и перенос знают место

type Headers = Record<string, string>
type Issue = { path: string; message: string }

const api = await createTestApi()
afterAll(api.close)
const { app, db } = api

const owner = await api.loginAs('owner')
const client = await api.loginAs('client')
const { token } = await api.createToken()
const bearer = { authorization: `Bearer ${token}` }
const granted = await api.createToken(demoSiteId, 'mcp с правом', { blocksDraft: true })
const withGrant = { authorization: `Bearer ${granted.token}` }

const site = `/api/sites/${demoSiteId}`
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })
const send = (method: string, path: string, body?: unknown, headers: Headers = owner.headers) =>
  app.request(`${site}${path}`, {
    method,
    headers: body === undefined ? headers : json(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function ok<T>(res: Response, status = 200) {
  expect(res.status, await res.clone().text()).toBe(status)
  return (await res.json()) as T
}

const issuesOf = async (res: Response) =>
  ((await res.json()) as { error: { issues: Issue[] } }).error.issues

type Definition = Record<string, unknown> & { key: string; fields: unknown[] }

/** Создать определение места и вернуть его черновик */
async function createPlace(
  key: string,
  placement: 'header' | 'footer',
  headers: Headers = owner.headers,
) {
  const created = await ok<{ draft: Definition; problems: unknown[] }>(
    await send('POST', '/custom-blocks', { key, title: `Вид ${key}`, placement }, headers),
    201,
  )
  return created
}

async function publishDefinition(key: string) {
  const { draft } = await ok<{ draft: unknown }>(await send('GET', `/custom-blocks/${key}`))
  return send('POST', `/custom-blocks/${key}/publish`, { draft })
}

const header = (custom: unknown, extra: Record<string, unknown> = {}) => ({
  menu: [{ label: 'Главная', page: 'index' }],
  custom,
  ...extra,
})

beforeEach(async () => {
  await db
    .update(sites)
    .set({ headerDraft: null, headerPublished: null, footerDraft: null, footerPublished: null })
    .where(eq(sites.id, demoSiteId))
  await db.delete(customBlocks)
})

describe('определение места', () => {
  it('создаётся заготовкой без ошибок; место не меняется; на страницу не ставится', async () => {
    const created = await createPlace('my-header', 'header')
    expect(created.draft.placement).toBe('header')
    expect(created.draft.template).toContain('<details class="menu">')
    expect(created.problems).toEqual([])
    const footer = await createPlace('my-footer', 'footer')
    expect(footer.problems).toEqual([])

    const changed = await send('PUT', '/custom-blocks/my-header', {
      ...created.draft,
      placement: 'block',
    })
    expect(changed.status).toBe(400)
    expect((await issuesOf(changed))[0]?.path).toBe('placement')

    await ok(await publishDefinition('my-header'))
    const page = await send('PUT', '/pages/index', {
      title: 'Главная',
      content: { blocks: [{ id: 'top', type: 'custom:my-header', props: {} }] },
    })
    expect(page.status).toBe(400)
    expect((await issuesOf(page))[0]?.message).toMatch(/свой вид шапки сайта, а не блок страницы/)
  })

  it('проверка рисует место на образце данных сайта, подвал — со строкой документов', async () => {
    const header = await createPlace('my-header', 'header')
    const checked = await ok<{ html: string }>(
      await send('POST', '/custom-blocks/check', { definition: header.draft }),
    )
    expect(checked.html).toContain('<span class="name">Название сайта</span>')
    expect(checked.html).toContain('href="/#services"')
    const footer = await createPlace('my-footer', 'footer')
    const footerChecked = await ok<{ html: string }>(
      await send('POST', '/custom-blocks/check', { definition: footer.draft }),
    )
    expect(footerChecked.html).toContain(
      '<div data-legal-footer=""><a href="/privacy">Политика конфиденциальности</a>',
    )
  })

  it('поля site и page в определении места заняты данными сайта', async () => {
    const { draft } = await createPlace('my-header', 'header')
    const res = await send('PUT', '/custom-blocks/my-header', {
      ...draft,
      fields: [{ type: 'text', name: 'site', label: 'Сайт' }],
    })
    expect(res.status).toBe(400)
    expect((await issuesOf(res))[0]).toEqual({
      path: 'fields.0.name',
      message: 'Ключ «site» в шаблоне шапки и подвала занят данными сайта: выберите другой',
    })
  })
})

describe('свой вид шапки', () => {
  it('выбор: определение должно быть шапкой; публикация — только опубликованного', async () => {
    await createPlace('my-header', 'header')
    await createPlace('my-footer', 'footer')

    const missing = await send('PUT', '/header', header({ key: 'gone', props: {} }))
    expect(missing.status).toBe(409)
    expect((await issuesOf(missing))[0]?.path).toBe('custom.key')
    const wrong = await send('PUT', '/header', header({ key: 'my-footer', props: {} }))
    expect((await issuesOf(wrong))[0]?.message).toMatch(/не вид шапки/)

    // Черновик определения выбрать можно, опубликовать шапку с ним — нет
    await ok(await send('PUT', '/header', header({ key: 'my-header', props: {} })))
    const early = await send('POST', '/header/publish')
    expect(early.status).toBe(409)
    expect((await issuesOf(early))[0]?.path).toBe('custom.key')

    await ok(await publishDefinition('my-header'))
    await ok(await send('POST', '/header/publish'))
    const snapshot = await ok<{
      site: { header: { custom: unknown } }
      customBlocks: Record<string, { placement?: string }>
    }>(await app.request(`${site}/snapshot`))
    expect(snapshot.site.header.custom).toEqual({ key: 'my-header', props: {} })
    expect(snapshot.customBlocks['my-header']?.placement).toBe('header')
  })

  it('поля своего вида проверяются по определению', async () => {
    await createPlace('my-header', 'header')
    await ok(await publishDefinition('my-header'))
    const long = await send(
      'PUT',
      '/header',
      header({ key: 'my-header', props: { tagline: 'x'.repeat(61) } }),
    )
    expect(long.status).toBe(409)
    expect((await issuesOf(long))[0]?.path).toBe('custom.props.tagline')
  })

  it('администратор сайта меняет тексты своего вида, но не сам вид; токену — нельзя', async () => {
    await createPlace('my-header', 'header')
    await createPlace('other-header', 'header')
    await ok(await publishDefinition('my-header'))
    await ok(await publishDefinition('other-header'))
    await ok(await send('PUT', '/header', header({ key: 'my-header', props: {} })))

    await ok(
      await send(
        'PUT',
        '/header',
        header({ key: 'my-header', props: { tagline: 'с 2010 года' } }),
        client.headers,
      ),
    )
    const look = await send(
      'PUT',
      '/header',
      header({ key: 'other-header', props: {} }),
      client.headers,
    )
    expect(look.status).toBe(403)
    const standard = await send('PUT', '/header', header(null), client.headers)
    expect(standard.status).toBe(403)

    expect((await send('PUT', '/header', header(null), bearer)).status).toBe(403)
    expect((await send('PUT', '/header', header(null), withGrant)).status).toBe(403)
  })

  it('токен с правом пишет черновик определения места, но не публикует его', async () => {
    await createPlace('ai-header', 'header', withGrant)
    const res = await send(
      'POST',
      '/custom-blocks/ai-header/publish',
      {
        draft: (await ok<{ draft: unknown }>(await send('GET', '/custom-blocks/ai-header'))).draft,
      },
      withGrant,
    )
    expect(res.status).toBe(403)
  })

  it('выбранный вид не удалить; откат на стандартную шапку — и удалить можно', async () => {
    await createPlace('my-header', 'header')
    await ok(await publishDefinition('my-header'))
    await ok(await send('PUT', '/header', header({ key: 'my-header', props: {} })))
    await ok(await send('POST', '/header/publish'))

    const blocked = await send('DELETE', '/custom-blocks/my-header')
    expect(blocked.status).toBe(409)
    expect((await issuesOf(blocked)).map((issue) => issue.message)).toEqual([
      'шапка сайта — черновик и сайт',
    ])

    await ok(await send('PUT', '/header', header(null)))
    expect((await send('DELETE', '/custom-blocks/my-header')).status).toBe(409)
    await ok(await send('POST', '/header/publish'))
    expect((await send('DELETE', '/custom-blocks/my-header')).status).toBe(204)
  })

  it('поля определения поменялись — публикация называет шапку', async () => {
    const { draft } = await createPlace('my-header', 'header')
    await ok(await publishDefinition('my-header'))
    await ok(await send('PUT', '/header', header({ key: 'my-header', props: { tagline: 'Да' } })))
    await ok(await send('POST', '/header/publish'))
    await ok(
      await send('PUT', '/custom-blocks/my-header', {
        ...draft,
        fields: [{ type: 'number', name: 'tagline', label: 'Число' }],
        template: '<p>{{ tagline }}</p>',
      }),
    )
    const published = await ok<{ places: { place: string; message: string }[] }>(
      await publishDefinition('my-header'),
    )
    expect(published.places).toEqual([
      { place: 'header', field: 'tagline', message: expect.any(String) },
    ])
  })
})

describe('свой вид подвала', () => {
  it('выбирается и публикуется так же, как у шапки', async () => {
    await createPlace('my-footer', 'footer')
    await ok(
      await send('PUT', '/footer', { custom: { key: 'my-footer', props: { note: 'Привет' } } }),
    )
    expect((await send('POST', '/footer/publish')).status).toBe(409)
    await ok(await publishDefinition('my-footer'))
    await ok(await send('POST', '/footer/publish'))
    const look = await send('PUT', '/footer', { custom: null }, client.headers)
    expect(look.status).toBe(403)
  })
})

describe('проверки своего вида', () => {
  it('подвал: несуществующий вид и вид шапки не сохранить', async () => {
    await createPlace('my-header', 'header')
    const missing = await send('PUT', '/footer', { custom: { key: 'nope', props: {} } })
    expect(missing.status).toBe(409)
    expect((await issuesOf(missing))[0]?.path).toBe('custom.key')
    const wrong = await send('PUT', '/footer', { custom: { key: 'my-header', props: {} } })
    expect(wrong.status).toBe(409)
    expect((await issuesOf(wrong))[0]?.message).toMatch(/не вид подвала/)
  })

  /** Определение подвала с картинкой в полях */
  async function footerWithImage() {
    const { draft } = await createPlace('my-footer', 'footer')
    await ok(
      await send('PUT', '/custom-blocks/my-footer', {
        ...draft,
        fields: [{ type: 'image', name: 'badge', label: 'Значок' }],
        template: '<p class="badge">{% if badge %}{{ badge | image: \'100px\' }}{% endif %}</p>',
      }),
    )
    await ok(await publishDefinition('my-footer'))
  }

  it('картинка полей — только из медиатеки сайта: при сохранении и публикации', async () => {
    await footerWithImage()
    const badge = { mediaId: randomUUID(), alt: 'Значок' }
    const saved = await send('PUT', '/footer', { custom: { key: 'my-footer', props: { badge } } })
    expect(saved.status).toBe(409)
    expect(await issuesOf(saved)).toEqual([
      {
        path: 'custom.props.badge.mediaId',
        message: 'Картинки нет в медиатеке сайта: выберите другую',
      },
    ])
    // Черновик, записанный в обход проверки (картинку удалили потом), не публикуется
    await db
      .update(sites)
      .set({ footerDraft: { custom: { key: 'my-footer', props: { badge } } } })
      .where(eq(sites.id, demoSiteId))
    const published = await send('POST', '/footer/publish')
    expect(published.status).toBe(409)
    expect((await issuesOf(published)).map((issue) => issue.path)).toContain(
      'custom.props.badge.mediaId',
    )
  })

  it('картинку из полей своего вида не удалить из медиатеки', async () => {
    await footerWithImage()
    const mediaId = randomUUID()
    await db.insert(media).values({
      id: mediaId,
      siteId: demoSiteId,
      originalName: 'badge.png',
      mimeType: 'image/png',
      width: 10,
      height: 10,
      size: 10,
      variants: [{ format: 'webp', width: 10, height: 10, size: 3, file: '10.webp' }],
      originalFile: 'original.png',
    })
    const badge = { mediaId, alt: 'Значок' }
    await ok(await send('PUT', '/footer', { custom: { key: 'my-footer', props: { badge } } }))
    const blocked = await send('DELETE', `/media/${mediaId}`)
    expect(blocked.status).toBe(409)
    expect(((await blocked.json()) as { error: { message: string } }).error.message).toMatch(
      /в полях своего вида шапки или подвала/,
    )
    await db.delete(media).where(eq(media.id, mediaId))
  })
})

describe('перенос', () => {
  it('файл своих блоков несёт место; заменить блок другим местом нельзя', async () => {
    await createPlace('my-header', 'header')
    const file = await ok<{ blocks: { key: string; placement?: string }[] }>(
      await send('GET', '/custom-blocks/export'),
    )
    expect(file.blocks).toEqual([
      expect.objectContaining({ key: 'my-header', placement: 'header' }),
    ])

    const asBlock = { ...file.blocks[0], placement: 'block' }
    const replaced = await send('POST', '/custom-blocks/import', {
      blocks: [asBlock],
      resolutions: { 'my-header': 'replace' },
    })
    expect(replaced.status).toBe(409)
    expect((await issuesOf(replaced))[0]?.path).toBe('resolutions.my-header')

    await db.delete(customBlocks)
    await ok(await send('POST', '/custom-blocks/import', { blocks: file.blocks }))
    const back = await ok<{ draft: { placement: string } }>(
      await send('GET', '/custom-blocks/my-header'),
    )
    expect(back.draft.placement).toBe('header')
  })

  it('в базе место пишется, только если оно не «блок»: прежняя версия читает блоки как раньше', async () => {
    await createPlace('my-header', 'header')
    await ok(await send('POST', '/custom-blocks', { key: 'promo', title: 'Промо' }), 201)
    const rows = await db
      .select({ key: customBlocks.key, draft: customBlocks.draft })
      .from(customBlocks)
    const stored = Object.fromEntries(
      rows.map((row) => [row.key, row.draft as { placement?: string }]),
    )
    expect(stored['my-header']?.placement).toBe('header')
    expect(stored.promo && 'placement' in stored.promo).toBe(false)
  })
})
