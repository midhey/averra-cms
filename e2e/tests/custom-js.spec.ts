import { form, MAIN_PAGE_SLUG } from '@averra/schema'
import type { Page } from '@playwright/test'
import { urls } from '../urls'
import { expect, sites, test } from './fixtures'

// Свой JS на сайте (решение «Свой JS на сайте»): скрипт своего блока — файлом только на страницах
// с блоком и один раз; скрипт сайта — на каждой странице; CSP без inline; без JS страница работает;
// предпросмотр со скриптами изолирован от сессии админки

const KEY = 'js-cards'

/** Скрипт блока: считает свои запуски и корни, помечает блоки. Без него карточки уже видны */
const BLOCK_SCRIPT = `window.__blockRuns = (window.__blockRuns ?? 0) + 1
for (const block of blocks) block.dataset.enhanced = String(blocks.length)`

/** Проба изоляции: всё, до чего скрипт в предпросмотре мог бы дотянуться, пишется в его страницу */
const PROBE_SCRIPT = `const out = {}
const attempt = async (name, read) => {
  try { out[name] = String(await read()) } catch (error) { out[name] = 'error:' + error.name }
}
await attempt('cookie', () => document.cookie)
await attempt('storage', () => localStorage.length)
await attempt('parent', () => parent.document.title)
await attempt('top', () => { top.location.href = 'about:blank'; return 'navigated' })
await attempt('api', async () => (await fetch('/api/auth/get-session', { credentials: 'include' })).status)
await attempt('apiAbsolute', async () => (await fetch('${urls.admin}/api/auth/get-session', { credentials: 'include' })).status)
const probe = document.createElement('output')
probe.id = 'probe'
probe.textContent = JSON.stringify(out)
document.body.prepend(probe)`

async function createBlock(siteId: string, script: string) {
  const blocks = sites[':siteId']['custom-blocks']
  const param = { siteId, key: KEY }
  expect(
    (await blocks.$post({ param: { siteId }, json: { key: KEY, title: 'Карточки' } })).status,
  ).toBe(201)
  const draft = {
    key: KEY,
    title: 'Карточки',
    description: 'Карточки со ссылкой и скриптом',
    category: 'about' as const,
    fields: [{ type: 'text' as const, name: 'title', label: 'Заголовок', required: true }],
    template: '<h2 class="title">{{ title }}</h2>\n<p><a href="/#contacts">Связаться</a></p>',
    css: '.title { color: var(--color-accent) }',
    script,
    example: { title: 'Карточки' },
  }
  const saved = await blocks[':key'].$put({ param, json: draft })
  expect(saved.status, await saved.clone().text()).toBe(200)
  const view = (await saved.json()) as { draft: unknown }
  const published = await blocks[':key'].publish.$post({
    param,
    json: { draft: view.draft as typeof draft },
  })
  expect(published.status, await published.clone().text()).toBe(200)
}

/** Главная со своим блоком дважды (скрипт — всё равно один раз) и вторая страница без него */
async function placeBlock(siteId: string, extra: unknown[] = []) {
  const pages = sites[':siteId'].pages
  const main = { siteId, slug: MAIN_PAGE_SLUG }
  const current = await pages[':slug'].$get({ param: main })
  const { draft, title } = (await current.json()) as {
    draft: { blocks: unknown[] }
    title: string
  }
  const block = (id: string) => ({ id, type: `custom:${KEY}`, props: { title: `Карточки ${id}` } })
  const content = {
    ...draft,
    blocks: [...draft.blocks, block('cards-a'), block('cards-b'), ...extra],
  }
  expect(
    (await pages[':slug'].$put({ param: main, json: { title, content: content as never } })).status,
  ).toBe(200)
  expect((await pages[':slug'].publish.$post({ param: main })).status).toBe(200)

  const about = { siteId, slug: 'about' }
  expect(
    (await pages.$post({ param: { siteId }, json: { slug: 'about', title: 'О нас' } })).status,
  ).toBe(201)
  const text = { id: 'about-text', type: 'text', props: { title: 'О нас', body: 'Текст' } }
  expect(
    (
      await pages[':slug'].$put({
        param: about,
        json: { title: 'О нас', content: { blocks: [text] } as never },
      })
    ).status,
  ).toBe(200)
  expect((await pages[':slug'].publish.$post({ param: about })).status).toBe(200)
}

/** Все <script> страницы: адрес или «inline» с типом */
const scriptsOf = (page: Page) =>
  page.evaluate(
    `[...document.scripts].map((script) =>
      script.src ? new URL(script.src).pathname : 'inline:' + (script.type || 'text/javascript'))`,
  ) as Promise<string[]>

