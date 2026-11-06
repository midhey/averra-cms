import type { Browser, Page } from '@playwright/test'
import { urls } from '../urls'
import { expect, sites, test } from './fixtures'

// Свои шапка и подвал (шаг 4.15): свой блок с местом «шапка» и «подвал» вместо стандартных. Шаблон
// получает меню, кнопку, логотип и «Организацию» данными; CSS и скрипт определения достают до своей
// шапки; без JS меню телефона открывается (<details>), с JS Esc его закрывает и шапка собирается
// при прокрутке; ссылки на документы Averra дописывает сама. Редактор страницы показывает черновую
// шапку с подписью, выбор «Стандартная» возвращает стандартную. Шапку, подвал и свои блоки демо-
// сайта после теста убирает фикстура

const HEADER_KEY = 'own-header'
const FOOTER_KEY = 'own-footer'

/** Скрипт своей шапки: метка на корне — значит, скрипт получил корень шапки (C7) */
const HEADER_SCRIPT = "for (const root of blocks) root.dataset.enhanced = 'yes'"

type Param = { siteId: string }

/** Свой блок с местом из заготовки: создать, дописать скрипт, опубликовать */
async function createPlace(param: Param, key: string, placement: 'header' | 'footer', script = '') {
  const custom = sites[':siteId']['custom-blocks']
  const created = await custom.$post({
    param,
    json: { key, title: placement === 'header' ? 'Своя шапка' : 'Свой подвал', placement },
  })
  expect(created.status, await created.clone().text()).toBe(201)
  const { draft } = (await created.json()) as { draft: Record<string, unknown> }
  const saved = await custom[':key'].$put({
    param: { ...param, key },
    json: { ...draft, script } as never,
  })
  expect(saved.status, await saved.clone().text()).toBe(200)
  const view = (await saved.json()) as { draft: unknown }
  const published = await custom[':key'].publish.$post({
    param: { ...param, key },
    json: { draft: view.draft as never },
  })
  expect(published.status, await published.clone().text()).toBe(200)
}

/** Сайт со своими шапкой и подвалом: страницы меню, политика, «Организация», cookie */
async function customSite(siteId: string) {
  const param = { siteId }
  const pages = sites[':siteId'].pages
  const legal = await sites[':siteId'].settings['legal-pages'].$post({
    param,
    json: { document: 'privacy' },
  })
  expect(legal.status).toBe(201)
  expect(
    (await pages[':slug'].publish.$post({ param: { ...param, slug: 'privacy' } })).status,
  ).toBe(200)
  const settings = await sites[':siteId'].settings.$patch({
    param,
    json: {
      analytics: { metrika: '12345678' },
      cookies: { policyPage: 'privacy' },
      organization: { name: 'ИП Иванов', phone: '+7 900 000-00-00', inn: '590000000000' },
    },
  })
  expect(settings.status).toBe(200)
  for (const [slug, title, shortHeader] of [
    ['about', 'О нас', false],
    ['spasibo', 'Спасибо', true],
  ] as const) {
    const saved = await pages[':slug'].$put({
      param: { ...param, slug },
      json: {
        title,
        content: {
          blocks: [{ id: 'hero', type: 'hero', props: { title } }],
          ...(shortHeader ? { shortHeader: true } : {}),
        },
      },
    })
    expect(saved.status, await saved.clone().text()).toBe(200)
    expect((await pages[':slug'].publish.$post({ param: { ...param, slug } })).status).toBe(200)
  }

  await createPlace(param, HEADER_KEY, 'header', HEADER_SCRIPT)
  await createPlace(param, FOOTER_KEY, 'footer')
  const header = sites[':siteId'].header
  const savedHeader = await header.$put({
    param,
    json: {
      condense: true,
      menu: [
        { label: 'Преимущества', page: 'index', block: 'benefits' },
        { label: 'О нас', page: 'about', mobileLabel: 'Мы' },
        { label: 'Telegram', url: 'https://t.me/remont' },
      ],
      button: { label: 'Оставить заявку', page: 'index', block: 'contact' },
      brand: 'text',
      logoMark: 'Ре',
      custom: { key: HEADER_KEY, props: { tagline: 'с 2010 года' } },
    },
  })
  expect(savedHeader.status, await savedHeader.clone().text()).toBe(200)
  expect((await header.publish.$post({ param })).status).toBe(200)
  const footer = sites[':siteId'].footer
  const savedFooter = await footer.$put({
    param,
    json: { custom: { key: FOOTER_KEY, props: { note: 'See you in class' } } },
  })
  expect(savedFooter.status, await savedFooter.clone().text()).toBe(200)
  expect((await footer.publish.$post({ param })).status).toBe(200)
}

