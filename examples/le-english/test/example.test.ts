import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestApi, TEST_PASSWORD, testOrigins } from '@averra/api/testing'
import { customBlockProblems } from '@averra/blocks/custom-engine'
import { customBlockProps, PageContent, parsedExample } from '@averra/schema'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { BLOCK_ORDER, BLOCKS_FILE, buildFile } from '../build-blocks.ts'
import { createClient } from '../src/api-client.ts'
import { homeBlocks, menuItems, photosOf } from '../src/content.ts'
import { importSite } from '../src/import-site.ts'

// Пример переноса: файл выгрузки блоков свежий и без ошибок, контент превращается в страницу, а
// скрипт ставит всё на настоящий API (в памяти) так же, как владелец в админке

const content = {
  contacts: { telegram: 'https://t.me/example_teacher' },
  hero: {
    eyebrow: 'Онлайн',
    title: 'Английский, *который вписывается* в жизнь',
    lead: 'Текст',
    button: 'Записаться',
    note: 'заметка',
    badges: ['Раз', 'Два'],
    photo: { src: 'assets/images/hero.webp', alt: 'Портрет' },
    photoCaption: 'Hi',
    stickerTop: 'Стикер',
    stickerBottom: 'Ещё',
  },
  goals: {
    title: 'Цели',
    cards: [1, 2, 3, 4].map((n) => ({
      title: `Цель ${n}`,
      text: 'Текст',
      photo: { src: `assets/images/goal-${n}.webp`, alt: `Фото ${n}` },
      backTitle: 'Оборот',
      backItems: ['Пункт'],
    })),
  },
  about: {
    title: 'Привет, я *Лера*',
    text: 'Один.\n\nДва.',
    points: ['Пункт'],
    photo: { src: 'assets/images/hero.webp', alt: 'Портрет' },
    sticker: 'Hello',
  },
  steps: { title: 'Шаги', aside: 'онлайн', items: [{ title: 'Шаг', text: 'Текст' }] },
  reviews: {
    title: 'Отзывы',
    lead: '',
    note: '',
    cta: 'Хочу так же',
    sticker: '',
    items: [
      { name: 'Аня', topic: 'работа', text: 'Хорошо', photo: null, caption: '' },
      {
        name: 'Миша',
        topic: '',
        text: 'Отлично',
        photo: { src: 'assets/images/goal-1.webp', width: 8, height: 8 },
        caption: 'Telegram',
      },
    ],
  },
  prices: {
    title: 'Цены',
    aside: '',
    note: '',
    items: [{ price: '500 ₽', title: 'Урок', note: '', badge: '' }],
  },
  faq: { title: 'Вопросы', aside: 'Пиши', items: [{ question: 'Как?', answer: 'Так.\n\nИ так.' }] },
  signup: { eyebrow: '', title: 'Начни', text: 'Текст', button: 'Записаться', note: '' },
  legal: { operator: '', inn: '', email: '' },
  seo: { title: 'Заголовок', description: 'Описание', shareTitle: '', shareDescription: '' },
}

describe('файл выгрузки блоков', () => {
  const built = buildFile()

  it('собран из исходников: после правок blocks/ его пересобирают командой build', () => {
    const onDisk = JSON.parse(readFileSync(BLOCKS_FILE, 'utf8')) as typeof built
    expect(onDisk.blocks).toEqual(JSON.parse(JSON.stringify(built.blocks)))
    expect(onDisk.blocks.map((block) => block.key)).toEqual([...BLOCK_ORDER])
  })

  it.each(built.blocks.map((block) => [block.key, block] as const))(
    '%s: ни одной ошибки, пример проходит схему и рисуется',
    (_key, block) => {
      const errors = customBlockProblems(block).filter((problem) => problem.level === 'error')
      expect(errors).toEqual([])
      expect(parsedExample(block)).not.toBeNull()
      expect(customBlockProps(block.fields)).toBeDefined()
    },
  )

  it('блоки без скриптов и без чужих адресов: правила безопасности движка проходят', () => {
    for (const block of built.blocks) {
      expect(block.template).not.toMatch(/<script|on\w+=|javascript:/i)
    }
  })
})

describe('контент → страница', () => {
  const media = (photo: unknown) => {
    const src = (photo as { src?: string } | null)?.src
    return src ? { mediaId: '11111111-1111-4111-8111-111111111111', alt: 'alt' } : undefined
  }

  it('секции по порядку страницы, пустые пропускаются вместе с пунктом меню', () => {
    const blocks = homeBlocks(content, media)
    expect(blocks.map((block) => block.id)).toEqual([
      'top',
      'goals',
      'about',
      'steps',
      'reviews',
      'prices',
      'faq',
      'signup',
    ])
    const sparse = { ...content, prices: { ...content.prices, items: [] } }
    expect(homeBlocks(sparse, media).map((block) => block.id)).not.toContain('prices')
    expect(menuItems(sparse).map((item) => item.block)).not.toContain('prices')
    expect(menuItems(content).map((item) => item.label)).toEqual([
      'Цели',
      'Обо мне',
      'Занятия',
      'Отзывы',
      'Цены',
      'Вопросы',
    ])
  })

  it('фото собираются без повторов, у учеников alt — имя', () => {
    const photos = photosOf(content)
    expect(new Set(photos.map((photo) => photo.src)).size).toBe(photos.length)
    expect(photos.find((photo) => photo.src === 'assets/images/goal-1.webp')?.alt).toBeTruthy()
  })
})

const api = await createTestApi()
afterAll(api.close)