test('скрипт блока — файлом и один раз, только на странице с блоком; CSP без inline', async ({
  page,
  demoSite,
}) => {
  await createBlock(demoSite.id, BLOCK_SCRIPT)
  await placeBlock(demoSite.id)
  const violations: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/.test(message.text())) {
      violations.push(message.text())
    }
  })

  const response = await page.goto(urls.renderer)
  const csp = response?.headers()['content-security-policy'] ?? ''
  expect(csp).toMatch(/script-src 'self'(;| )/)
  expect(csp).not.toContain('unsafe-eval')
  expect(/script-src ([^;]*)/.exec(csp)?.[1]).not.toContain('unsafe-inline')
  expect(csp).toContain("object-src 'none'")
  expect(csp).toContain("base-uri 'self'")

  // Блок дважды, скрипт выполнился один раз и получил оба корня
  await expect(page.locator(`[data-custom-block="${KEY}"]`)).toHaveCount(2)
  await expect(page.locator(`[data-custom-block="${KEY}"][data-enhanced="2"]`)).toHaveCount(2)
  expect(await page.evaluate('window.__blockRuns')).toBe(1)
  const scripts = await scriptsOf(page)
  expect(scripts.filter((src) => src.startsWith(`/_scripts/block-${KEY}.`))).toHaveLength(1)
  // Ни одного inline-скрипта на всей главной — только данные для поисковиков
  expect(
    scripts.filter((src) => src.startsWith('inline:') && src !== 'inline:application/ld+json'),
  ).toEqual([])
  expect(violations).toEqual([])

  // Страница без блока — без его скрипта
  await page.goto(`${urls.renderer}/about`)
  await expect(page.getByRole('heading', { level: 2, name: 'О нас' })).toBeVisible()
  expect((await scriptsOf(page)).filter((src) => src.startsWith('/_scripts/'))).toEqual([])

  // Файл скрипта — с хешем в имени, отдаётся как JavaScript
  const file = scripts.find((src) => src.startsWith(`/_scripts/block-${KEY}.`)) ?? ''
  expect(file).toMatch(/\.[0-9a-f]{10}\.js$/)
  const res = await page.request.get(`${urls.renderer}${file}`)
  expect(res.headers()['content-type']).toContain('text/javascript')
})

test('скрипт сайта — на каждой странице, ошибка в нём не ломает скрипт блока; <script> в тексте не выполняется', async ({
  page,
  demoSite,
}) => {
  const siteId = demoSite.id
  await createBlock(siteId, BLOCK_SCRIPT)
  await placeBlock(siteId)
  // Текстовый блок с «скриптом» в тексте: он выводится текстом
  const about = { siteId, slug: 'about' }
  const injected =
    '<script>window.__injected = 1</script><img src=x onerror="window.__injected = 2">'
  expect(
    (
      await sites[':siteId'].pages[':slug'].$put({
        param: about,
        json: {
          title: 'О нас',
          content: {
            blocks: [{ id: 'about-text', type: 'text', props: { title: 'О нас', body: injected } }],
          },
        },
      })
    ).status,
  ).toBe(200)
  expect((await sites[':siteId'].pages[':slug'].publish.$post({ param: about })).status).toBe(200)

  // Скрипт сайта падает сразу после пометки: страница и скрипт блока живут
  const script = sites[':siteId'].script
  const draft = {
    script: "document.documentElement.dataset.siteScript = 'ran'\nthrow new Error('сломался')",
    origins: [],
  }
  expect((await script.$put({ param: { siteId }, json: draft })).status).toBe(200)
  const published = await script.publish.$post({ param: { siteId }, json: { draft } })
  expect(published.status, await published.clone().text()).toBe(200)

  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(urls.renderer)
  await expect(page.locator('html[data-site-script="ran"]')).toHaveCount(1)
  await expect(page.locator(`[data-custom-block="${KEY}"][data-enhanced="2"]`)).toHaveCount(2)
  expect(errors.some((text) => text.includes('Ошибка в скрипте сайта'))).toBe(true)

  await page.goto(`${urls.renderer}/about`)
  await expect(page.locator('html[data-site-script="ran"]')).toHaveCount(1)
  await expect(
    page.getByText('<script>window.__injected = 1</script>', { exact: false }),
  ).toBeVisible()
  expect(await page.evaluate('window.__injected')).toBeUndefined()
})

