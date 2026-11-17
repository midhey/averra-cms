import { defaultFooter, defaultHeader, defaultTheme } from '@averra/schema'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { customBlocks, pages, previewLinks, sites } from '../../db/schema'
import { sha256 } from '../../secrets'
import { createTestApi } from '../../testing'
import { tokensRepo } from '../tokens/repo'

const logs: string[] = []
const api = await createTestApi({ log: (message) => logs.push(message) })
afterAll(api.close)
const { app, db, demoSiteId } = api
const owner = await api.loginAs('owner')
const client = await api.loginAs('client')
const editor = await api.loginAs('editor')
const management = `/api/sites/${demoSiteId}/preview-links`
type Issued = { id: string; name: string; token: string; url: string; expiresAt: string }
const issue = async (
  headers: Record<string, string> = owner.headers,
  body: unknown = { name: 'Заказчик' },
) =>
  app.request(management, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
async function create() {
  const res = await issue()
  expect(res.status).toBe(201)
  return (await res.json()) as Issued
}
const open = (token: string, path = '') => app.request(`/api/preview/${token}/${path}`)

describe('ссылки на черновики', () => {
  it('владелец и администратор выпускают; редактор и API-токен не управляют ссылками', async () => {
    expect((await issue(client.headers)).status).toBe(201)
    const link = await create()
    const { token } = await tokensRepo(db).create({
      siteId: demoSiteId,
      name: 'MCP',
      rights: { publish: true, delete: true, blocksDraft: true, designDraft: true },
    })
    for (const headers of [editor.headers, { authorization: `Bearer ${token}` }]) {
      expect((await app.request(management, { headers })).status).toBe(403)
      expect((await issue(headers)).status).toBe(403)
      expect(
        (await app.request(`${management}/${link.id}`, { method: 'DELETE', headers })).status,
      ).toBe(403)
    }
    expect((await app.request(management)).status).toBe(401)
    expect((await open(link.token)).status).toBe(200)
  })

  it('сохраняет SHA-256, показывает секрет один раз и выдаёт срок по умолчанию 3 дня', async () => {
    const before = Date.now()
    const link = await create()
    const [stored] = await db.select().from(previewLinks).where(eq(previewLinks.id, link.id))
    expect(stored?.tokenHash).toBe(await sha256(link.token))
    expect(link.url).toContain(`/preview/${link.token}/`)
    expect(new Date(link.expiresAt).getTime() - before).toBeGreaterThanOrEqual(3 * 86_400_000)
    const listed = await (await app.request(management, { headers: owner.headers })).text()
    expect(listed).not.toContain(link.token)
    expect(listed).not.toContain('tokenHash')
    for (const days of [1, 3, 7])
      expect((await issue(owner.headers, { name: 'Срок', days })).status).toBe(201)
    for (const body of [
      { name: '' },
      { name: 'Клиент', days: 2 },
      { name: 'Клиент', extra: true },
    ]) {
      expect((await issue(owner.headers, body)).status).toBe(400)
    }
  })

  it('проверяет срок, секрет и отзыв на каждом запросе, не принимает хеш вместо токена', async () => {
    const link = await create()
    expect((await open(link.token)).status).toBe(200)
    expect((await open(await sha256(link.token))).status).toBe(404)
    const tampered = link.token.slice(0, -1) + (link.token.endsWith('0') ? '1' : '0')
    expect((await open(tampered)).status).toBe(404)
    await db
      .update(previewLinks)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(previewLinks.id, link.id))
    expect((await open(link.token)).status).toBe(404)
    const fresh = await create()
    expect(
      (
        await app.request(`${management}/${fresh.id}`, {
          method: 'DELETE',
          headers: client.headers,
        })
      ).status,
    ).toBe(204)
    const response = await open(fresh.token)
    expect(response.status).toBe(404)
    expect(await response.text()).toContain('срок истёк или доступ отозван')
    const listed = await (await app.request(management, { headers: owner.headers })).text()
    expect(listed).not.toContain(link.id)
    expect(listed).not.toContain(fresh.id)
  })

  it('не раскрывает ссылки другого сайта и не отзывает их через чужой siteId', async () => {
    const other = await api.createSite('Другой сайт')
    const link = await create()
    const wrong = `/api/sites/${other}/preview-links`
    expect((await app.request(wrong, { headers: client.headers })).status).toBe(404)
    expect(
      (await app.request(`${wrong}/${link.id}`, { method: 'DELETE', headers: owner.headers }))
        .status,
    ).toBe(404)
    expect((await open(link.token)).status).toBe(200)
  })

  it('берёт черновик своего блока без скрипта и примера, скрытые и неиспользуемые блоки не раскрывает', async () => {
    const draft = {
      key: 'preview-card',
      title: 'Карточка',
      description: 'Описание для каталога',
      fields: [{ type: 'text', name: 'title', label: 'Заголовок' }],
      template: '<h2>{{ title }}</h2>',
      css: '',
      example: { title: 'Не показывать пример' },
    }
    await db.insert(customBlocks).values([
      { siteId: demoSiteId, key: draft.key, draft, scriptDraft: 'never-run-this-script' },
      { siteId: demoSiteId, key: 'unused-card', draft: { ...draft, key: 'unused-card' } },
    ])
    await db.insert(pages).values({
      siteId: demoSiteId,
      slug: 'preview-card',
      title: 'Черновая карточка',
      draft: {
        blocks: [
          { id: 'visible', type: 'custom:preview-card', props: { title: 'Текст черновика' } },
          {
            id: 'hidden',
            type: 'custom:preview-card',
            props: { title: 'Скрытое содержимое' },
            hidden: true,
          },
        ],
      },
    })
    const link = await create()
    const response = await open(link.token, 'preview-card')
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('Текст черновика')
    for (const hidden of [
      'Скрытое содержимое',
      'Не показывать пример',
      'unused-card',
      'never-run-this-script',
      'Описание для каталога',
    ])
      expect(text).not.toContain(hidden)
    expect(JSON.parse(text)).toMatchObject({
      customBlocks: { 'preview-card': { template: '<h2>{{ title }}</h2>' } },
    })
  })

  it('открывает черновики без сессии, без личных данных, скриптов и кеша; не пишет токен в лог', async () => {
    const link = await create()
    await db
      .update(sites)
      .set({
        headerDraft: { ...defaultHeader, logoText: 'Черновая шапка' },
        footerDraft: { ...defaultFooter, about: 'Черновой подвал' },
        themeDraft: { ...defaultTheme, radius: 'none' },
        scriptDraft: { script: 'secret-script', origins: [] },
      })
      .where(eq(sites.id, demoSiteId))
    const response = await app.request(`/api/preview/${link.token}/`, {
      headers: { cookie: owner.headers.cookie ?? '' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(await response.json()).toMatchObject({
      site: {
        header: { logoText: 'Черновая шапка' },
        footer: { about: 'Черновой подвал' },
        theme: { radius: 'none' },
      },
      page: { slug: 'index' },
    })
    const text = await (await open(link.token)).text()
    for (const privateField of [
      'leadRecipients',
      'leadRetentionDays',
      'scriptDraft',
      'tokenHash',
      'secret-script',
      owner.user.email,
    ])
      expect(text).not.toContain(privateField)
    expect(logs.join('\n')).not.toContain(link.token)
    expect((await open(link.token, 'missing')).status).toBe(404)
    expect((await app.request(`/api/preview/${link.token}/`, { method: 'POST' })).status).toBe(401)
  })
})