describe('скрипт переноса на настоящем API', () => {
  const dir = mkdtempSync(join(tmpdir(), 'le-english-'))
  it('черновики, публикация после документов, повторный запуск без дублей и потерь', async () => {
    mkdirSync(join(dir, 'public', 'assets', 'images'), { recursive: true })
    const png = await sharp({
      create: { width: 32, height: 40, channels: 3, background: '#aa5533' },
    })
      .webp()
      .toBuffer()
    for (const name of ['hero', 'goal-1', 'goal-2', 'goal-3', 'goal-4']) {
      writeFileSync(join(dir, 'public', 'assets', 'images', `${name}.webp`), png)
    }
    const touchIcon = await sharp({
      create: { width: 180, height: 180, channels: 3, background: '#213d32' },
    })
      .png()
      .toBuffer()
    writeFileSync(join(dir, 'public', 'assets', 'images', 'apple-touch-icon.png'), touchIcon)
    const contentFile = join(dir, 'content.json')
    // Живой сайт хранит контент внутри записи { version, savedAt, content }
    writeFileSync(contentFile, JSON.stringify({ version: '1', savedAt: 'x', content }))

    const owner = await api.createUser('owner')
    const client = createClient({
      baseUrl: testOrigins.api,
      origin: testOrigins.admin,
      fetch: async (input, init) => api.app.request(input, init),
    })
    await client.signIn(owner.email, TEST_PASSWORD)
    const run = (publish: boolean, siteUrl?: string) =>
      importSite({
        client,
        contentFile,
        publicDir: join(dir, 'public'),
        blocksFile: BLOCKS_FILE,
        publish,
        ...(siteUrl !== undefined && { siteUrl }),
      })
    const base = `/api/sites/${api.demoSiteId}`
    const publishedOf = async (path: string) =>
      (await client.get<{ published: unknown }>(`${base}/${path}`)).published

    // Опубликованное демо-сайта: без флага и без документов скрипт его не трогает
    const sitePaths = ['pages/index', 'theme', 'header', 'footer']
    const snapshot = () => Promise.all(sitePaths.map(publishedOf))
    const untouched = await snapshot()

    // Без флага: опубликованы только свои блоки (страницы проверяют по опубликованным)
    const draftRun = await run(false)
    expect(draftRun.blocks).toEqual([...BLOCK_ORDER])
    expect(draftRun.published).toBe(false)
    const { blocks } = await client.get<{ blocks: { key: string; unpublished: boolean }[] }>(
      `${base}/custom-blocks`,
    )
    expect(blocks.map((block) => block.key).toSorted()).toEqual([...BLOCK_ORDER].toSorted())
    expect(blocks.every((block) => !block.unpublished)).toBe(true)
    expect(await snapshot()).toEqual(untouched)
    expect(await publishedOf('pages/zapis')).toBeNull()

    // С флагом, пока документы — черновики: форма с персональными данными не публикуется
    const blocked = await run(true)
    expect(blocked.published).toBe(false)
    expect(blocked.missingDocuments).toEqual(['/privacy', '/consent'])
    expect(await snapshot()).toEqual(untouched)
    expect(await publishedOf('pages/zapis')).toBeNull()

    // Человек проверил документы, вписал адрес и текст уведомления о cookies — и запускает снова
    for (const slug of ['privacy', 'consent']) {
      await client.post(`${base}/pages/${slug}/publish`)
    }
    const address = { street: 'ул. Пушкина, 1', city: 'Москва' }
    const settings = await client.get<{ settings: { organization: Record<string, unknown> } }>(
      `${base}/settings`,
    )
    await client.patch(`${base}/settings`, {
      organization: { ...settings.settings.organization, phone: '+7 900 000-00-00', address },
      cookies: { mode: 'notice', text: 'Мы используем cookies', policyPage: 'privacy' },
    })
    const { items: before } = await client.get<{ items: unknown[] }>(`${base}/media`)
    const result = await run(true)
    expect(result.published).toBe(true)
    expect(result.missingDocuments).toEqual([])

    const page = PageContent.parse(await publishedOf('pages/index'))
    expect(page.blocks.map((block) => block.type)).toContain('custom:le-hero')
    expect(await publishedOf('pages/zapis')).not.toBeNull()
    const header = (await publishedOf('header')) as { menu: unknown[]; button: { page: string } }
    expect(header.menu).toHaveLength(6)
    expect(header.button.page).toBe('zapis')
    const theme = (await publishedOf('theme')) as { fonts: { accent?: string } }
    expect(theme.fonts.accent).toBe('caveat')

    // Повторный запуск не плодит фото и не затирает то, что владелец вписал сам
    const { items: after } = await client.get<{ items: unknown[] }>(`${base}/media`)
    expect(after).toHaveLength(before.length)
    const kept = await client.get<{
      settings: {
        organization: { phone: string; address: { street: string } }
        cookies: { mode: string; text: string; policyPage: string }
      }
    }>(`${base}/settings`)
    expect(kept.settings.organization.phone).toBe('+7 900 000-00-00')
    expect(kept.settings.organization.address.street).toBe('ул. Пушкина, 1')
    expect((kept.settings as { icon?: string | null }).icon).toBeTruthy()
    expect(kept.settings.cookies).toMatchObject({ mode: 'notice', text: 'Мы используем cookies' })
  })

  it('кривой --site-url отвергается до первых изменений', async () => {
    const owner = await api.createUser('owner')
    const client = createClient({
      baseUrl: testOrigins.api,
      origin: testOrigins.admin,
      fetch: async (input, init) => api.app.request(input, init),
    })
    await client.signIn(owner.email, TEST_PASSWORD)
    await expect(
      importSite({
        client,
        contentFile: join(dir, 'content.json'),
        publicDir: join(dir, 'public'),
        blocksFile: BLOCKS_FILE,
        publish: false,
        siteUrl: 'http://le-english.ru',
      }),
    ).rejects.toThrow(/https:\/\/домен/)
  })
})
