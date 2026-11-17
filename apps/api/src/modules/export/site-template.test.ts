import {
  defaultFooter,
  defaultTheme,
  demoPage,
  Header,
  newSiteSettings,
  Organization,
  PageContent,
  SiteTemplate,
  starterCustomBlock,
} from '@averra/schema'
import { eq } from 'drizzle-orm'
import { unzipSync, zipSync } from 'fflate'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import {
  customBlocks,
  leads,
  mailTemplateTexts,
  media,
  notificationRecipients,
  pageRevisions,
  pages,
  sites,
} from '../../db/schema'
import { mailTemplates } from '../../mail/templates'
import { sharpProcessor } from '../../media/sharp-processor'
import { mediaKey } from '../../media/storage'
import { createTestApi } from '../../testing'
import { sitesRepo } from '../sites/repo'
import { setupChecklist } from '../sites/setup'
import { importTemplate, readTemplateArchive, templateEntries } from './site-template'
import { zipStream } from './zip'

const api = await createTestApi({ version: '0.4.0' })
afterAll(() => api.close())

async function archive(siteId: string) {
  const entries = await templateEntries({
    db: api.db,
    storage: api.storage,
    siteId,
    version: '0.4.0',
  })
  async function* source() {
    yield* entries
  }
  return new Uint8Array(await new Response(zipStream(source())).arrayBuffer())
}

const restore = (siteId: string, bytes: Uint8Array, storage = api.storage) =>
  importTemplate({
    db: api.db,
    storage,
    images: sharpProcessor(),
    maxBytes: 10 * 1024 * 1024,
    siteId,
    bytes,
  })

