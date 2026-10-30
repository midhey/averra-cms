import { type CustomBlockDraftInput, demoSiteId } from '@averra/schema'
import { unzipSync } from 'fflate'
import sharp from 'sharp'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { customBlocks } from '../../db/schema'
import type { SitePublisher } from '../../publish/queue'
import { createTestApi } from '../../testing'

// Свои блоки: определение (черновик, публикация, история), права, страницы со своими блоками
// (сохранение, публикация, несовместимые данные), снимок рендерера, перенос и выгрузка сайта

type Headers = Record<string, string>
type Issue = { path: string; message: string }

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
const { token } = await api.createToken()
const bearer = { authorization: `Bearer ${token}` }
const granted = await api.createToken(demoSiteId, 'mcp с правом', { blocksDraft: true })
const withGrant = { authorization: `Bearer ${granted.token}` }

const base = `/api/sites/${demoSiteId}/custom-blocks`
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })
const send = (method: string, path: string, body?: unknown, headers: Headers = owner.headers) =>
  app.request(`${base}${path}`, {
    method,
    headers: body === undefined ? headers : json(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const savePage = (slug: string, blocks: unknown[], headers: Headers = owner.headers) =>
  app.request(`/api/sites/${demoSiteId}/pages/${slug}`, {
    method: 'PUT',
    headers: json(headers),
    body: JSON.stringify({ title: 'Страница', content: { blocks } }),
  })
const publishPage = (slug: string, headers: Headers = owner.headers) =>
  app.request(`/api/sites/${demoSiteId}/pages/${slug}/publish`, { method: 'POST', headers })

/** Публикация того черновика, что сейчас в базе: так делает админка, показав его человеку */
async function publish(key: string, headers: Headers = owner.headers) {
  const current = await send('GET', `/${key}`)
  const { draft } = (await current.json()) as { draft: unknown }
  return send('POST', `/${key}/publish`, { draft }, headers)
}

const issuesOf = async (res: Response) =>
  ((await res.json()) as { error: { issues: Issue[] } }).error.issues

async function ok<T>(res: Response, status = 200) {
  expect(res.status, await res.clone().text()).toBe(status)
  return (await res.json()) as T
}

/** Пример из документации: «Тарифы с наклейкой» */
const tariffs = (input: Partial<CustomBlockDraftInput> = {}): CustomBlockDraftInput => ({
  key: 'tariffs',
  title: 'Тарифы с наклейкой',
  description: 'Тарифы карточками, у каждого — наклейка',
  category: 'sales',
  fields: [
    { type: 'text', name: 'title', label: 'Заголовок', required: true },
    {
      type: 'repeater',
      name: 'plans',
      label: 'Тарифы',
      min: 1,
      fields: [
        { type: 'text', name: 'name', label: 'Название', required: true },
        { type: 'text', name: 'sticker', label: 'Наклейка' },
      ],
    },
  ],
  template:
    '<h2 class="title">{{ title }}</h2>{% for plan in plans %}<p>{{ plan.name }} {{ plan.sticker }}</p>{% endfor %}',
  css: '.title { color: var(--color-accent) }',
  example: { title: 'Тарифы', plans: [{ name: 'Базовый', sticker: 'Хит' }] },
  ...input,
})

async function createAndPublish(input: Partial<CustomBlockDraftInput> = {}) {
  const draft = tariffs(input)
  await ok(await send('POST', '', { key: draft.key, title: draft.title }), 201)
  await ok(await send('PUT', `/${draft.key}`, draft))
  return ok<{ affected: unknown[] }>(await publish(draft.key))
}

const block = (props: Record<string, unknown>) => ({
  id: 'tariffs-1',
  type: 'custom:tariffs',
  props,
})

beforeEach(async () => {
  await db.delete(customBlocks)
  // Страницы со своими блоками мешали бы удалению — тесты ставят их заново
  await savePage('index', [{ id: 'hero', type: 'hero', props: { title: 'Привет' } }])
  requested.length = 0
})

describe('определение: черновик, публикация, история', () => {
  it('создание — заготовка, которая проходит проверку; ключ уникален', async () => {
    const created = await ok<{ draft: { template: string }; problems: unknown[] }>(
      await send('POST', '', { key: 'promo', title: 'Промо' }),
      201,
    )
    expect(created.draft.template).toContain('{{ title }}')
    expect(created.problems).toEqual([])
    expect((await send('POST', '', { key: 'promo', title: 'Ещё' })).status).toBe(409)
    expect((await send('POST', '', { key: 'export', title: 'Нельзя' })).status).toBe(400)
  })

  it('черновик сохраняется с ошибками шаблона, публикация — только без них, со строкой', async () => {
    await ok(await send('POST', '', { key: 'tariffs', title: 'Тарифы' }), 201)
    const bad = tariffs({ template: '<h2>{{ title }}</h2>\n<script>alert(1)</script>' })
    const saved = await ok<{ problems: { line?: number; level: string }[] }>(
      await send('PUT', '/tariffs', bad),
    )
    expect(saved.problems).toContainEqual(expect.objectContaining({ line: 2, level: 'error' }))
    const res = await publish('tariffs')
    expect(res.status).toBe(400)
    expect((await issuesOf(res))[0]).toEqual({
      path: 'template',
      message: expect.stringMatching(/^Строка 2: <script> запрещён/),
    })
  })

  it('структура полей проверяется всегда, ключ не меняется', async () => {
    await ok(await send('POST', '', { key: 'tariffs', title: 'Тарифы' }), 201)
    const twice = tariffs({
      fields: [
        { type: 'text', name: 'a', label: 'A' },
        { type: 'text', name: 'a', label: 'B' },
      ],
    })
    expect((await issuesOf(await send('PUT', '/tariffs', twice)))[0]?.path).toBe('fields.1.name')
    expect((await send('PUT', '/tariffs', tariffs({ key: 'other' }))).status).toBe(400)
  })

  it('публикация пишет версию, пересобирает сайт; возврат версии — в черновик', async () => {
    await createAndPublish()
    expect(requested).toEqual([demoSiteId])
    await ok(await send('PUT', '/tariffs', tariffs({ title: 'Новое название' })))
    await ok(await publish('tariffs'))
    const revisions = await ok<{ id: string; version: number }[]>(
      await send('GET', '/tariffs/revisions'),
    )
    expect(revisions.map((revision) => revision.version)).toEqual([2, 1])
    const first = revisions[1]
    const restored = await ok<{ draft: { title: string }; unpublished: boolean }>(
      await send('POST', `/tariffs/revisions/${first?.id}/restore`),
    )
    expect(restored.draft.title).toBe('Тарифы с наклейкой')
    expect(restored.unpublished).toBe(true)
  })

  it('CSS: @import и чужой url() не публикуются, картинка медиатеки — да', async () => {
    await ok(await send('POST', '', { key: 'tariffs', title: 'Тарифы' }), 201)
    await ok(
      await send('PUT', '/tariffs', tariffs({ css: '@import url(https://evil.example/a.css);' })),
    )
    expect((await issuesOf(await publish('tariffs')))[0]?.path).toBe('css')
    const unknown = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
    await ok(
      await send('PUT', '/tariffs', tariffs({ css: `.a { background: url(media:${unknown}) }` })),
    )
    expect((await issuesOf(await publish('tariffs')))[0]?.message).toMatch(/нет в медиатеке/)
    const mediaId = await uploadImage()
    await ok(
      await send('PUT', '/tariffs', tariffs({ css: `.a { background: url(media:${mediaId}) }` })),
    )
    await ok(await publish('tariffs'))
    // Картинку в CSS своего блока удалить нельзя
    const del = await app.request(`/api/sites/${demoSiteId}/media/${mediaId}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(del.status).toBe(409)
  })
})

describe('права', () => {
  it('редактор, клиент и токен видят только опубликованные определения', async () => {
    await createAndPublish()
    await ok(await send('POST', '', { key: 'draft-only', title: 'Черновик' }), 201)
    for (const headers of [editor.headers, client.headers, bearer]) {
      const { blocks } = await ok<{ blocks: { key: string; draft: unknown }[] }>(
        await send('GET', '', undefined, headers),
      )
      expect(blocks.map((item) => item.key)).toEqual(['tariffs'])
      expect(blocks[0]?.draft).toBeNull()
    }
    const all = await ok<{ blocks: unknown[] }>(await send('GET', ''))
    expect(all.blocks).toHaveLength(2)
  })

  it('создавать, менять, публиковать и удалять — только владелец; токену — с понятным отказом', async () => {
    await createAndPublish()
    for (const headers of [editor.headers, client.headers, bearer]) {
      expect((await send('POST', '', { key: 'x-block', title: 'X' }, headers)).status).toBe(403)
      expect((await send('PUT', '/tariffs', tariffs(), headers)).status).toBe(403)
      expect((await publish('tariffs', headers)).status).toBe(403)
      expect((await send('DELETE', '/tariffs', undefined, headers)).status).toBe(403)
      expect((await send('GET', '/export', undefined, headers)).status).toBe(403)
    }
    const res = await send('PUT', '/tariffs', tariffs(), bearer)
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /pnpm token:grant/,
    )
  })

  it('редактор и клиент заполняют свой блок на странице', async () => {
    await createAndPublish()
    const props = { title: 'Цены', plans: [{ name: 'Старт' }] }
    expect((await savePage('index', [block(props)], editor.headers)).status).toBe(200)
    expect((await savePage('index', [block(props)], client.headers)).status).toBe(200)
  })
})

describe('токен с правом на черновики (MCP)', () => {
  it('читает черновики, создаёт блок и сохраняет черновик; опубликованное не меняется', async () => {
    await createAndPublish()
    const list = await ok<{ blocks: { key: string; draft: unknown }[] }>(
      await send('GET', '', undefined, withGrant),
    )
    expect(list.blocks[0]?.draft).not.toBeNull()
    expect((await send('GET', '/tariffs', undefined, withGrant)).status).toBe(200)

    await ok(await send('POST', '', { key: 'mcp-block', title: 'От нейронки' }, withGrant), 201)
    const changed = tariffs({ title: 'Тарифы v2' })
    const saved = await ok<{ unpublished: boolean; published: { title: string } }>(
      await send('PUT', '/tariffs', changed, withGrant),
    )
    expect(saved.unpublished).toBe(true)
    // Опубликованное определение осталось прежним: оно на сайте, пока человек не опубликует
    expect(saved.published.title).toBe('Тарифы с наклейкой')
  })

  it('владелец публикует только тот черновик, что видел: правка токена после — 409', async () => {
    await createAndPublish()
    const seen = (await ok<{ draft: unknown }>(await send('GET', '/tariffs'))).draft
    const sneaky = tariffs({ template: '<a href="https://phishing.example/login">Войти</a>' })
    await ok(await send('PUT', '/tariffs', sneaky, withGrant))
    const res = await send('POST', '/tariffs/publish', { draft: seen })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /Черновик изменили/,
    )
    const after = await ok<{ published: { template: string } }>(await send('GET', '/tariffs'))
    expect(after.published.template).not.toContain('phishing')
    // Перечитал черновик — публикует уже его, осознанно
    expect((await publish('tariffs')).status).toBe(200)
  })

  it('публикация без черновика, который видел человек, — ошибка проверки', async () => {
    await createAndPublish()
    expect((await send('POST', '/tariffs/publish', {})).status).toBe(400)
  })

  it('публиковать, удалять, откатывать, выгружать и загружать токен не может даже с правом', async () => {
    await createAndPublish()
    const revisions = await ok<{ id: string }[]>(await send('GET', '/tariffs/revisions'))
    for (const [method, path] of [
      ['POST', '/tariffs/publish'],
      ['DELETE', '/tariffs'],
      ['GET', '/tariffs/revisions'],
      ['POST', `/tariffs/revisions/${revisions[0]?.id}/restore`],
      ['GET', '/export'],
      ['POST', '/import'],
    ] as const) {
      const res = await send(method, path, method === 'POST' ? {} : undefined, withGrant)
      expect(res.status, `${method} ${path}`).toBe(403)
    }
  })

  it('право выключается сразу: тот же токен получает отказ', async () => {
    const own = await api.createToken(demoSiteId, 'временный', { blocksDraft: true })
    const headers = { authorization: `Bearer ${own.token}` }
    expect((await send('POST', '', { key: 'tmp-block', title: 'Врем' }, headers)).status).toBe(201)
    await api.setTokenBlocksDraft(own.id, false)
    expect((await send('GET', '/tmp-block', undefined, headers)).status).toBe(403)
    // Опубликованное токен читает и без права
    expect((await send('GET', '', undefined, headers)).status).toBe(200)
  })

  it('токен без права: черновики и проверка закрыты с подсказкой', async () => {
    const res = await send('POST', '/check', { definition: tariffs() }, bearer)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /token:grant/,
    )
  })

  it('проверка: HTML на примере и на своих данных, ошибки — в замечаниях, а не 400', async () => {
    const good = await ok<{ problems: unknown[]; html: string; css: string }>(
      await send('POST', '/check', { definition: tariffs() }, withGrant),
    )
    expect(good.problems).toEqual([])
    expect(good.html).toContain('Базовый')
    expect(good.css).toContain('--color-accent')

    const own = await ok<{ html: string }>(
      await send(
        'POST',
        '/check',
        { definition: tariffs(), data: { title: 'Мои цены', plans: [{ name: '<b>Про</b>' }] } },
        withGrant,
      ),
    )
    expect(own.html).toContain('Мои цены')
    expect(own.html).toContain('&lt;b&gt;Про')

    const broken = await ok<{ problems: { level: string; part: string; line?: number }[] }>(
      await send(
        'POST',
        '/check',
        { definition: tariffs({ template: '<h2>{{ title }}</h2>\n<script>x</script>' }) },
        withGrant,
      ),
    )
    expect(broken.problems).toContainEqual(
      expect.objectContaining({ part: 'template', level: 'error', line: 2 }),
    )

    const wrongData = await ok<{ problems: { message: string }[]; html: unknown }>(
      await send('POST', '/check', { definition: tariffs(), data: { title: 1 } }, withGrant),
    )
    expect(wrongData.html).toBeNull()
    expect(wrongData.problems.length).toBeGreaterThan(0)
  })

  it('проверка не сохраняет определение', async () => {
    await send('POST', '/check', { definition: tariffs({ key: 'not-saved' }) }, withGrant)
    expect((await send('GET', '/not-saved')).status).toBe(404)
  })

  it('черновик, которого нет на сайте, на страницу не встанет: страницу проверяют по опубликованному', async () => {
    await ok(await send('POST', '', { key: 'tariffs', title: 'Тарифы' }, withGrant), 201)
    await ok(await send('PUT', '/tariffs', tariffs(), withGrant))
    const res = await savePage('index', [block({ title: 'Цены', plans: [{ name: 'Старт' }] })])
    expect(res.status).toBe(400)
  })

  it('картинка из медиатеки в данных проверки рисуется как на сайте', async () => {
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#cc3333' },
    })
      .png()
      .toBuffer()
    const form = new FormData()
    form.set('file', new File([new Uint8Array(png)], 'a.png', { type: 'image/png' }))
    const uploaded = await ok<{ id: string }>(
      await app.request(`/api/sites/${demoSiteId}/media`, {
        method: 'POST',
        headers: owner.headers,
        body: form,
      }),
      201,
    )
    const definition = tariffs({
      fields: [{ type: 'image', name: 'photo', label: 'Фото', required: true }],
      template: "<div class=\"p\">{{ photo | image: '50vw', 'img' }}</div>",
      css: '.p { display: block }',
      example: { photo: { mediaId: uploaded.id, alt: 'Красный квадрат' } },
    })
    const res = await ok<{ problems: unknown[]; html: string }>(
      await send('POST', '/check', { definition }, withGrant),
    )
    expect(res.problems).toEqual([])
    expect(res.html).toContain('<picture')
    expect(res.html).toContain('alt="Красный квадрат"')
  })
})

describe('свой блок на странице', () => {
  it('сохранение: поля — по опубликованному определению, умолчания, ошибка у поля', async () => {
    expect((await issuesOf(await savePage('index', [block({ title: 'x' })])))[0]?.message).toMatch(
      /нет на сайте/,
    )
    await createAndPublish()
    const bad = await savePage('index', [block({ title: '', plans: [] })])
    expect(bad.status).toBe(400)
    expect((await issuesOf(bad)).map((issue) => issue.path)).toEqual([
      'content.blocks.0.props.title',
      'content.blocks.0.props.plans',
    ])
    const saved = await ok<{ draft: { blocks: { props: unknown }[] } }>(
      await savePage('index', [block({ title: ' Цены ', plans: [{ name: 'Старт' }] })]),
    )
    expect(saved.draft.blocks[0]?.props).toEqual({ title: 'Цены', plans: [{ name: 'Старт' }] })
  })

  it('несовместимое новое определение: публикация страницы — 409 с полем, публикация блока — список страниц', async () => {
    await createAndPublish()
    await ok(await savePage('index', [block({ title: 'Цены', plans: [{ name: 'Старт' }] })]))
    await ok(await publishPage('index'))
    // Новое обязательное поле: на опубликованной главной его нет
    const fields = [
      ...(tariffs().fields ?? []),
      { type: 'text' as const, name: 'note', label: 'Сноска', required: true },
    ]
    await ok(
      await send(
        'PUT',
        '/tariffs',
        tariffs({ fields, example: { ...tariffs().example, note: 'x' } }),
      ),
    )
    const published = await ok<{ affected: { slug: string; message: string }[] }>(
      await publish('tariffs'),
    )
    expect(published.affected).toEqual([
      { slug: 'index', title: expect.any(String), message: expect.any(String) },
    ])
    const res = await publishPage('index')
    expect(res.status).toBe(409)
    expect((await issuesOf(res))[0]?.path).toBe('content.blocks.0.props.note')
  })

  it('публикация блока не путает соседний свой блок страницы с несовместимостью', async () => {
    await createAndPublish()
    const card = {
      key: 'card',
      title: 'Карточка',
      fields: [{ type: 'text' as const, name: 'name', label: 'Имя', required: true }],
      template: '<p>{{ name }}</p>',
      example: { name: 'Пример' },
    }
    const published = await createAndPublish(card)
    expect(published.affected).toEqual([])
    await ok(
      await savePage('index', [
        block({ title: 'Цены', plans: [{ name: 'Старт' }] }),
        { id: 'card-1', type: 'custom:card', props: { name: 'Аня' } },
      ]),
    )
    await ok(await publishPage('index'))
    // Совместимая публикация «Карточки»: «Тарифы» на той же странице — не повод для списка
    expect((await ok<{ affected: unknown[] }>(await publish('card'))).affected).toEqual([])
    // Несовместимая: причина — новое поле «Карточки», а не соседний блок
    const fields = [
      ...card.fields,
      { type: 'text' as const, name: 'must', label: 'Обязательное', required: true },
    ]
    await ok(
      await send('PUT', '/card', tariffs({ ...card, fields, example: { name: 'x', must: 'y' } })),
    )
    const after = await ok<{ affected: { slug: string; message: string }[] }>(await publish('card'))
    expect(after.affected).toHaveLength(1)
    expect(after.affected[0]?.message).not.toMatch(/нет на сайте/)
    const res = await publishPage('index')
    expect(res.status).toBe(409)
    expect((await issuesOf(res))[0]?.path).toBe('content.blocks.1.props.must')
  })

  it('снимок рендерера несёт только опубликованные определения', async () => {
    await createAndPublish()
    await ok(await send('POST', '', { key: 'draft-only', title: 'Черновик' }), 201)
    const snapshot = await ok<{ customBlocks: Record<string, { template: string }> }>(
      await app.request(`/api/sites/${demoSiteId}/snapshot`),
    )
    expect(Object.keys(snapshot.customBlocks)).toEqual(['tariffs'])
  })

  it('блок на странице не удалить', async () => {
    await createAndPublish()
    await ok(await savePage('index', [block({ title: 'Цены', plans: [{ name: 'Старт' }] })]))
    const res = await send('DELETE', '/tariffs')
    expect(res.status).toBe(409)
    await ok(await savePage('index', []))
    await ok(await publishPage('index'))
    expect((await send('DELETE', '/tariffs')).status).toBe(204)
  })
})

describe('выгрузка всех данных сайта', () => {
  it('site.json несёт определения: опубликованное и только черновик', async () => {
    await createAndPublish()
    await ok(await send('POST', '', { key: 'draft-only', title: 'Только черновик' }), 201)
    const res = await app.request(`/api/sites/${demoSiteId}/export/data`, {
      headers: owner.headers,
    })
    expect(res.status).toBe(200)
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    const site = JSON.parse(new TextDecoder().decode(files['site.json']))
    const byKey = Object.fromEntries(
      site.customBlocks.map((item: { key: string }) => [item.key, item]),
    )
    expect(Object.keys(byKey).sort()).toEqual(['draft-only', 'tariffs'])
    expect(byKey.tariffs).toMatchObject({
      draft: { title: 'Тарифы с наклейкой' },
      published: { title: 'Тарифы с наклейкой' },
      publishedAt: expect.any(String),
    })
    expect(byKey['draft-only']).toMatchObject({ published: null, publishedAt: null })
  })
})

describe('перенос между установками', () => {
  it('выгрузка — файл с черновиками; загрузка с конфликтом — заменить, переименовать, пропустить', async () => {
    await createAndPublish()
    const exported = await send('GET', '/export')
    expect(exported.headers.get('content-disposition')).toMatch(
      /attachment; filename="custom-blocks-/,
    )
    const file = await ok<{ format: string; blocks: { key: string; title: string }[] }>(exported)
    expect(file.format).toBe('averra.custom-blocks')
    expect(file.blocks.map((item) => item.key)).toEqual(['tariffs'])

    const incoming = { ...file.blocks[0], title: 'Из файла' }
    const conflict = await send('POST', '/import', { blocks: [incoming] })
    expect(conflict.status).toBe(409)
    expect((await issuesOf(conflict))[0]?.path).toBe('resolutions.tariffs')

    const renamed = await ok<{ created: string[] }>(
      await send('POST', '/import', {
        blocks: [incoming],
        resolutions: { tariffs: { rename: 'tariffs-2' } },
      }),
    )
    expect(renamed.created).toEqual(['tariffs-2'])
    // Новое имя занято — снова конфликт, и ничего не записано
    expect(
      (
        await send('POST', '/import', {
          blocks: [incoming],
          resolutions: { tariffs: { rename: 'tariffs-2' } },
        })
      ).status,
    ).toBe(409)

    await ok(
      await send('POST', '/import', { blocks: [incoming], resolutions: { tariffs: 'replace' } }),
    )
    const replaced = await ok<{ draft: { title: string }; published: { title: string } }>(
      await send('GET', '/tariffs'),
    )
    expect(replaced.draft.title).toBe('Из файла')
    expect(replaced.published.title).toBe('Тарифы с наклейкой')

    const skipped = await ok<{ skipped: string[] }>(
      await send('POST', '/import', { blocks: [incoming], resolutions: { tariffs: 'skip' } }),
    )
    expect(skipped.skipped).toEqual(['tariffs'])
  })

  it('загрузка проверяет файл схемой', async () => {
    const res = await send('POST', '/import', { blocks: [{ key: 'bad key' }] })
    expect(res.status).toBe(400)
  })
})

/** Картинка в медиатеке демо-сайта */
async function uploadImage() {
  const data = await sharp({
    create: { width: 32, height: 32, channels: 4, background: '#3b6ea8' },
  })
    .png()
    .toBuffer()
  const body = new FormData()
  body.append('file', new File([new Uint8Array(data)], 'bg.png', { type: 'image/png' }))
  const res = await app.request(`/api/sites/${demoSiteId}/media`, {
    method: 'POST',
    headers: owner.headers,
    body,
  })
  expect(res.status, await res.clone().text()).toBe(201)
  return ((await res.json()) as { id: string }).id
}