async function visitor(browser: Browser, width: number, javaScriptEnabled: boolean) {
  const context = await browser.newContext({
    locale: 'ru-RU',
    javaScriptEnabled,
    storageState: { cookies: [], origins: [] },
    viewport: { width, height: width < 768 ? 812 : 900 },
  })
  return { context, page: await context.newPage() }
}

const noHorizontalScroll = async (page: Page) =>
  (await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )) === 0

test('своя шапка и подвал на сайте: данные, CSS и скрипт, меню без JS, Esc, документы', async ({
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  await customSite(demoSite.id)

  // ── 1440, с JS ──────────────────────────────────────────────────────────────────────────────
  const wide = await visitor(browser, 1440, true)
  await wide.page.goto(`${urls.renderer}/about/`)
  const header = wide.page.locator('header[data-site-header]')
  await expect(header).toHaveAttribute('data-custom-block', HEADER_KEY)
  await expect(header).toHaveAttribute('data-sticky', '')
  // Скрипт определения получил корень шапки
  await expect(header).toHaveAttribute('data-enhanced', 'yes')
  await expect(header.locator('.tagline')).toHaveText('с 2010 года')
  await expect(header.locator('.mark')).toHaveText('Ре')
  const nav = header.locator('nav.nav')
  await expect(nav).toBeVisible()
  await expect(nav.getByRole('link')).toHaveText(['Преимущества', 'О нас', 'Telegram'])
  await expect(nav.getByRole('link', { name: 'О нас' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Telegram' })).toHaveAttribute('target', '_blank')
  await expect(nav.getByRole('link', { name: 'Преимущества' })).toHaveAttribute(
    'href',
    '/#benefits',
  )
  await expect(header.getByRole('link', { name: 'Оставить заявку' })).toHaveAttribute(
    'href',
    '/#contact',
  )
  // CSS определения: на широком экране меню строкой, <details> телефона скрыт
  await expect(header.locator('details.menu')).toBeHidden()
  await expect(wide.page.getByRole('link', { name: 'К содержимому' })).toHaveAttribute(
    'href',
    '#content',
  )
  // Подвал: подпись из поля, контакты из «Организации», документы — строкой Averra
  const footer = wide.page.locator('footer[data-site-footer]')
  await expect(footer).toHaveAttribute('data-custom-block', FOOTER_KEY)
  await expect(footer.locator('.note')).toHaveText('See you in class')
  await expect(footer.getByRole('link', { name: '+7 900 000-00-00' })).toHaveAttribute(
    'href',
    'tel:+79000000000',
  )
  const legal = footer.locator('[data-legal-footer]')
  await expect(legal.getByRole('link', { name: 'Политика конфиденциальности' })).toBeVisible()
  await expect(legal.getByRole('button', { name: 'Настройки cookie' })).toBeVisible()
  expect(await noHorizontalScroll(wide.page)).toBe(true)
  await wide.page.screenshot({ path: testInfo.outputPath('site-1440.png'), fullPage: true })
  // Сборка при прокрутке — на корне своей шапки (главная длиннее экрана)
  await wide.page.goto(`${urls.renderer}/`)
  await wide.page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  await expect(header).toHaveAttribute('data-condensed', '')
  await expect(header.locator('.tagline')).toBeHidden()
  await wide.context.close()

  // ── 375, с JS: меню в <details>, Esc закрывает и возвращает фокус ───────────────────────────
  const phone = await visitor(browser, 375, true)
  await phone.page.goto(`${urls.renderer}/`)
  const summary = phone.page.locator('header[data-site-header] summary')
  await expect(summary).toBeVisible()
  await summary.click()
  const panel = phone.page.locator('header[data-site-header] nav.panel')
  await expect(panel.getByRole('link', { name: 'Мы' })).toBeVisible()
  await phone.page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(summary).toBeFocused()
  // Заготовка: липкая шапка на телефоне не выше общего отступа якорей (7rem = 112px), цели касания
  // — от 44px, раскрытое меню не длиннее экрана
  const phoneHeader = phone.page.locator('header[data-site-header]')
  expect((await phoneHeader.boundingBox())?.height ?? 999).toBeLessThanOrEqual(112)
  expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  await summary.click()
  expect(
    (await panel.getByRole('link', { name: 'Мы' }).boundingBox())?.height ?? 0,
  ).toBeGreaterThanOrEqual(44)
  expect(
    await panel.evaluate(
      (node) =>
        node.getBoundingClientRect().bottom <= (node.ownerDocument.defaultView?.innerHeight ?? 0),
    ),
  ).toBe(true)
  await summary.click()
  expect(await noHorizontalScroll(phone.page)).toBe(true)
  await phone.page.screenshot({ path: testInfo.outputPath('site-375.png'), fullPage: true })
  await phone.context.close()

  // ── 375, без JS: меню открывается, пункт ведёт к блоку ──────────────────────────────────────
  const plain = await visitor(browser, 375, false)
  await plain.page.goto(`${urls.renderer}/`)
  const plainSummary = plain.page.locator('header[data-site-header] summary')
  await plainSummary.click()
  const link = plain.page.locator('header[data-site-header] nav.panel').getByRole('link', {
    name: 'Преимущества',
  })
  await expect(link).toBeVisible()
  await plain.page.screenshot({ path: testInfo.outputPath('site-375-nojs-menu.png') })
  await link.click()
  await expect(plain.page).toHaveURL(/#benefits$/)
  // Документы на месте и без JS; «Настройки cookie» без скрипта не показываются
  const plainLegal = plain.page.locator('footer[data-site-footer] [data-legal-footer]')
  await expect(plainLegal.getByRole('link', { name: 'Политика конфиденциальности' })).toBeVisible()
  await expect(plainLegal.getByRole('button', { name: 'Настройки cookie' })).toBeHidden()
  expect(await noHorizontalScroll(plain.page)).toBe(true)

  // Служебная страница: та же своя шапка, без меню и кнопки, с дорогой на главную
  await plain.page.goto(`${urls.renderer}/spasibo/`)
  const short = plain.page.locator('header[data-site-header]')
  await expect(short).toHaveAttribute('data-custom-block', HEADER_KEY)
  await expect(short.getByRole('link', { name: '← На главную' })).toHaveAttribute('href', '/')
  await expect(short.locator('nav')).toHaveCount(0)
  await plain.context.close()
})

test('редактор показывает черновую шапку; «Стандартная» возвращает стандартную', async ({
  page,
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  await customSite(demoSite.id)

  // Тексты своего вида правят в «Шапка и подвал»: черновик, без публикации
  await page.goto('/header')
  const kind = page.getByRole('combobox', { name: 'Вид шапки' })
  await expect(kind).toHaveValue(HEADER_KEY)
  // Настройки вида стандартной шапки своей не нужны
  await expect(page.getByRole('heading', { name: 'Раскладка' })).toHaveCount(0)
  const tagline = page.getByLabel('Подпись под логотипом')
  await tagline.fill('ремонт с душой')
  const preview = page.frameLocator('iframe[title="Предпросмотр шапки"]')
  await expect(preview.locator(`header[data-custom-block="${HEADER_KEY}"] .tagline`)).toHaveText(
    'ремонт с душой',
  )
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Шапка сохранена')).toBeVisible()
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('admin-header-1440.png'), fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('admin-header-375.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })

  // B12: редактор страницы — с черновой шапкой и подписью, какая она
  await page.goto('/pages/index')
  const editorPreview = page.frameLocator('iframe[title="Предпросмотр страницы"]')
  await expect(
    editorPreview.locator(`header[data-custom-block="${HEADER_KEY}"] .tagline`),
  ).toHaveText('ремонт с душой')
  await expect(editorPreview.locator(`footer[data-custom-block="${FOOTER_KEY}"]`)).toBeVisible()
  await expect(page.getByText(/Шапка показана черновиком/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('admin-editor-1440.png') })

  // Откат: «Стандартная» — и на сайте снова стандартная шапка
  await page.goto('/header')
  await page.getByRole('combobox', { name: 'Вид шапки' }).selectOption('')
  await expect(page.getByRole('heading', { name: 'Раскладка' })).toBeVisible()
  await expect(preview.locator('header[data-site-header]')).not.toHaveAttribute('data-custom-block')
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click()
  await expect(page.getByText(/Шапка опубликована/)).toBeVisible()
  const visit = await visitor(browser, 1440, true)
  await visit.page.goto(`${urls.renderer}/`)
  const header = visit.page.locator('header[data-site-header]')
  await expect(header).not.toHaveAttribute('data-custom-block')
  await expect(header.locator('details[data-header-menu]')).toHaveCount(1)
  // Подвал свой — у него своя публикация
  await expect(visit.page.locator('footer[data-site-footer]')).toHaveAttribute(
    'data-custom-block',
    FOOTER_KEY,
  )
  await visit.context.close()
})

test('свой подвал создают в «Свои блоки»: место, заготовка, предпросмотр на образце', async ({
  page,
}, testInfo) => {
  await page.goto('/blocks')
  await page.getByRole('button', { name: 'Создать блок' }).first().click()
  const create = page.getByRole('dialog', { name: 'Новый свой блок' })
  await create.getByRole('radio', { name: 'Подвал сайта' }).check()
  await expect(create.getByText(/Ссылки на политику, согласие и «Настройки cookie»/)).toBeVisible()
  await create.getByLabel('Название').fill('Мой подвал')
  await create.getByLabel('Ключ').fill('my-footer')
  await create.getByRole('button', { name: 'Создать' }).click()
  await expect(page).toHaveURL(/\/blocks\/my-footer$/)

  // Предпросмотр — страница-образец с подвалом: меню, контакты «Организации» и строка документов
  const preview = page.frameLocator('iframe[title="Предпросмотр своего блока"]')
  const footer = preview.locator('footer[data-custom-block="my-footer"]')
  await expect(footer.getByRole('link', { name: 'Услуги' })).toBeVisible()
  await expect(footer.getByRole('link', { name: '+7 900 000-00-00' })).toBeVisible()
  await expect(
    footer
      .locator('[data-legal-footer]')
      .getByRole('link', { name: 'Политика конфиденциальности' }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('admin-block-footer-1440.png') })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await noHorizontalScroll(page)).toBe(true)

  // В каталоге «Добавить блок» редактора страницы своего подвала нет: на страницу его не ставят
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByText(/Опубликовано/).first()).toBeVisible()
  await page.goto('/pages/index')
  await page.getByRole('button', { name: 'Добавить блок' }).click()
  const catalog = page.getByRole('dialog', { name: /Добавить блок/ })
  await expect(catalog.getByText('Мой подвал')).toHaveCount(0)
})

test('определение поменяли — публикация называет шапку, «Шапка и подвал» — поле', async ({
  page,
  browser,
  demoSite,
}) => {
  test.slow()
  await customSite(demoSite.id)
  // Поле подписи стало числом: опубликованная подпись «с 2010 года» ему больше не подходит
  const custom = sites[':siteId']['custom-blocks']
  const param = { siteId: demoSite.id, key: HEADER_KEY }
  const current = (await (await custom[':key'].$get({ param })).json()) as {
    draft: Record<string, unknown>
  }
  const saved = await custom[':key'].$put({
    param,
    json: {
      ...current.draft,
      fields: [{ type: 'number', name: 'tagline', label: 'Год' }],
    } as never,
  })
  expect(saved.status, await saved.clone().text()).toBe(200)

  await page.goto(`/blocks/${HEADER_KEY}`)
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click()
  await expect(
    page.getByText(/Шапка сайта: поля своего вида не подходят \(поле «tagline»\)/),
  ).toBeVisible()
  await expect(page.getByText(/блок есть в каталоге редактора/)).toHaveCount(0)

  await page.goto('/header')
  await expect(page.getByText(/Тексты не подходят под поля своего вида/)).toBeVisible()

  // На сайте — стандартная шапка, и от своей ничего не осталось: ни метки липкой своей шапки, ни
  // её CSS, ни её скрипта
  const visit = await visitor(browser, 1440, true)
  await visit.page.goto(`${urls.renderer}/`)
  await expect(visit.page.locator('header[data-site-header]')).not.toHaveAttribute(
    'data-custom-block',
  )
  await expect(visit.page.locator('html')).not.toHaveAttribute('data-sticky-header', 'custom')
  await expect(visit.page.locator(`script[src*="block-${HEADER_KEY}."]`)).toHaveCount(0)
  expect(await visit.page.content()).not.toContain(`[data-custom-block="${HEADER_KEY}"]`)
  // Свой подвал на месте: его определение не меняли
  await expect(visit.page.locator('footer[data-site-footer]')).toHaveAttribute(
    'data-custom-block',
    FOOTER_KEY,
  )
  await visit.context.close()
})
