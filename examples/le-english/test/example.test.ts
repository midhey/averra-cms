import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestApi, TEST_PASSWORD, testOrigins } from '@averra/api/testing'
import {
  compileWindowCss,
  customBlockProblems,
  renderCustomBlockHtml,
} from '@averra/blocks/custom-engine'
import { customBlockProps, form, PageContent, parsedExample } from '@averra/schema'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { BLOCK_ORDER, BLOCKS_FILE, buildFile } from '../build-blocks.ts'
import { createClient } from '../src/api-client.ts'
import { homeBlocks, menuItems, photosOf, signupFormProps } from '../src/content.ts'
import { defaultBackupDir, importSite, settingsPatch, upgradeHome } from '../src/import-site.ts'

const here = dirname(fileURLToPath(import.meta.url))
const GRAIN = join(here, '..', 'assets', 'grain.png')
const SITE_SCRIPT = join(here, '..', 'site', 'script.js')

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

  const html = (key: string, overrides: Record<string, unknown> = {}) => {
    const block = built.blocks.find((one) => one.key === key)
    if (!block) throw new Error(`Нет блока ${key}`)
    const props = { ...(parsedExample(block) as Record<string, unknown>), ...overrides }
    return renderCustomBlockHtml(block, props, { id: 'b', media: {}, priority: false })
  }

  it('ссылки на Telegram открываются в новой вкладке с noopener, свои — в той же', () => {
    for (const [key, field] of [
      ['le-faq', 'aside'],
      ['le-signup', 'telegram'],
    ] as const) {
      const external = html(key, { [field]: { label: 'Пиши', href: 'https://t.me/example' } })
      expect(external).toContain('href="https://t.me/example"')
      expect(external).toMatch(/target="_blank"/)
      expect(external).toMatch(/rel="noopener noreferrer"/)
      const internal = html(key, { [field]: { label: 'Пиши', href: '/zapis/' } })
      expect(internal).not.toMatch(/target="_blank"/)
    }
  })

  it('стрелка «↗» не в тексте поля, а в шаблоне: в span с aria-hidden, читалка её не произносит', () => {
    const arrowed = {
      ...content,
      hero: { ...content.hero, note: 'знакомимся ↗' },
      faq: { ...content.faq, aside: 'отвечу ↗' },
    }
    const props = homeBlocks(arrowed, () => undefined)
    const propsOf = (id: string) =>
      props.find((block) => block.id === id)?.props as Record<string, unknown>
    // Из текста поля стрелка убрана при импорте (у подписи ссылки и у обычного текста)
    expect(propsOf('top').note).toBe('знакомимся')
    expect((propsOf('faq').aside as { label: string }).label).toBe('отвечу')
    expect((propsOf('signup').telegram as { label: string }).label).toBe(
      'или напиши мне в Telegram',
    )
    // Шаблон рисует её сам и прячет от читалки
    const arrow = '<span aria-hidden="true">↗</span>'
    expect(html('le-hero', { note: 'знакомимся' })).toContain(`знакомимся ${arrow}`)
    expect(html('le-faq', { aside: { label: 'отвечу', href: '/zapis/' } })).toContain(
      `отвечу ${arrow}`,
    )
    expect(html('le-signup', { telegram: { label: 'Пиши', href: '/zapis/' } })).toContain(
      `Пиши ${arrow}`,
    )
  })

  it('старые страницы со «↗» в тексте поля: на сайте стрелка одна, а не две', () => {
    // Установка, перенесённая прежней версией скрипта: стрелка осталась в тексте поля, а
    // определения блоков обновили без повторного импорта страниц. Шаблон не дописывает вторую
    const arrow = '<span aria-hidden="true">↗</span>'
    const count = (text: string) => text.split('↗').length - 1
    const cases = [
      html('le-hero', { note: 'знакомимся ↗' }),
      html('le-hero', { note: 'знакомимся↗ ' }),
      html('le-faq', { aside: { label: 'отвечу ↗', href: '/zapis/' } }),
      html('le-signup', { telegram: { label: 'Пиши ↗', href: 'https://t.me/x' } }),
    ]
    for (const rendered of cases) expect(count(rendered), rendered).toBe(1)
    expect(cases[0]).toContain(`знакомимся ${arrow}`)
    expect(cases[1]).toContain(`знакомимся ${arrow}`)
    expect(cases[2]).toContain(`отвечу ${arrow}`)
    expect(cases[3]).toContain(`Пиши ${arrow}`)
    // Стрелка не в конце — часть текста, её не трогаем
    expect(html('le-hero', { note: 'раз ↗ два' })).toContain('раз ↗ два ')
  })

  it('кнопки «Записаться» ведут на /zapis/ со слэшем: без лишнего редиректа', () => {
    const blocks = homeBlocks(content, () => undefined)
    const hrefOf = (id: string, field: string) => {
      const props = blocks.find((block) => block.id === id)?.props as
        | Record<string, { href?: string }>
        | undefined
      return props?.[field]?.href
    }
    expect(hrefOf('top', 'button')).toBe('/zapis/')
    expect(hrefOf('reviews', 'cta')).toBe('/zapis/')
    expect(hrefOf('signup', 'button')).toBe('/zapis/')
    // Пример блока в файле выгрузки — тот же адрес
    for (const block of built.blocks.filter((one) => one.key !== 'le-faq')) {
      expect(JSON.stringify(parsedExample(block))).not.toContain('"/zapis"')
    }
  })

  it('карточке цели под клавиатурным фокусом подсказана клавиша: без JS Enter флажок не переворачивает', () => {
    expect(html('le-goals')).toContain('goal-card__by-key')
    expect(html('le-goals')).not.toContain('goal-card__keyhint')
  })

  // CSS-правила проверяются по тексту стилей блоков из buildFile(): браузера в unit-тестах нет,
  // а без этих тестов правило можно удалить, и всё останется зелёным
  const cssOf = (key: string) => built.blocks.find((one) => one.key === key)?.css ?? ''

  it.each(['le-about', 'le-faq', 'le-goals', 'le-prices', 'le-reviews', 'le-steps'])(
    '%s: заголовок раздела на телефоне не мельче 30px',
    (key) => {
      expect(cssOf(key)).toMatch(
        /@media \(max-width: 540px\) \{\s*\.section-title \{[^}]*font-size: clamp\(30px,/,
      )
    },
  )

  it('кнопка «Записаться» в первом экране при наведении светлеет, а не только поднимается', () => {
    expect(cssOf('le-hero')).toMatch(/\.cta-dark:hover \{[^}]*filter: brightness\(1\.25\)/)
  })

  it('подсказка клавиши у карточки цели показывается по :focus-visible и прячет подпись мыши', () => {
    const css = cssOf('le-goals')
    expect(css).toMatch(/\.goal-card__by-key \{\s*display: none;/)
    expect(css).toMatch(
      /\.goal-card__toggle:focus-visible ~ \.goal-card__inner \.goal-card__by-key \{\s*display: inline;/,
    )
    expect(css).toMatch(
      /\.goal-card__toggle:focus-visible ~ \.goal-card__inner \.goal-card__by-mouse \{\s*display: none;/,
    )
  })

  it('форма записи: контакт проверяется по способу связи (видов связи у каналов — по числу каналов)', () => {
    const props = form.props.parse(signupFormProps(content))
    const channel = props.fields.find((field) => field.name === 'channel')
    expect(channel?.options?.map((option) => option.contact)).toEqual([
      'telegram',
      'vk',
      'phone',
      'email',
    ])
    expect(props.fields.find((field) => field.name === 'contact')?.contactBy).toBe('channel')
  })

  it('шаблоны без скриптов и без чужих адресов; свой JS — только у карточек целей, файлом', () => {
    for (const block of built.blocks) {
      expect(block.template).not.toMatch(/<script|on\w+=|javascript:/i)
    }
    expect(built.blocks.filter((block) => block.script !== '').map((block) => block.key)).toEqual([
      'le-goals',
    ])
  })

  it('кнопки записи открывают окно по флажку «Открывать в окне», без флажка — обычная ссылка', () => {
    const cases = [
      ['le-hero', 'button'],
      ['le-reviews', 'cta'],
      ['le-signup', 'button'],
      ['le-message', 'button'],
    ] as const
    for (const [key, field] of cases) {
      const on = html(key, { [field]: { label: 'Записаться', href: '/zapis/', window: true } })
      expect(on, key).toMatch(/href="\/zapis\/" data-av-window/)
      const off = html(key, { [field]: { label: 'Записаться', href: '/zapis/', window: false } })
      expect(off, key).not.toContain('data-av-window')
    }
    // Импорт ставит флажок всем трём кнопкам главной
    const blocks = homeBlocks(content, () => undefined)
    for (const [id, field] of [
      ['top', 'button'],
      ['reviews', 'cta'],
      ['signup', 'button'],
    ] as const) {
      const props = blocks.find((block) => block.id === id)?.props as Record<string, unknown>
      expect(props[field], id).toMatchObject({ href: '/zapis/', window: true })
    }
  })

  it('анимации оригинала — поведения Averra: появление, рисование линий, подсказка, плавный FAQ', () => {
    const goals = html('le-goals')
    const cards = (goals.match(/class="goal-card goal-card--\d" data-av-reveal/g) ?? []).length
    expect(cards).toBeGreaterThan(0)
    // Подсказка-поворот — только у первой карточки, один раз
    expect(goals.match(/data-av-hint="flip"/g)).toHaveLength(1)
    expect(goals).toContain('data-av-draw="svg"')
    for (const key of ['le-steps', 'le-prices', 'le-faq']) {
      expect(html(key), key).toMatch(/class="section-head[^"]*" data-av-reveal|faq__head/)
      expect(html(key), key).toContain('data-av-draw="svg"')
    }
    expect(html('le-faq')).toMatch(
      /<details class="faq__item" data-av-details(="")? data-av-reveal/,
    )
    // Пузыри отзывов — со своей стороны
    const reviews = html('le-reviews')
    expect(reviews).toContain('data-av-reveal="left"')
    expect(reviews).toContain('data-av-reveal="right"')
    // Наклон и длительность — переменными поведений в CSS блока
    expect(cssOf('le-goals')).toMatch(/\.goal-card\[data-av-reveal\] \{\s*--av-reveal-from:/)
    expect(cssOf('le-goals')).toContain('--av-reveal-duration: 0.7s')
  })

  it('отступы секций — свои, как у оригинала: [data-custom-block] сильнее рамки секции', () => {
    // Восемь секций главной и «Ой!» 404
    for (const key of BLOCK_ORDER.slice(0, 9)) {
      expect(cssOf(key), key).toMatch(/:scope\[data-custom-block\] \{[^}]*padding:/)
    }
  })

  it('моноширинный шрифт — из темы (--font-mono), а не стек устройства: в Safari ui-monospace — SF Mono', () => {
    for (const block of built.blocks) {
      expect(block.css, block.key).not.toMatch(/ui-monospace|monospace\s*;/)
    }
    for (const key of ['le-hero', 'le-goals', 'le-reviews']) {
      expect(cssOf(key), key).toContain('font-family: var(--font-mono)')
    }
  })

  it('курсор «взять» у карточек — только когда скрипт включил перетаскивание', () => {
    expect(cssOf('le-goals')).toMatch(
      /\.goals__board\[data-draggable\] \.goal-card \{\s*cursor: grab;\s*user-select: none;/,
    )
    expect(cssOf('le-goals')).not.toMatch(/(^|\n)\.goal-card \{[^}]*cursor/)
  })

  it('кнопку «Разложить заново» вставляет скрипт: без JS её нет, чтобы она не молчала', () => {
    expect(html('le-goals')).not.toContain('goals__reset')
    const script = built.blocks.find((block) => block.key === 'le-goals')?.script ?? ''
    expect(script).toContain("reset.className = 'goals__reset'")
    // Enter у флажка и перетаскивание — только мышью на широком экране
    expect(script).toMatch(/event\.key !== 'Enter'/)
    expect(script).toContain("event.pointerType !== 'mouse'")
  })

  it('шапка: на телефоне строка «Меню» с плавным раскрытием, последний пункт — в окно записи', () => {
    const header = built.blocks.find((block) => block.key === 'le-header')
    expect(header?.placement).toBe('header')
    expect(header?.template).toContain('<details class="menu" data-av-details>')
    expect(header?.template).toMatch(/\{% if site\.button and menu_cta %\}/)
    expect(header?.template.match(/\{% if site\.button\.window %\} data-av-window/g)).toHaveLength(
      2,
    )
    // Кнопка на узком экране — короткой подписью (набор её задаёт), а не переносом в две строки
    expect(header?.template).toContain('{{ site.button.mobile_label }}')
    expect(header?.css).toMatch(/\.cta__full \{[^}]*display: none/)
    expect(header?.css).toMatch(/\.cta__short \{[^}]*display: inline/)
    // На 404 «← На главную» нет — как у оригинала, только логотип
    expect(header?.template).toContain("{% unless page.slug == '404' %}")
    const footerBlock = built.blocks.find((block) => block.key === 'le-footer')
    expect(footerBlock?.placement).toBe('footer')
    expect(footerBlock?.template).toContain('site.legal.policy_href')
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
  // Один вход владельца на все проверки: у входа лимит попыток, и третий вход подряд получил бы 429
  let signed: ReturnType<typeof createClient> | undefined
  const ownerClient = async () => {
    if (signed) return signed
    const owner = await api.createUser('owner')
    const client = createClient({
      baseUrl: testOrigins.api,
      origin: testOrigins.admin,
      fetch: async (input, init) => api.app.request(input, init),
    })
    await client.signIn(owner.email, TEST_PASSWORD)
    signed = client
    return client
  }
  it('страховочные файлы по умолчанию — вне репозитория и не под именем бэкапов установки', () => {
    // Скрипт запускают из examples/le-english: файл с текстом юриста в рабочем дереве легко
    // закоммитить, а «averra-backup» — имя бэкапов самой установки на сервере
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const where = relative(repo, defaultBackupDir())
    expect(where.startsWith('..') || isAbsolute(where)).toBe(true)
    expect(defaultBackupDir()).not.toMatch(/averra-backup/)
  })
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
    // Картинка для соцсетей: с ней SEO главной получает и описание картинки (og:image:alt)
    const card = await sharp({
      create: { width: 120, height: 63, channels: 3, background: '#f3ece0' },
    })
      .jpeg()
      .toBuffer()
    writeFileSync(join(dir, 'public', 'assets', 'images', 'social-card.jpg'), card)
    const contentFile = join(dir, 'content.json')
    // Живой сайт хранит контент внутри записи { version, savedAt, content }
    writeFileSync(contentFile, JSON.stringify({ version: '1', savedAt: 'x', content }))

    const client = await ownerClient()
    const run = (publish: boolean, siteUrl?: string) =>
      importSite({
        client,
        contentFile,
        publicDir: join(dir, 'public'),
        blocksFile: BLOCKS_FILE,
        grainFile: GRAIN,
        siteScriptFile: SITE_SCRIPT,
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
    // Документы созданы после страницы с формой: политика говорит про заявки, а не «форм нет»
    const draftOf = async (slug: string) =>
      JSON.stringify((await client.get<{ draft: unknown }>(`${base}/pages/${slug}`)).draft)
    expect(await draftOf('privacy')).not.toContain('нет форм заявок')
    expect(await draftOf('privacy')).toContain('форме заявки')
    // Документы и своя 404 — служебные страницы: шапка короткая, как у оригинала
    const pageDraft = async (slug: string) =>
      (
        await client.get<{ draft: { shortHeader?: boolean; blocks: { props: unknown }[] } }>(
          `${base}/pages/${slug}`,
        )
      ).draft
    for (const slug of ['privacy', 'consent', '404']) {
      expect((await pageDraft(slug)).shortHeader, slug).toBe(true)
    }
    expect((await pageDraft('404')).blocks[0]?.props).toMatchObject({
      title: 'Такой страницы нет',
      button: { href: '/' },
    })
    expect(draftRun.rebuiltDocuments).toEqual([])
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
    // Документы описывают форму: повторный запуск их не пересобирает
    expect(blocked.rebuiltDocuments).toEqual([])
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
    expect(result.siteScriptSaved).toBe(true)
    expect(result.missingDocuments).toEqual([])

    const page = PageContent.parse(await publishedOf('pages/index'))
    expect(page.blocks.map((block) => block.type)).toContain('custom:le-hero')
    expect(await publishedOf('pages/zapis')).not.toBeNull()
    expect(await publishedOf('pages/404')).toMatchObject({ shortHeader: true })
    const header = (await publishedOf('header')) as {
      menu: unknown[]
      button: { page: string }
      brand: string
      logo: string | null
    }
    expect(header.menu).toHaveLength(6)
    expect(header.button.page).toBe('zapis')
    // Логотип текстом: картинка в шапке не хранится и не держит файл в медиатеке
    expect(header).toMatchObject({ brand: 'text', logo: null })
    const theme = (await publishedOf('theme')) as {
      fonts: { accent?: string; mono?: string }
      focus?: string
      browserColor?: string
      background?: { mediaId: string; size: string }
      windowCss?: string
    }
    expect(theme.fonts).toMatchObject({ accent: 'caveat', mono: 'jetbrains-mono' })
    // Кольцо фокуса — ржавое, строка браузера — тёмно-зелёная, фон — зерно бумаги узором
    expect(theme).toMatchObject({ focus: '#b85418', browserColor: 'accent' })
    expect(theme.background?.size).toBe('tile')
    expect(theme.windowCss).toContain('[data-site-window-title]')
    // Экран успеха окна: CSS проходит движок Averra без ошибок и после него держит все правила —
    // иначе после отправки заявки в окне остались бы «Попробуем?», приглашение и форма-пустышка
    const compiled = compileWindowCss(theme.windowCss ?? '')
    expect(compiled.problems.filter((problem) => problem.level === 'error')).toEqual([])
    const windowCss = compiled.css
    expect(windowCss).toMatch(
      /:has\(\[data-form-box\]\[data-sent\]\)[^{]*\[data-site-window-title\]/,
    )
    expect(windowCss).toMatch(/\[data-form-box\]\[data-sent\] > h2[^{]*\{[^}]*display: ?none/)
    expect(windowCss).toMatch(
      /\[data-sent\] > \[role="status"\]::before[^{]*\{[^}]*content: ?"Ура!"/,
    )
    expect(windowCss).toMatch(/\[data-sent\] \[data-done-title\]/)
    // Свои виды шапки и подвала; тексты — поля вида
    expect(header).toMatchObject({ custom: { key: 'le-header', props: { menu_label: 'Меню' } } })
    expect(header.button).toMatchObject({ page: 'zapis', window: true })
    expect(await publishedOf('footer')).toMatchObject({
      custom: {
        key: 'le-footer',
        props: { policy_label: 'Политика обработки персональных данных' },
      },
    })
    // /zapis — окно записи с заголовком «Попробуем?», кнопки главной открывают его
    expect(await publishedOf('pages/zapis')).toMatchObject({
      window: { title: 'Попробуем?' },
      shortHeader: true,
    })
    expect(JSON.stringify(page.blocks)).toContain('"window":true')
    expect(page.seo).toMatchObject({ imageAlt: expect.stringContaining('Валерия') })
    // 404 — свой блок «Ой!», как у оригинала
    expect(JSON.stringify(await publishedOf('pages/404'))).toContain('custom:le-message')
    // Скрипт сайта (улучшения формы) опубликован вместе с сайтом
    const script = await client.get<{ published: { script: string } }>(`${base}/script`)
    expect(script.published.script).toContain('Скрипт сайта Vallex English')

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

  it('документы: правка не пропадает, ложный черновик пересобирается, опубликованное не трогается', async () => {
    const client = await ownerClient()
    const base = `/api/sites/${api.demoSiteId}`
    let logs: string[] = []
    const run = (extra: { publish?: boolean; rebuildDocuments?: boolean } = {}) => {
      logs = []
      return importSite({
        client,
        contentFile: join(dir, 'content.json'),
        publicDir: join(dir, 'public'),
        blocksFile: BLOCKS_FILE,
        publish: false,
        backupDir,
        log: (line) => logs.push(line),
        ...extra,
      })
    }
    const backupDir = join(dir, 'backup')
    const backups = (document: string) =>
      (existsSync(backupDir) ? readdirSync(backupDir) : []).filter((name) =>
        name.startsWith(`${document}-draft-`),
      )
    type Block = { id: string; type: string; props: Record<string, unknown> }
    type Doc = { draft: { blocks: Block[] }; published: unknown }
    const doc = (slug: string) => client.get<Doc>(`${base}/pages/${slug}`)
    const text = (value: unknown) => JSON.stringify(value)
    const staleText = {
      blocks: [
        { id: 'old', type: 'text', props: { title: 'Данные', body: 'На нём нет форм заявок.' } },
      ],
    }

    // Чистый старт: документы первого прогона (опубликованные) убираем
    for (const slug of ['privacy', 'consent']) await client.delete(`${base}/pages/${slug}`)
    const clean = await run()
    expect(clean.rebuiltDocuments).toEqual([])
    expect(clean.repairedDocuments).toEqual([])
    // Ничего не заменялось — страховочных файлов нет
    expect(backups('privacy')).toEqual([])

    // Правка, пометка шаблона ещё на месте (её убирают последней): повторный запуск не стирает
    const fresh = await doc('privacy')
    const first = fresh.draft.blocks[0]
    if (!first) throw new Error('В политике нет блоков')
    const mine: Block = { ...first, id: 'my-edit', props: { ...first.props, title: 'Моя правка' } }
    await client.put(`${base}/pages/privacy`, {
      title: 'Политика',
      content: { blocks: [...fresh.draft.blocks, mine] },
    })
    const second = await run()
    expect(second.rebuiltDocuments).toEqual([])
    expect(second.repairedDocuments).toEqual([])
    expect(text((await doc('privacy')).draft)).toContain('Моя правка')
    expect(text((await doc('privacy')).draft)).toContain('template-note')
    // Черновик не тронут: сообщение нейтральное, не «правили вручную»
    expect(logs.join('\n')).not.toContain('правили вручную')
    expect(logs).toContain('Документ /privacy: черновик есть, не трогаю')
    expect(backups('privacy')).toEqual([])

    // Юрист переписал раздел про форму своими словами (фразы шаблона нет вовсе): это не ложь,
    // повторный запуск без флага черновик не трогает
    const reworded = (value: unknown) =>
      JSON.parse(text(value).replaceAll('форме заявки', 'форме записи на пробный урок'))
    const lawyer = await doc('privacy')
    await client.put(`${base}/pages/privacy`, {
      title: 'Политика',
      content: reworded(lawyer.draft),
    })
    expect((await run()).rebuiltDocuments).toEqual([])
    expect(text((await doc('privacy')).draft)).toContain('форме записи на пробный урок')
    // Слово «форма» в тексте юриста есть («форме записи»): предупреждения нет
    expect(logs.join('\n')).not.toContain('не нашлось слов про форму')

    // Слов про форму нет вовсе («информация», «оформление» и «платформа» не в счёт): скрипт
    // предупреждает, но текст не трогает
    await client.put(`${base}/pages/privacy`, {
      title: 'Политика',
      content: {
        blocks: [
          {
            id: 'lawyer',
            type: 'text',
            props: { title: 'Данные', body: 'Информация, оформление заказа, платформа.' },
          },
        ],
      },
    })
    expect((await run()).repairedDocuments).toEqual([])
    expect(logs.join('\n')).toContain('не нашлось слов про форму')
    expect(text((await doc('privacy')).draft)).toContain('оформление заказа')

    // Черновик, который говорит «форм нет» при форме на сайте (создан старой версией скрипта),
    // чинится по одному блоку: правка юристом другого раздела остаётся
    await client.put(`${base}/pages/privacy`, {
      title: 'Политика',
      content: {
        blocks: [
          ...staleText.blocks,
          { id: 'lawyer', type: 'text', props: { title: 'Хранение', body: 'Храним три года.' } },
        ],
      },
    })
    const third = await run()
    expect(third.rebuiltDocuments).toEqual([])
    expect(third.repairedDocuments).toEqual(['privacy'])
    const repaired = text((await doc('privacy')).draft)
    expect(repaired).toContain('форме заявки')
    expect(repaired).not.toContain('нет форм заявок')
    expect(repaired).toContain('Храним три года.')
    // Блок встал на место ложного: порядок прежний («данные», затем «хранение»)
    expect(repaired.indexOf('"id":"data"')).toBeLessThan(repaired.indexOf('"id":"lawyer"'))
    // Прежний черновик (с ложной фразой и правкой юриста) лежит в файле, а лог говорит где
    const [repairBackup] = backups('privacy')
    expect(backups('privacy')).toHaveLength(1)
    const saved = readFileSync(join(backupDir, repairBackup ?? ''), 'utf8')
    expect(saved).toContain('нет форм заявок')
    expect(saved).toContain('Храним три года.')
    expect(
      logs.some(
        (line) =>
          line.includes('прежний черновик сохранён в') && line.includes(repairBackup ?? '?'),
      ),
    ).toBe(true)

    // Флаг заменяет и правленый черновик целиком: правка без ложной фразы пропадает, пометка
    // шаблона и текст про форму возвращаются
    const edited = await doc('privacy')
    await client.put(`${base}/pages/privacy`, {
      title: 'Политика',
      content: { blocks: [...edited.draft.blocks, { ...mine, id: 'my-edit-2' }] },
    })
    expect(text((await doc('privacy')).draft)).toContain('Моя правка')
    const fourth = await run({ rebuildDocuments: true })
    expect(fourth.rebuiltDocuments).toEqual(['privacy', 'consent'])
    // Затёртая правка осталась в файле: флаг заменяет черновик без возврата, файл — страховка
    const rebuildBackups = backups('privacy').filter((name) => name !== repairBackup)
    expect(rebuildBackups).toHaveLength(1)
    expect(readFileSync(join(backupDir, rebuildBackups[0] ?? ''), 'utf8')).toContain('Моя правка')
    expect(backups('consent')).toHaveLength(1)
    const rebuilt = text((await doc('privacy')).draft)
    expect(rebuilt).not.toContain('Моя правка')
    expect(rebuilt).not.toContain('Храним три года.')
    expect(rebuilt).toContain('template-note')
    expect(rebuilt).toContain('форме заявки')

    // Юрист продублировал блок данных: свой «data» без ложной фразы уже есть, а ложный блок — под
    // другим id. Второй «data» API отверг бы («Id блоков … уникальными»), и каждый запуск падал бы
    // заново и плодил файлы: ложный блок убирается, а не заменяется
    const withOwn = await doc('privacy')
    const ownData = withOwn.draft.blocks.find((block) => block.id === 'data')
    if (!ownData) throw new Error('В свежей политике нет блока data')
    await client.put(`${base}/pages/privacy`, {
      title: 'Политика',
      content: {
        blocks: [
          ...withOwn.draft.blocks,
          {
            id: 'data-copy',
            type: 'text',
            props: { title: 'Данные', body: staleText.blocks[0]?.props.body },
          },
        ],
      },
    })
    const duplicated = await run()
    expect(duplicated.repairedDocuments).toEqual(['privacy'])
    const afterDuplicate = (await doc('privacy')).draft.blocks
    expect(afterDuplicate.filter((block) => block.id === 'data')).toEqual([ownData])
    expect(afterDuplicate.some((block) => block.id === 'data-copy')).toBe(false)
    expect(text(afterDuplicate)).not.toContain('нет форм заявок')
    expect(afterDuplicate.length).toBe(withOwn.draft.blocks.length)
    expect(logs.join('\n')).toContain('свой блок данных в черновике уже есть')
    // Следующий запуск ничего не чинит и не плодит файлы
    const filesBefore = backups('privacy').length
    expect((await run()).repairedDocuments).toEqual([])
    expect(backups('privacy')).toHaveLength(filesBefore)

    // Опубликованный текст юриста без фразы шаблона: не трогаем и не блокируем публикацию сайта
    const published = await doc('privacy')
    await client.put(`${base}/pages/privacy`, {
      title: 'Политика',
      content: reworded(published.draft),
    })
    for (const slug of ['privacy', 'consent']) await client.post(`${base}/pages/${slug}/publish`)
    const lawyerRun = await run({ publish: true })
    expect(lawyerRun.rebuiltDocuments).toEqual([])
    expect(lawyerRun.staleDocuments).toEqual([])
    expect(lawyerRun.published).toBe(true)
    expect(text((await doc('privacy')).draft)).toContain('форме записи на пробный урок')

    // Опубликованная ложная политика: опубликованная версия остаётся, черновик заменён свежим
    // шаблоном, сайт не публикуется, пока человек не опубликует исправленное
    await client.put(`${base}/pages/privacy`, { title: 'Политика', content: staleText })
    for (const slug of ['privacy', 'consent']) await client.post(`${base}/pages/${slug}/publish`)
    const stale = await run({ publish: true })
    expect(stale.repairedDocuments).toEqual(['privacy'])
    expect(stale.staleDocuments).toEqual(['privacy'])
    expect(stale.published).toBe(false)
    // Черновик уже исправлен в этом запуске: совет «запустите с флагом» был бы лишним
    expect(logs.join('\n')).toContain('Черновик уже исправлен в этом запуске')
    expect(logs.join('\n')).not.toContain('--rebuild-documents')
    const after = await doc('privacy')
    expect(text(after.published)).toContain('нет форм заявок')
    expect(text(after.draft)).toContain('форме заявки')

    // Человек опубликовал исправленный черновик — сайт публикуется
    await client.post(`${base}/pages/privacy/publish`)
    const done = await run({ publish: true })
    expect(done.staleDocuments).toEqual([])
    expect(done.published).toBe(true)
  }, 30_000)

  it('связь оборвалась между заменой черновика шаблоном и возвратом текста: текст юриста — в файле', async () => {
    const owner = await api.createUser('owner')
    // Записи черновика документа не доходят: так выглядит пропавшая сеть или перезапуск API
    // сразу после замены — и обратный возврат текста тоже не пройдёт
    let offline = false
    const send = (input: string, init?: RequestInit) => api.app.request(input, init)
    const client = createClient({
      baseUrl: testOrigins.api,
      origin: testOrigins.admin,
      fetch: async (input, init) => {
        if (offline && init?.method === 'PUT' && input.endsWith('/pages/privacy')) {
          throw new TypeError('fetch failed')
        }
        return send(input, init)
      },
    })
    await client.signIn(owner.email, TEST_PASSWORD)
    const base = `/api/sites/${api.demoSiteId}`
    const backupDir = join(dir, 'backup-offline')
    const lawyerText = 'Храним три года, а заявки — один месяц.'
    await client.put(`${base}/pages/privacy`, {
      title: 'Политика',
      content: {
        blocks: [
          { id: 'old', type: 'text', props: { title: 'Данные', body: 'На нём нет форм заявок.' } },
          { id: 'lawyer', type: 'text', props: { title: 'Хранение', body: lawyerText } },
        ],
      },
    })
    offline = true
    await expect(
      importSite({
        client,
        contentFile: join(dir, 'content.json'),
        publicDir: join(dir, 'public'),
        blocksFile: BLOCKS_FILE,
        publish: false,
        backupDir,
      }),
    ).rejects.toThrow('fetch failed')
    // Шаблон стоит поверх правок, но прежний текст не потерян
    const draft = JSON.stringify(
      (await client.get<{ draft: unknown }>(`${base}/pages/privacy`)).draft,
    )
    expect(draft).not.toContain(lawyerText)
    const files = readdirSync(backupDir).filter((name) => name.startsWith('privacy-draft-'))
    expect(files).toHaveLength(1)
    const saved = JSON.parse(readFileSync(join(backupDir, files[0] ?? ''), 'utf8')) as {
      title: string
      content: { blocks: { id: string }[] }
    }
    expect(saved.title).toBe('Политика')
    expect(saved.content.blocks.map((block) => block.id)).toEqual(['old', 'lawyer'])
    expect(JSON.stringify(saved)).toContain(lawyerText)
    // Файл годится для PUT как есть: так текст возвращают
    offline = false
    await client.put(`${base}/pages/privacy`, saved)
    expect(
      JSON.stringify((await client.get<{ draft: unknown }>(`${base}/pages/privacy`)).draft),
    ).toContain(lawyerText)

    // Страховочный файл записать нельзя (вместо папки — обычный файл): замена не начинается, текст
    // юриста остаётся в черновике
    await client.put(`${base}/pages/privacy`, saved)
    const notDirectory = join(dir, 'not-a-directory')
    writeFileSync(notDirectory, 'x')
    await expect(
      importSite({
        client,
        contentFile: join(dir, 'content.json'),
        publicDir: join(dir, 'public'),
        blocksFile: BLOCKS_FILE,
        publish: false,
        backupDir: join(notDirectory, 'backup'),
      }),
    ).rejects.toThrow(/Не удалось сохранить прежний черновик \/privacy.*Ничего не заменено/)
    expect(
      JSON.stringify((await client.get<{ draft: unknown }>(`${base}/pages/privacy`)).draft),
    ).toContain(lawyerText)
  }, 30_000)

  it('повторный запуск обновляет вид, а правки клиента в контенте и текстах шапки не трогает', async () => {
    const client = await ownerClient()
    const base = `/api/sites/${api.demoSiteId}`
    const run = (
      resetContent = false,
      extra: { publish?: boolean; publishDrafts?: boolean } = {},
    ) =>
      importSite({
        client,
        contentFile: join(dir, 'content.json'),
        publicDir: join(dir, 'public'),
        blocksFile: BLOCKS_FILE,
        grainFile: GRAIN,
        siteScriptFile: SITE_SCRIPT,
        publish: false,
        backupDir: join(dir, 'backup'),
        resetContent,
        ...extra,
      })
    type Block = { id: string; type: string; props: Record<string, unknown> }
    type PageState = { title: string; draft: { blocks: Block[] } & Record<string, unknown> }
    const page = (slug: string) => client.get<PageState>(`${base}/pages/${slug}`)
    const draftOf = async (path: string) =>
      (await client.get<{ draft: Record<string, unknown> }>(`${base}/${path}`)).draft
    // Чистая установка: неопубликованного клиентского нет, а второй запуск не принимает свои
    // черновики первого (демо опубликовано, черновик отличается) за правки клиента
    expect((await run()).draftsBefore).toEqual([])
    expect((await run()).draftsBefore).toEqual([])

    // Установка прошлой версии переноса: кнопки без «Открывать в окне», /zapis — не окно, 404 —
    // встроенный первый экран, шапка — стандартная без своего вида, тема — без моно-шрифта
    const home = await page('index')
    const oldBlocks = home.draft.blocks.map((block) => ({
      ...block,
      props: Object.fromEntries(
        Object.entries(block.props).map(([key, value]) => {
          if (typeof value !== 'object' || value === null || !('window' in value)) {
            return [key, value]
          }
          const { window: _drop, ...rest } = value as Record<string, unknown>
          return [key, rest]
        }),
      ),
    }))
    // Клиент поправил текст первого экрана и снял окно у кнопки отзывов
    const hero = oldBlocks.find((block) => block.id === 'top') as Block
    hero.props.title = 'Английский *от клиента*'
    const reviews = oldBlocks.find((block) => block.id === 'reviews') as Block
    reviews.props.cta = { ...(reviews.props.cta as object), window: false }
    await client.put(`${base}/pages/index`, {
      title: home.title,
      content: { ...home.draft, blocks: oldBlocks, seo: { title: 'Свой SEO-заголовок' } },
    })
    const zapis = await page('zapis')
    const { window: _window, ...zapisOld } = zapis.draft
    const formBlock = zapisOld.blocks[0] as Block
    formBlock.props.title = 'Запишись ко мне'
    await client.put(`${base}/pages/zapis`, { title: zapis.title, content: zapisOld })
    await client.put(`${base}/pages/404`, {
      title: 'Страница не найдена',
      content: {
        blocks: [
          {
            id: 'not-found',
            type: 'hero',
            props: {
              title: 'Такой страницы нет',
              subtitle: 'Ой! Возможно, ссылка устарела. Всё самое важное — на главной.',
              button: { label: 'На главную →', href: '/' },
            },
          },
        ],
        shortHeader: true,
      },
    })
    const header = await draftOf('header')
    const menu = (header.menu as Record<string, unknown>[]).map((item, index) =>
      index === 0 ? { ...item, label: 'Мои цели' } : item,
    )
    const { custom: _custom, ...oldHeader } = header
    // Клиент сменил и знак логотипа: шапку прошлого переноса узнаём не по нему
    await client.put(`${base}/header`, {
      ...oldHeader,
      menu,
      logoMark: 'Ле',
      logoText: 'Лера\nEnglish',
      button: { label: 'Хочу урок', page: 'zapis' },
    })
    // Подвал прошлой версии без своего вида, подпись клиент поправил
    const footerNow = await draftOf('footer')
    await client.put(`${base}/footer`, { ...footerNow, custom: null, text: 'See you soon ♡' })
    // Интегратор дописал своё в скрипт сайта набора
    const scriptNow = await client.get<{ draft: { script: string; origins: string[] } }>(
      `${base}/script`,
    )
    const ownScript = `${scriptNow.draft.script}console.log('интегратор')\n`
    await client.put(`${base}/script`, { ...scriptNow.draft, script: ownScript })
    const themeNow = await draftOf('theme')
    await client.put(`${base}/theme`, {
      ...themeNow,
      fonts: { ...(themeNow.fonts as object), mono: undefined },
    })
    // Клиент переименовал сайт, переписал описание, добавил VK и стёр ИНН
    type Settings = {
      name: string
      description: string
      titleTemplate: string
      organization: Record<string, unknown> & { socials: string[] }
    }
    const settingsNow = (await client.get<{ settings: Settings }>(`${base}/settings`)).settings
    const kitSocials = settingsNow.organization.socials
    await client.patch(`${base}/settings`, {
      name: 'Vallex English — Лера',
      description: 'Своё описание сайта',
      titleTemplate: '%s | Лера',
      organization: {
        ...settingsNow.organization,
        name: 'ИП Лера',
        inn: '',
        socials: ['https://vk.com/lera'],
      },
    })

    const again = await run()
    // Черновики, лежавшие до запуска, названы: с --publish они ушли бы на сайт вместе с видом
    expect(again.draftsBefore).toEqual(['страница /index', 'страница /zapis', 'шапка', 'подвал'])
    // Настройки — клиента: название, описание, шаблон заголовка и реквизиты на месте, соцсети —
    // только VK (убранный Telegram набора не возвращается), стёртый ИНН остаётся стёртым
    const settingsAfter = (await client.get<{ settings: Settings }>(`${base}/settings`)).settings
    expect(settingsAfter).toMatchObject({
      name: 'Vallex English — Лера',
      description: 'Своё описание сайта',
      titleTemplate: '%s | Лера',
    })
    expect(settingsAfter.organization.name).toBe('ИП Лера')
    expect(settingsAfter.organization.inn).toBe('')
    expect(settingsAfter.organization.socials).toEqual(['https://vk.com/lera'])
    expect(kitSocials.length).toBeGreaterThan(0)
    expect(again.keptPages).toEqual(['index', 'zapis'])
    const next = (await page('index')).draft
    const nextHero = next.blocks.find((block) => block.id === 'top') as Block
    // Текст клиента на месте, кнопка — в окно; снятый клиентом флажок остался снятым
    expect(nextHero.props.title).toBe('Английский *от клиента*')
    expect(nextHero.props.button).toMatchObject({ href: '/zapis/', window: true })
    const nextReviews = next.blocks.find((block) => block.id === 'reviews') as Block
    expect(nextReviews.props.cta).toMatchObject({ window: false })
    // SEO клиента остался, поля для соцсетей дописаны (в контенте теста их нет — пусто)
    expect(next.seo).toMatchObject({ title: 'Свой SEO-заголовок' })
    // /zapis: форма клиента, страница стала окном
    const nextZapis = (await page('zapis')).draft
    expect((nextZapis.blocks[0] as Block).props.title).toBe('Запишись ко мне')
    expect(nextZapis.window).toMatchObject({ title: 'Попробуем?', width: 'wide' })
    // 404 прошлой версии без правок — заменена своим блоком «Ой!»
    expect((await page('404')).draft.blocks[0]?.type).toBe('custom:le-message')
    // Шапка: тексты клиента, вид — свой, кнопке — окно
    const nextHeader = await draftOf('header')
    expect((nextHeader.menu as { label: string }[])[0]?.label).toBe('Мои цели')
    expect(nextHeader).toMatchObject({
      logoMark: 'Ле',
      logoText: 'Лера\nEnglish',
      button: { label: 'Хочу урок', page: 'zapis', window: true },
      custom: { key: 'le-header' },
    })
    expect(await draftOf('footer')).toMatchObject({
      text: 'See you soon ♡',
      custom: { key: 'le-footer', props: { sign: 'See you soon ♡' } },
    })
    // Дописанный интегратором скрипт не затёрт
    expect((await client.get<{ draft: { script: string } }>(`${base}/script`)).draft.script).toBe(
      ownScript,
    )
    expect(again.siteScriptSaved).toBe(false)

    // Третий запуск: клиент выключил окно у /zapis (админка убирает ключ) — окно не возвращается
    const zapisNow = (await page('zapis')).draft
    const { window: _off, ...zapisNoWindow } = zapisNow
    await client.put(`${base}/pages/zapis`, { title: 'Запись', content: zapisNoWindow })
    // 404 прошлой версии, где клиент поправил только заголовок, — его правка, она остаётся
    await client.put(`${base}/pages/404`, {
      title: 'Страница не найдена',
      content: {
        blocks: [
          {
            id: 'not-found',
            type: 'hero',
            props: {
              title: 'Тут ничего нет',
              subtitle: 'Ой! Возможно, ссылка устарела. Всё самое важное — на главной.',
              button: { label: 'На главную →', href: '/' },
            },
          },
        ],
        shortHeader: true,
      },
    })
    await run()
    expect((await page('zapis')).draft.window).toBeUndefined()
    expect((await page('404')).draft.blocks[0]?.props.title).toBe('Тут ничего нет')
    expect(((await draftOf('theme')).fonts as { mono?: string }).mono).toBe('jetbrains-mono')

    // Публикация: документы опубликованы человеком; правка клиента на главной не опубликована —
    // сайт не публикуется, пока человек не проверит её или не скажет --publish-drafts
    for (const slug of ['privacy', 'consent']) await client.post(`${base}/pages/${slug}/publish`)
    // Клиент проверил и опубликовал остальные правки выше: они больше не черновики
    for (const slug of ['index', 'zapis', '404']) await client.post(`${base}/pages/${slug}/publish`)
    for (const path of ['header', 'footer']) await client.post(`${base}/${path}/publish`)
    const mine = await page('index')
    const mineBlocks = mine.draft.blocks.map((block) =>
      block.id === 'top'
        ? { ...block, props: { ...block.props, title: 'Ещё не закончено' } }
        : block,
    )
    await client.put(`${base}/pages/index`, {
      title: mine.title,
      content: { ...mine.draft, blocks: mineBlocks },
    })
    const logsBlocked: string[] = []
    const blocked = await importSite({
      client,
      contentFile: join(dir, 'content.json'),
      publicDir: join(dir, 'public'),
      blocksFile: BLOCKS_FILE,
      grainFile: GRAIN,
      siteScriptFile: SITE_SCRIPT,
      publish: true,
      backupDir: join(dir, 'backup'),
      log: (line) => logsBlocked.push(line),
    })
    expect(blocked.draftsBefore).toEqual(['страница /index'])
    expect(blocked.published).toBe(false)
    expect(logsBlocked.join(' ')).toContain('--publish-drafts')
    const unfinished = await client.get<{ published: { blocks: Block[] } | null }>(
      `${base}/pages/index`,
    )
    expect(unfinished.published?.blocks.find((block) => block.id === 'top')?.props.title).not.toBe(
      'Ещё не закончено',
    )
    // Блокировку не снимает простой повтор: слитый черновик с правкой клиента не становится «своим»
    const blockedAgain = await importSite({
      client,
      contentFile: join(dir, 'content.json'),
      publicDir: join(dir, 'public'),
      blocksFile: BLOCKS_FILE,
      grainFile: GRAIN,
      siteScriptFile: SITE_SCRIPT,
      publish: true,
      backupDir: join(dir, 'backup'),
      log: () => {},
    })
    expect(blockedAgain.draftsBefore).toEqual(['страница /index'])
    expect(blockedAgain.published).toBe(false)
    const stillUnfinished = await client.get<{ published: { blocks: Block[] } | null }>(
      `${base}/pages/index`,
    )
    expect(
      stillUnfinished.published?.blocks.find((block) => block.id === 'top')?.props.title,
    ).not.toBe('Ещё не закончено')
    // Тот же запуск с флагом публикует и правку клиента
    const forced = await run(false, { publish: true, publishDrafts: true })
    expect(forced.published).toBe(true)
    const done = await client.get<{ published: { blocks: Block[] } }>(`${base}/pages/index`)
    expect(done.published.blocks.find((block) => block.id === 'top')?.props.title).toBe(
      'Ещё не закончено',
    )

    // --reset-content: контент — снова из исходного сайта
    const reset = await run(true)
    expect(reset.keptPages).toEqual([])
    const resetHero = (await page('index')).draft.blocks.find((block) => block.id === 'top')
    expect(resetHero?.props.title).toBe(content.hero.title)
    expect(((await draftOf('header')).menu as { label: string }[])[0]?.label).toBe('Цели')
    // и настройки сайта — тоже из набора
    expect((await client.get<{ settings: Settings }>(`${base}/settings`)).settings.name).toBe(
      'Vallex English',
    )
  })

  it('settingsPatch: повторный запуск не возвращает то, что клиент стёр; дописывает только то, чего нет вовсе', () => {
    const current = {
      name: 'Лера',
      titleTemplate: '',
      language: 'ru',
      description: '',
      ogImage: null,
      icon: 'icon-client',
      redirects: [],
      cookies: {},
      organization: {
        type: 'Organization',
        name: 'ИП Лера',
        email: '',
        inn: '',
        phone: '+7 900 000-00-00',
        socials: ['https://vk.com/lera'],
      },
    }
    const kit = {
      name: 'Vallex English',
      titleTemplate: '%s — Vallex English',
      language: 'ru',
      description: 'Описание',
      ogImage: 'share',
      icon: 'icon-kit',
      organization: {
        name: 'ИП Набор',
        email: 'kit@example.com',
        inn: '1234567890',
        socials: ['https://t.me/lera'],
      },
    }
    // Пустые поля и список соцсетей — выбор клиента: ничего не возвращается, список не объединяется
    expect(settingsPatch(current, kit, true)).toEqual({
      name: 'Лера',
      titleTemplate: '',
      language: 'ru',
      description: '',
      ogImage: null,
      icon: 'icon-client',
      organization: {
        type: 'Organization',
        name: 'ИП Лера',
        email: '',
        inn: '',
        phone: '+7 900 000-00-00',
        socials: ['https://vk.com/lera'],
      },
    })
    // Поля, которых у установки нет вовсе (undefined), набор дописывает
    const bare = { ...current, organization: { type: 'Organization', name: 'ИП Лера' } }
    expect(settingsPatch(bare, kit, true).organization).toMatchObject({
      email: 'kit@example.com',
      inn: '1234567890',
      socials: ['https://t.me/lera'],
    })
    // Первый перенос: значения набора, телефон, вписанный раньше, остаётся
    expect(settingsPatch(current, kit, false)).toMatchObject({
      name: 'Vallex English',
      icon: 'icon-kit',
      organization: { name: 'ИП Набор', phone: '+7 900 000-00-00', socials: ['https://t.me/lera'] },
    })
    // Нет картинок в исходнике — поля не трогаются
    expect(settingsPatch(current, { ...kit, ogImage: null, icon: null }, false)).not.toHaveProperty(
      'icon',
    )
  })

  it('upgradeHome: только флажок окна у кнопок записи и пустые поля соцсетей', () => {
    const draft = {
      blocks: [
        { id: 'top', type: 'custom:le-hero', props: { button: { label: 'A', href: '/zapis' } } },
        { id: 'x', type: 'cta', props: { button: { label: 'B', href: '/zapis/' } } },
        {
          id: 'faq',
          type: 'custom:le-faq',
          props: { aside: { label: 'C', href: 'https://t.me/x' } },
        },
      ],
      seo: { title: 'T', shareTitle: 'Свой' },
    }
    const next = upgradeHome(draft, { shareTitle: 'Наш', shareDescription: 'Описание' })
    expect(next.blocks[0]?.props).toMatchObject({ button: { window: true } })
    // Встроенный блок клиента и внешняя ссылка — как были
    expect(next.blocks[1]).toEqual(draft.blocks[1])
    expect(next.blocks[2]).toEqual(draft.blocks[2])
    expect(next.seo).toEqual({ title: 'T', shareTitle: 'Свой', shareDescription: 'Описание' })
  })

  it('кривой --site-url отвергается до первых изменений', async () => {
    // Проверка — до первого запроса к API: входить не нужно (и лимит попыток входа не тратится)
    const client = createClient({
      baseUrl: testOrigins.api,
      origin: testOrigins.admin,
      fetch: async () => {
        throw new Error('Запрос к API до проверки адреса')
      },
    })
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
