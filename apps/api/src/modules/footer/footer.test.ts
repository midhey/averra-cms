import { defaultFooter, type Footer } from '@averra/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { leads, mailOutbox, sites } from '../../db/schema'
import { memoryMailer } from '../../mail/memory-mailer'
import type { SitePublisher } from '../../publish/queue'
import { createTestApi } from '../../testing'

// Подвал сайта: черновик (PUT), публикация (POST /publish — большому нужна опубликованная
// политика), снимок для сборки, «Убрать с сайта», права и контакты «Организации». И форма
// «Перезвоните мне»: та же механика заявок, источник — подвал, принимается только там, где форму
// видит посетитель

type Headers = Record<string, string>
type View = {
  draft: Footer
  published: Footer | null
  unpublished: boolean
  policy?: { slug: string; published: boolean }
  contacts?: { name: string; phone: string; email: string; address: string } | null
}
type Problem = { error: { code: string; message: string; issues: { path: string }[] } }

const requested: string[] = []
const publisher: SitePublisher = {
  request: async (siteId) => {
    requested.push(siteId)
  },
}
const mailer = memoryMailer()
const api = await createTestApi({ publisher, mail: mailer })
afterAll(api.close)
const { app, db } = api

const owner = await api.loginAs('owner')
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })

let siteId = ''
const url = () => `/api/sites/${siteId}/footer`
const read = (headers: Headers = owner.headers) => app.request(url(), { headers })
const save = (body: unknown, headers: Headers = owner.headers) =>
  app.request(url(), { method: 'PUT', headers: json(headers), body: JSON.stringify(body) })
const publish = (headers: Headers = owner.headers) =>
  app.request(`${url()}/publish`, { method: 'POST', headers })
const takeDown = (headers: Headers = owner.headers) =>
  app.request(url(), { method: 'DELETE', headers })

async function ok(res: Response) {
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as View
}

async function snapshotFooter() {
  const res = await app.request(`/api/sites/${siteId}/snapshot`)
  return ((await res.json()) as { site: { footer: Footer | null } }).site.footer
}

async function putPage(slug: string, content: Record<string, unknown>, title = 'Страница') {
  const res = await app.request(`/api/sites/${siteId}/pages/${slug}`, {
    method: 'PUT',
    headers: json(owner.headers),
    body: JSON.stringify({ title, content }),
  })
  expect(res.status, await res.clone().text()).toBe(200)
  const published = await app.request(`/api/sites/${siteId}/pages/${slug}/publish`, {
    method: 'POST',
    headers: owner.headers,
  })
  expect(published.status).toBe(200)
}

const hero = { id: 'hero', type: 'hero', props: { title: 'Ремонт квартир' } }

/** Политика: страница опубликована и выбрана в «Cookie и согласие» */
async function withPolicy() {
  await putPage('privacy', { blocks: [hero] }, 'Политика')
  const res = await app.request(`/api/sites/${siteId}/settings`, {
    method: 'PATCH',
    headers: json(owner.headers),
    body: JSON.stringify({ cookies: { policyPage: 'privacy' } }),
  })
  expect(res.status, await res.clone().text()).toBe(200)
}

let siteCount = 0
beforeEach(async () => {
  siteCount += 1
  siteId = await api.createSite(`Ремонт ${siteCount}`)
  await putPage('index', { blocks: [hero] }, 'Главная')
  requested.length = 0
})