test('без JavaScript: блок со скриптом виден, ссылка ведёт, форма на месте — на 1440 и 375', async ({
  browser,
  demoSite,
}, testInfo) => {
  await createBlock(demoSite.id, BLOCK_SCRIPT)
  await placeBlock(demoSite.id, [{ id: 'form-1', type: 'form', props: form.example }])
  for (const width of [1440, 375]) {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width, height: 900 },
    })
    const page = await context.newPage()
    await page.goto(urls.renderer)
    const block = page.locator(`[data-custom-block="${KEY}"]`).first()
    await expect(block.getByRole('heading', { level: 2, name: 'Карточки cards-a' })).toBeVisible()
    await expect(block).not.toHaveAttribute('data-enhanced')
    await expect(block.getByRole('link', { name: 'Связаться' })).toHaveAttribute(
      'href',
      '/#contacts',
    )
    // Форма — обычная HTML-форма в API: без JS она уходит сама (отправку проверяет forms.spec.ts)
    const lead = page.getByRole('form', { name: form.example.title })
    await expect(lead).toBeVisible()
    await expect(lead).toHaveAttribute('method', 'post')
    await expect(lead).toHaveAttribute('action', /\/api\/forms\//)
    const overflow = await page.evaluate(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    )
    expect(overflow, `горизонтальная прокрутка на ${width}`).toBeLessThanOrEqual(0)
    await block.screenshot({ path: testInfo.outputPath(`custom-js-nojs-${width}.png`) })
    await context.close()
  }
})

test('предпросмотр со скриптом изолирован: ни cookie, ни хранилища, ни /api, ни окна админки', async ({
  page,
  demoSite,
}) => {
  await createBlock(demoSite.id, PROBE_SCRIPT)
  await page.goto(`/blocks/${KEY}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Карточки' })).toBeVisible()
  // Вкладка «Скрипт» показывает код блока
  await page.getByRole('tab', { name: /^Скрипт/ }).click()
  await expect(page.getByRole('textbox', { name: 'Скрипт блока' })).toHaveValue(/attempt\('cookie'/)

  // Обычный предпросмотр скрипт не выполняет
  const plain = page.frameLocator('iframe[title="Предпросмотр своего блока"]')
  await expect(plain.getByRole('heading', { name: 'Карточки' })).toBeVisible()
  await expect(plain.locator('#probe')).toHaveCount(0)

  await page.getByRole('checkbox', { name: 'Выполнять скрипт' }).check()
  const frame = page.locator('iframe[data-sandbox-preview]')
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
  const probe = page.frameLocator('iframe[data-sandbox-preview]').locator('#probe')
  await expect(probe).toHaveCount(1)
  const result = JSON.parse((await probe.textContent()) ?? '{}') as Record<string, string>
  expect(result.cookie).toMatch(/^error:SecurityError$/)
  expect(result.storage).toMatch(/^error:SecurityError$/)
  expect(result.parent).toMatch(/^error:SecurityError$/)
  expect(result.api).toMatch(/^error:/)
  expect(result.apiAbsolute).toMatch(/^error:/)
  // Админка на месте: окно не ушло, сессия жива
  await expect(page).toHaveURL(new RegExp(`/blocks/${KEY}$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Карточки' })).toBeVisible()
})

test('скрипт сайта в админке: черновик → предпросмотр со скриптом → публикация', async ({
  page,
}, testInfo) => {
  await page.goto('/script')
  await expect(page.getByRole('heading', { level: 1, name: 'Скрипт сайта' })).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Скрипт', exact: true })
    .fill("document.body.dataset.siteScript = 'preview'\neval('1')")
  // Совет: eval запретит CSP сайта
  await expect(page.getByText(/eval на сайте запрещён/)).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Домены внешних скриптов' })
    .fill('https://a.ru; script-src *')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Не сохранить: поправьте домены')).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Домены внешних скриптов' })
    .fill('https://widget.example.ru')

  await page.getByRole('checkbox', { name: 'Выполнять скрипты' }).check()
  await expect(
    page.frameLocator('iframe[data-sandbox-preview]').locator('body[data-site-script="preview"]'),
  ).toHaveCount(1)

  await page.screenshot({ path: testInfo.outputPath('site-script-1440.png'), fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByRole('checkbox', { name: 'Выполнять скрипты' })).toBeChecked()
  const overflow = await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )
  expect(overflow, 'экран на 375 px без прокрутки вбок').toBeLessThanOrEqual(0)
  await page.screenshot({ path: testInfo.outputPath('site-script-375.png'), fullPage: true })
  // Рамка со скриптами — отдельным снимком: снимок всей страницы не всегда захватывает её содержимое
  await page
    .locator('iframe[data-sandbox-preview]')
    .screenshot({ path: testInfo.outputPath('site-script-375-frame.png') })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByText('Опубликовано: сайт пересобирается')).toBeVisible()
  const response = await page.goto(urls.renderer)
  expect(response?.headers()['content-security-policy']).toContain('https://widget.example.ru')
  await expect(page.locator('body[data-site-script="preview"]')).toHaveCount(1)
})