async function upload(siteId: string, used = true) {
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
    .png()
    .toBuffer()
  const data = new FormData()
  data.set('file', new File([image], used ? 'личное-имя.png' : 'лишнее.png'))
  const res = await api.app.request(`/api/sites/${siteId}/media`, {
    method: 'POST',
    headers: (await api.loginAs('owner')).headers,
    body: data,
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

describe('шаблоны сайта', () => {
  it('прямо исключает заявки, контакты, пользователей, токены и получателей', async () => {
    const siteId = await api.createSite('Шаблон')
    const organization = Organization.parse({
      name: 'Секретная организация',
      phone: '+79001234567',
      email: 'private@client.test',
      inn: '1234567890',
      ogrn: '1234567890123',
      address: { street: 'Секретная улица' },
    })
    await api.db
      .update(sites)
      .set({
        settings: {
          ...newSiteSettings(),
          organization,
          url: 'https://old-client.test',
          analytics: { metrika: '12345', ga4: '' },
        },
      })
      .where(eq(sites.id, siteId))
    await api.db.insert(leads).values({
      siteId,
      pageSlug: 'index',
      blockId: 'lead',
      formTitle: 'Секретная заявка',
      data: [{ name: 'name', label: 'Имя', type: 'name', value: 'Секретный посетитель' }],
      consentText: 'Согласен',
      consentPolicyUrl: '/privacy',
      consentedAt: new Date(),
    })
    await api.db.insert(notificationRecipients).values({
      siteId,
      channel: 'email',
      address: 'sales-secret@client.test',
      events: ['lead.new'],
    })
    const token = await api.createToken(siteId, 'секретный токен')
    const { user } = await api.loginAs('owner')
    await sitesRepo(api.db).createPage(
      siteId,
      'privacy',
      'Политика',
      PageContent.parse({
        blocks: [
          {
            id: 'legal',
            type: 'text',
            props: {
              body: `Оператор: ${organization.name}, ${organization.email}, ${organization.inn}`,
            },
          },
        ],
      }),
    )
    const bytes = await archive(siteId)
    const files = unzipSync(bytes)
    const text = new TextDecoder().decode(files['template.json'])
    const template = JSON.parse(text)
    for (const key of ['leads', 'users', 'tokens', 'apiTokens', 'recipients', 'revisions', 'smtp'])
      expect(template).not.toHaveProperty(key)
    for (const key of ['organization', 'url', 'analytics', 'verification'])
      expect(template.site.settings).not.toHaveProperty(key)
    expect(template.site).not.toHaveProperty('leadSettings')
    for (const value of [
      organization.name,
      organization.phone,
      organization.email,
      organization.inn,
      organization.ogrn,
      organization.address.street,
      'old-client.test',
      'Секретный посетитель',
      'sales-secret@client.test',
      'секретный токен',
      token.token,
      user.email,
    ]) {
      expect(text).not.toContain(value)
    }
    expect(Object.keys(files)).toEqual(['template.json'])
    await api.db
      .update(sites)
      .set({ scriptPublished: { script: `const email = '${organization.email}'`, origins: [] } })
      .where(eq(sites.id, siteId))
    await expect(archive(siteId)).rejects.toThrow('В коде сайта остались контакты')
  })

  it('пустой сайт восстанавливает страницы, тему, шапку, свои блоки, письма и только используемую медиатеку', async () => {
    const source = await api.createSite('Исходный')
    const image = await upload(source)
    await upload(source, false)
    const definition = starterCustomBlock('card', 'Карточка')
    const theme = { ...defaultTheme, radius: defaultTheme.radius === 'large' ? 'small' : 'large' }
    const content = PageContent.parse({
      blocks: [
        {
          id: 'hero',
          type: 'hero',
          props: {
            variant: 'split',
            title: 'Опубликованное',
            image: { mediaId: image.id, alt: 'Картинка' },
          },
        },
        { id: 'card', type: 'custom:card', props: definition.example },
      ],
    })
    await sitesRepo(api.db).saveDraft(source, 'index', 'Главная', content)
    await api.db.transaction((tx) =>
      tx
        .update(pages)
        .set({ published: content, publishedTitle: 'Главная', publishedAt: new Date() })
        .where(eq(pages.siteId, source)),
    )
    await sitesRepo(api.db).saveDraft(source, 'index', 'Неопубликованные правки', { blocks: [] })
    await sitesRepo(api.db).createPage(source, 'draft', 'Черновик', { blocks: [] })
    const header = Header.parse({})
    await api.db
      .update(sites)
      .set({
        headerPublished: header,
        footerPublished: defaultFooter,
        scriptPublished: { script: 'console.log(1)', origins: [] },
        themePublished: theme,
      })
      .where(eq(sites.id, source))
    const mailText = mailTemplates['lead-received'].defaultText
    await api.db.insert(mailTemplateTexts).values({
      siteId: source,
      template: 'lead-received',
      draft: mailText,
      published: mailText,
      publishedAt: new Date(),
    })
    await api.db.insert(customBlocks).values({
      siteId: source,
      key: definition.key,
      draft: definition,
      published: definition,
      publishedAt: new Date(),
    })
    const original = await archive(source)
    const template = readTemplateArchive(original).template
    expect(template.media).toHaveLength(1)
    expect(template.pages.find((page) => page.slug === 'index')?.title).toBe('Главная')
    const target = await api.createSite()
    expect(await restore(target, original)).toEqual({ pages: 2, media: 1 })
    const site = await sitesRepo(api.db).find(target)
    expect(site?.themePublished).toEqual(theme)
    expect(site?.headerPublished).toEqual(header)
    expect(site?.footerPublished).toEqual(defaultFooter)
    expect(site?.scriptPublished).toEqual({ script: 'console.log(1)', origins: [] })
    const [mail] = await api.db
      .select()
      .from(mailTemplateTexts)
      .where(eq(mailTemplateTexts.siteId, target))
    expect(mail?.published).toEqual(mailTemplates['lead-received'].defaultText)
    const main = await sitesRepo(api.db).findPage(target, 'index')
    expect(main?.publishedTitle).toBe('Главная')
    expect(main?.draft).toEqual(main?.published)
    const draft = await sitesRepo(api.db).findPage(target, 'draft')
    expect(draft?.published).toBeNull()
    const [picture] = await api.db.select().from(media).where(eq(media.siteId, target))
    expect(picture?.id).not.toBe(image.id)
    expect(picture?.originalName).toBe('картинка')
    expect(JSON.stringify(main?.published)).toContain(picture?.id)
    expect(
      picture && (await api.storage.get(mediaKey(target, picture.id, picture.originalFile))),
    ).toBeTruthy()
    expect(
      await api.db.select().from(customBlocks).where(eq(customBlocks.siteId, target)),
    ).toHaveLength(1)
    expect(
      await api.db.select().from(pageRevisions).where(eq(pageRevisions.siteId, target)),
    ).toHaveLength(1)
    // Повторная выгрузка сохраняет весь переносимый смысл, меняются лишь id медиатеки.
    const again = readTemplateArchive(await archive(target)).template
    expect(again.pages.map((page) => [page.slug, page.title, page.published])).toEqual(
      template.pages.map((page) => [page.slug, page.title, page.published]),
    )
  })

  it('круговой экспорт демо-сайта → импорт → экспорт', async () => {
    const before = readTemplateArchive(await archive(api.demoSiteId)).template
    const target = await api.createSite()
    await restore(target, await archive(api.demoSiteId))
    const after = readTemplateArchive(await archive(target)).template
    expect(after).toEqual(before)
    expect(before.pages[0]?.content.blocks.length).toBe(demoPage.blocks.length)
  })

  it('очищает SVG тем же путём, что загрузка в медиатеку, и откатывает файлы при сбое', async () => {
    const target = await api.createSite()
    const files = unzipSync(await archive(api.demoSiteId))
    const template = readTemplateArchive(await archive(api.demoSiteId)).template
    const id = 'b0000000-0000-4000-8000-000000000001'
    const file = `media/${id}/image.svg`
    template.site.settings.icon = id
    template.media = [{ id, file, originalName: 'icon.svg' }]
    const json = new TextEncoder().encode(JSON.stringify(template))
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><script>alert(1)</script><path d="M0 0h16v16z"/></svg>',
    )
    const bytes = zipSync({ ...files, 'template.json': json, [file]: svg })
    const removed: string[] = []
    await expect(
      restore(target, bytes, {
        ...api.storage,
        put: async () => {
          throw new Error('Сбой записи файла')
        },
        remove: async (keys) => {
          removed.push(...keys)
          await api.storage.remove(keys)
        },
      }),
    ).rejects.toThrow('Сбой записи файла')
    expect(removed).toHaveLength(1)
    expect(await api.db.select().from(media).where(eq(media.siteId, target))).toHaveLength(0)
    expect((await sitesRepo(api.db).findPage(target, 'index'))?.published).toBeNull()
    await restore(target, bytes)
    const [picture] = await api.db.select().from(media).where(eq(media.siteId, target))
    expect(picture?.mimeType).toBe('image/svg+xml')
    if (!picture) throw new Error('Картинка не импортирована')
    const saved = await api.storage.get(mediaKey(target, picture.id, picture.originalFile))
    expect(new TextDecoder().decode(saved)).not.toContain('<script')
    const brokenTarget = await api.createSite()
    await expect(
      restore(
        brokenTarget,
        zipSync({ 'template.json': json, [file]: new TextEncoder().encode('not an image') }),
      ),
      // Тот же отказ, что у загрузки в медиатеку: файл под видом картинки не принимается
    ).rejects.toThrow('Можно загрузить JPEG')
  })

  it('отказывает живому сайту и не меняет его; пустая опубликованная тоже защищена', async () => {
    const bytes = await archive(api.demoSiteId)
    await expect(restore(api.demoSiteId, bytes)).rejects.toThrow('уже есть свои страницы')
    const target = await api.createSite()
    await sitesRepo(api.db).createPage(target, 'own', 'Своя', { blocks: [] })
    await expect(restore(target, bytes)).rejects.toThrow('уже есть свои страницы')
    expect(await sitesRepo(api.db).findPage(target, 'own')).toBeDefined()
    const publishedTarget = await api.createSite()
    await api.db
      .update(pages)
      .set({ published: { blocks: [] }, publishedTitle: 'Пустая' })
      .where(eq(pages.siteId, publishedTarget))
    await expect(restore(publishedTarget, bytes)).rejects.toThrow('уже есть свои страницы')
  })

  it('отвергает будущую версию, лишние файлы, отсутствующие медиа и неверный JSON до записи', async () => {
    const target = await api.createSite()
    const original = unzipSync(await archive(api.demoSiteId))
    const template = JSON.parse(new TextDecoder().decode(original['template.json']))
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    await expect(
      restore(target, zipSync({ 'template.json': encode({ ...template, formatVersion: 2 }) })),
    ).rejects.toThrow('Неизвестная версия')
    expect(() => readTemplateArchive(zipSync({ ...original, '../outside': encode('x') }))).toThrow(
      'Недопустимые',
    )
    expect(() =>
      readTemplateArchive(zipSync({ 'template.json': encode({ ...template, site: {} }) })),
    ).toThrow('не прошёл проверку')
    template.site.settings.icon = 'b0000000-0000-4000-8000-000000000001'
    await expect(restore(target, zipSync({ 'template.json': encode(template) }))).rejects.toThrow(
      'отсутствующую картинку',
    )
    expect(await sitesRepo(api.db).listPages(target)).toHaveLength(1)
  })

  it('кнопка отдаёт ZIP владельцу и администратору; редактору и токену отказ', async () => {
    for (const role of ['owner', 'client', 'editor'] as const) {
      const res = await api.app.request(`/api/sites/${api.demoSiteId}/export/template`, {
        headers: (await api.loginAs(role)).headers,
      })
      expect(res.status).toBe(role === 'editor' ? 403 : 200)
      if (res.status === 200)
        expect(
          unzipSync(new Uint8Array(await res.arrayBuffer()))['template.json']?.length,
        ).toBeGreaterThan(0)
    }
    const token = await api.createToken()
    const res = await api.app.request(`/api/sites/${api.demoSiteId}/export/template`, {
      headers: { Authorization: `Bearer ${token.token}` },
    })
    expect(res.status).toBe(403)
  })

  it('чек-лист исчезает по данным без отдельных галочек', async () => {
    const siteId = await api.createSite()
    const site = await sitesRepo(api.db).find(siteId)
    if (!site) throw new Error('Не создан тестовый сайт')
    expect((await setupChecklist(api.db, site, false)).map((item) => item.key)).toEqual([
      'organization',
      'documents',
      'smtp',
      'recipients',
      'domain',
    ])
    site.settings = {
      ...newSiteSettings(),
      url: 'https://client.test',
      organization: Organization.parse({
        name: 'Клиент',
        inn: '1234567890',
        ogrn: '1234567890123',
        email: 'info@client.test',
        address: { street: 'Улица, дом' },
      }),
    }
    await api.db
      .insert(notificationRecipients)
      .values({ siteId, channel: 'email', address: 'info@client.test', events: ['lead.new'] })
    for (const slug of ['privacy', 'consent']) {
      await api.db.insert(pages).values({
        siteId,
        slug,
        title: slug,
        draft: PageContent.parse({
          blocks: [{ id: 'legal', type: 'text', props: { body: 'Документ клиента' } }],
        }),
        published: PageContent.parse({
          blocks: [{ id: 'legal', type: 'text', props: { body: 'Документ клиента' } }],
        }),
        publishedTitle: slug,
      })
    }
    expect(await setupChecklist(api.db, site, true)).toEqual([])
    expect(SiteTemplate.safeParse({ formatVersion: 100 }).success).toBe(false)
  })
})