describe('подвал: черновик и публикация', () => {
  it('до публикации: черновик по умолчанию, на сайте подвала нет — прежняя полоса', async () => {
    const view = await ok(await read())
    expect(view.draft).toEqual(defaultFooter)
    expect(view.published).toBeNull()
    expect(view.unpublished).toBe(true)
    expect(view.policy).toEqual({ slug: '', published: false })
    // Счётчиков нет — «Настроек cookie» в подвале не будет
    expect((view as View & { cookieSettings: boolean }).cookieSettings).toBe(false)
    expect(await snapshotFooter()).toBeNull()
  })

  it('сохранить — черновик, сайт не меняется; опубликовать — в снимке и сборка', async () => {
    const columns = await ok(await save({ layout: 'columns', about: 'Ремонт под ключ' }))
    expect(columns.draft).toMatchObject({ layout: 'columns', about: 'Ремонт под ключ' })
    expect(columns.published).toBeNull()
    expect(await snapshotFooter()).toBeNull()
    expect(requested).toEqual([])

    const published = await ok(await publish())
    expect(published.published).toMatchObject({ layout: 'columns', about: 'Ремонт под ключ' })
    expect(published.unpublished).toBe(false)
    expect(requested).toEqual([siteId])
    expect(await snapshotFooter()).toMatchObject({ layout: 'columns', tone: 'surface' })
  })

  it('схема: незнакомый вид и лишние поля — 400', async () => {
    expect((await save({ layout: 'huge' })).status).toBe(400)
    expect((await save({ phone: '+7 900' })).status).toBe(400)
  })

  it('большой без опубликованной политики — 409 с путём, с политикой — публикуется', async () => {
    await ok(await save({ layout: 'big', tone: 'accent' }))
    const refused = await publish()
    expect(refused.status).toBe(409)
    const problem = ((await refused.json()) as Problem).error
    expect(problem.message).toMatch(/^Подвал не опубликовать: .*политика конфиденциальности/)
    expect(problem.issues.map((issue) => issue.path)).toEqual(['layout'])
    expect(await snapshotFooter()).toBeNull()

    await withPolicy()
    expect((await ok(await read())).policy).toEqual({ slug: 'privacy', published: true })
    expect((await ok(await publish())).published).toMatchObject({ layout: 'big', tone: 'accent' })
  })

  it('убрать с сайта: снова прежняя полоса, настройки — черновиком, сборка', async () => {
    await ok(await save({ layout: 'columns' }))
    await ok(await publish())
    requested.length = 0
    const view = await ok(await takeDown())
    expect(view.published).toBeNull()
    expect(view.draft.layout).toBe('columns')
    expect(requested).toEqual([siteId])
    expect(await snapshotFooter()).toBeNull()
    // Подвала на сайте не было — сборка не нужна
    requested.length = 0
    await ok(await takeDown())
    expect(requested).toEqual([])
  })

  it('незнакомое поле в базе (более новая версия) — по умолчанию, сборка не падает', async () => {
    await db
      .update(sites)
      .set({ footerPublished: { layout: 'mega', tone: 'accent', future: 1 } })
      .where(eq(sites.id, siteId))
    expect(await snapshotFooter()).toEqual({ ...defaultFooter, tone: 'accent' })
  })
})

describe('подвал: права и контакты', () => {
  it('контакты «Организации» — людям, токену — нет; читать токену можно, менять — нет', async () => {
    await app.request(`/api/sites/${siteId}/settings`, {
      method: 'PATCH',
      headers: json(owner.headers),
      body: JSON.stringify({
        organization: {
          name: 'ИП Иванов',
          phone: '+7 342 000-00-00',
          email: 'info@remont.ru',
          address: { city: 'Пермь', street: 'ул. Ленина, 1' },
          socials: ['https://vk.com/remont'],
        },
      }),
    })
    expect((await ok(await read())).contacts).toMatchObject({
      name: 'ИП Иванов',
      phone: '+7 342 000-00-00',
      email: 'info@remont.ru',
      address: 'Пермь, ул. Ленина, 1',
      socials: ['https://vk.com/remont'],
    })
    const { token } = await api.createToken(siteId)
    const bearer = { authorization: `Bearer ${token}` }
    expect((await ok(await read(bearer))).contacts).toBeNull()
    expect((await save({ layout: 'columns' }, bearer)).status).toBe(403)
    expect((await publish(bearer)).status).toBe(403)
  })

  it('клиент читает, но не меняет; редактор меняет', async () => {
    const client = await api.loginAs('client', siteId)
    expect((await read(client.headers)).status).toBe(200)
    expect((await save({ layout: 'columns' }, client.headers)).status).toBe(403)
    expect((await publish(client.headers)).status).toBe(403)
    expect((await takeDown(client.headers)).status).toBe(403)
    const editor = await api.loginAs('editor', siteId)
    expect((await save({ layout: 'columns' }, editor.headers)).status).toBe(200)
  })
})

describe('форма «Перезвоните мне» в подвале', () => {
  const ORIGIN = 'https://remont.example.ru'
  let visitor = 0
  const submit = (fields: Record<string, string>, slug = 'index') => {
    visitor += 1
    return app.request(`/api/forms/${siteId}/${slug}/~footer`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html',
        origin: ORIGIN,
        referer: `${ORIGIN}/`,
        'x-forwarded-for': `10.9.${siteCount}.${visitor}`,
      },
      body: new URLSearchParams(fields).toString(),
    })
  }
  const leadsOf = () => db.select().from(leads).where(eq(leads.siteId, siteId))

  async function bigFooter() {
    await withPolicy()
    await ok(await save({ layout: 'big', callback: { title: 'Есть вопросы?' } }))
    await ok(await publish())
  }

  it('заявка с источником «подвал»: согласие с политикой, уведомление, назад к форме', async () => {
    await bigFooter()
    const res = await submit({ phone: '+7 900 123-45-67', consent: 'yes' })
    expect(res.status, await res.clone().text()).toBe(303)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/?sent=~footer#~footer-sent`)
    const [lead] = await leadsOf()
    expect(lead).toMatchObject({
      source: 'footer',
      pageSlug: 'index',
      blockId: '~footer',
      formTitle: 'Есть вопросы?',
      consentText: 'Я согласен на обработку персональных данных',
      consentPolicyUrl: '/privacy',
      pageVersion: 1,
    })
    expect(lead?.data).toEqual([
      { name: 'phone', label: 'Телефон', type: 'phone', value: '+7 900 123-45-67' },
    ])
    // Уведомление владельцу — подвал назван в нём
    const [notice] = await db
      .select({ data: mailOutbox.data })
      .from(mailOutbox)
      .where(eq(mailOutbox.siteId, siteId))
    expect(JSON.stringify(notice?.data)).toContain('Есть вопросы? (подвал сайта)')
  })

  it('с любой опубликованной страницы — обратно на неё', async () => {
    await bigFooter()
    await putPage('o-nas', { blocks: [hero] })
    const res = await submit({ phone: '+7 900 123-45-67', consent: 'yes' }, 'o-nas')
    expect(res.headers.get('location')).toBe(`${ORIGIN}/o-nas?sent=~footer#~footer-sent`)
    expect((await leadsOf())[0]?.pageSlug).toBe('o-nas')
  })

  it('без согласия или телефона — 400, ловушка — «спасибо» без заявки', async () => {
    await bigFooter()
    expect((await submit({ phone: '+7 900 123-45-67' })).status).toBe(400)
    expect((await submit({ phone: '', consent: 'yes' })).status).toBe(400)
    const trap = await submit({ phone: '+7 900 123-45-67', consent: 'yes', website: 'spam' })
    expect(trap.status).toBe(303)
    expect(await leadsOf()).toEqual([])
  })

  it('формы нет там, где её не видно: 404 и заявки нет', async () => {
    const fields = { phone: '+7 900 123-45-67', consent: 'yes' }
    // Подвал не опубликован
    expect((await submit(fields)).status).toBe(404)
    // Подвал с колонками — формы в нём нет
    await withPolicy()
    await ok(await save({ layout: 'columns' }))
    await ok(await publish())
    expect((await submit(fields)).status).toBe(404)
    // Большой, но на странице подвал скрыт
    await ok(await save({ layout: 'big' }))
    await ok(await publish())
    await putPage('promo', { blocks: [hero], hideFooter: true })
    expect((await submit(fields, 'promo')).status).toBe(404)
    // Страница не опубликована
    expect((await submit(fields, 'net-takoy')).status).toBe(404)
    // Политику сняли с публикации после подвала
    await app.request(`/api/sites/${siteId}/settings`, {
      method: 'PATCH',
      headers: json(owner.headers),
      body: JSON.stringify({ cookies: { policyPage: '' } }),
    })
    expect((await submit(fields)).status).toBe(404)
    expect(await leadsOf()).toEqual([])
  })
})
