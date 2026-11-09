import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Locator, Page } from '@playwright/test'
import { publishDir } from '../urls'
import { expect, sites, test } from './fixtures'
import { serveRelease } from './release-server'

// Настройки стандартных шапки и подвала (шаг 4.13): владелец в админке ставит логотип текстом,
// кнопку с текстом для телефона «в строке шапки», вид кнопки и пунктов, меню во весь экран,
// внешний пункт, подвал «как у страницы» со своим текстом и согласием; служебная страница — с
// короткой шапкой. На собранном сайте (папка релиза, как её отдаёт Caddy) — на 1440 и 375 px, с JS
// и без: что видно, куда ведёт, замер наведения и фокуса кнопки, подвал у низа короткой страницы.
// Администратор сайта видит вид только для чтения. Шапку и подвал после теста убирает фикстура

const release = (siteId: string) => join(publishDir, siteId, 'current')

async function servedHtml(siteId: string, slug = '') {
  const file = join(release(siteId), slug, 'index.html')
  return existsSync(file) ? readFile(file, 'utf8') : ''
}

async function visitor(
  browser: Browser,
  width: number,
  javaScriptEnabled: boolean,
  reducedMotion: 'reduce' | 'no-preference' = 'no-preference',
) {
  const context = await browser.newContext({
    locale: 'ru-RU',
    javaScriptEnabled,
    reducedMotion,
    viewport: { width, height: width < 768 ? 812 : 900 },
  })
  return { context, page: await context.newPage() }
}

const noHorizontalScroll = async (page: Page) =>
  (await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )) === 0

/** Контраст двух цветов rgb(…) из getComputedStyle — по WCAG */
function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const [r = 0, g = 0, bl = 0] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number)
    const linear = (value: number) => {
      const c = value / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(bl)
  }
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** getComputedStyle страницы: у e2e нет типов DOM, функция выполняется в браузере */
type StyleWindow = {
  getComputedStyle: (node: unknown) => { getPropertyValue: (name: string) => string }
}

const styleOf = (locator: Locator, props: string[]) =>
  locator.evaluate((node, names) => {
    const style = (globalThis as unknown as StyleWindow).getComputedStyle(node)
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]))
  }, props)

/** Рамки не пересекаются */
type Box = { x: number; y: number; width: number; height: number }
const apart = (a: Box, b: Box) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y

test('настройки шапки и подвала: админка → сайт на 1440 и 375, с JS и без', async ({
  page,
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  const param = { siteId: demoSite.id }
  // Согласие — опубликованная страница из шаблона: на неё ссылается подвал
  const legal = await sites[':siteId'].settings['legal-pages'].$post({
    param,
    json: { document: 'consent' },
  })
  expect(legal.status).toBe(201)
  const consent = await sites[':siteId'].pages[':slug'].publish.$post({
    param: { ...param, slug: 'consent' },
  })
  expect(consent.status).toBe(200)
  // Служебная страница «Спасибо» с короткой шапкой — короткая, подвал должен быть у низа окна
  const thanks = await sites[':siteId'].pages[':slug'].$put({
    param: { ...param, slug: 'spasibo' },
    json: {
      title: 'Спасибо',
      content: {
        blocks: [{ id: 'thanks', type: 'text', props: { title: 'Спасибо!', body: 'Перезвоним.' } }],
        shortHeader: true,
        seo: { noindex: true },
      },
    },
  })
  expect(thanks.status).toBe(200)
  expect(
    (await sites[':siteId'].pages[':slug'].publish.$post({ param: { ...param, slug: 'spasibo' } }))
      .status,
  ).toBe(200)

  // ── Админка: шапка ──────────────────────────────────────────────────────────────────────────
  await page.goto('/header')
  await expect(page.getByRole('heading', { name: 'Шапка и подвал', level: 1 })).toBeVisible()
  await page.getByRole('radio', { name: 'Текст', exact: true }).check()
  await page.getByRole('textbox', { name: 'Знак', exact: true }).fill('Ре')
  await page.getByRole('textbox', { name: 'Подпись', exact: true }).fill('Ремонт\nу Ивана')
  await page.getByRole('checkbox', { name: 'Кнопка в шапке' }).check()
  await page.getByRole('textbox', { name: 'Текст кнопки' }).fill('Рассчитать стоимость')
  await page.getByRole('textbox', { name: 'Текст на телефоне' }).fill('Расчёт')
  await page.getByRole('checkbox', { name: 'Линия под шапкой' }).uncheck()
  await page.getByRole('radio', { name: 'Таблетка' }).check()
  await page.getByRole('radio', { name: 'Цвет и подъём' }).check()
  await page.getByRole('radio', { name: 'Цвет акцента' }).check()
  await page.getByRole('radio', { name: 'В строке шапки' }).check()
  await page.getByRole('radio', { name: 'Во весь экран' }).check()
  await page.getByRole('radio', { name: 'По центру', exact: true }).check()
  // Предпросмотр — настоящая шапка: знак и подпись логотипа
  const preview = page.frameLocator('iframe[title="Предпросмотр шапки"]')
  await expect(preview.locator('header [data-part="mark"]')).toHaveText('Ре')

  // Меню: пункт с подписью для телефона и внешняя ссылка — новая вкладка по умолчанию
  await page.getByRole('tab', { name: 'Меню' }).click()
  const items = page.getByRole('list', { name: 'Пункты меню' }).getByRole('listitem')
  await page.getByRole('button', { name: 'Пункт меню', exact: true }).click()
  await items.nth(0).getByRole('textbox', { name: 'Подпись', exact: true }).fill('Почему мы')
  await items
    .nth(0)
    .getByRole('textbox', { name: 'Подпись на телефоне' })
    .fill('Почему выбирают нас')
  await items.nth(0).getByRole('combobox', { name: 'Куда ведёт' }).selectOption('index#benefits')
  await expect(
    items.nth(0).getByRole('checkbox', { name: 'Открывать в новой вкладке' }),
  ).not.toBeChecked()
  await page.getByRole('button', { name: 'Пункт меню', exact: true }).click()
  await items.nth(1).getByRole('textbox', { name: 'Подпись', exact: true }).fill('Telegram')
  await items.nth(1).getByRole('combobox', { name: 'Куда ведёт' }).selectOption('~url')
  // Кривой адрес — ошибка у поля, публикации не будет
  const link = items.nth(1).getByRole('textbox', { name: 'Ссылка' })
  await link.fill('javascript:alert(1)')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Шапку не сохранить: поправьте отмеченные поля')).toBeVisible()
  await expect(link).toBeFocused()
  await link.fill('https://t.me/remont')
  await expect(
    items.nth(1).getByRole('checkbox', { name: 'Открывать в новой вкладке' }),
  ).toBeChecked()
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click()
  await expect(page.getByText(/Шапка опубликована/)).toBeVisible()

  // ── Админка: подвал ─────────────────────────────────────────────────────────────────────────
  await page.getByRole('tab', { name: 'Подвал' }).click()
  // «Разделы» подвала с колонками — те же пункты меню: внешний и тут в новой вкладке
  await page.getByRole('radio', { name: /^С колонками/ }).check()
  const sections = page
    .frameLocator('iframe[title="Предпросмотр подвала"]')
    .getByRole('navigation', { name: 'Разделы сайта' })
  const sectionTelegram = sections.getByRole('link', { name: /^Telegram/ })
  await expect(sectionTelegram).toHaveAttribute('target', '_blank')
  await expect(sectionTelegram).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(sectionTelegram).toHaveText('Telegram (откроется в новой вкладке)')
  await expect(sections.getByRole('link', { name: 'Почему мы' })).not.toHaveAttribute('target')
  await page.getByRole('radio', { name: /^Простой/ }).check()
  await page.getByRole('radio', { name: 'Как у страницы' }).check()
  await page.getByRole('checkbox', { name: 'Линия над подвалом' }).uncheck()
  await page.getByRole('textbox', { name: 'Свой текст' }).fill('Работаем с 9 до 18\nбез выходных')
  await page.getByRole('radio', { name: 'Акцентный' }).check()
  await page.getByRole('checkbox', { name: '© и год' }).uncheck()
  const consentBox = page.getByRole('checkbox', { name: 'Ссылка на согласие на обработку данных' })
  await consentBox.check()
  await expect(page.getByText('Рядом с политикой — ссылка на /consent/')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Логотип шапки в подвале' }).check()
  const footerPreview = page.frameLocator('iframe[title="Предпросмотр подвала"]').locator('footer')
  await expect(footerPreview.getByRole('link', { name: /^Согласие на обработку/ })).toBeVisible()
  await page.getByRole('button', { name: 'Опубликовать подвал' }).click()
  await expect(page.getByText(/Подвал опубликован/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('admin-footer-1440.png'), fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('admin-footer-375.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })

  // Редактор страницы: у «Спасибо» шапка короткая
  await page.goto('/pages/spasibo')
  await page.getByRole('button', { name: /^SEO/ }).click()
  await expect(page.getByRole('radio', { name: /^Короткая/ })).toBeChecked()

  // На главной «Короткая» не действует: варианта нет, рядом пояснение
  await page.goto('/pages/index')
  await page.getByRole('button', { name: /^SEO/ }).click()
  await expect(page.getByRole('radio', { name: /^Полная/ })).toBeChecked()
  await expect(page.getByRole('radio', { name: /^Короткая/ })).toHaveCount(0)
  await expect(page.getByText('На главной короткой шапки нет')).toBeVisible()

  // ── Сайт ────────────────────────────────────────────────────────────────────────────────────
  await expect
    .poll(
      async () => {
        const html = await servedHtml(demoSite.id)
        return html.includes('data-mobile-button') && html.includes('Работаем с 9 до 18')
      },
      { timeout: 120_000 },
    )
    .toBe(true)
  const site = await serveRelease(release(demoSite.id))
  try {
    // Широкий экран, без JS: логотип текстом, внешний пункт в новой вкладке, кнопка-«таблетка»
    const wide = await visitor(browser, 1440, false)
    await wide.page.goto(site.url)
    const header = wide.page.locator('header[data-site-header]')
    const home = header.getByRole('link', { name: /Ремонт\s+у Ивана/ })
    await expect(home.locator('[data-part="mark"]')).toHaveText('Ре')
    await expect(home.locator('[data-part="mark"]')).toHaveAttribute('aria-hidden', 'true')
    const nav = wide.page.getByRole('navigation', { name: 'Меню сайта' })
    await expect(nav.getByRole('link')).toHaveText([
      'Почему мы',
      'Telegram (откроется в новой вкладке)',
    ])
    const telegram = nav.getByRole('link', { name: /Telegram/ })
    await expect(telegram).toHaveAttribute('href', 'https://t.me/remont')
    await expect(telegram).toHaveAttribute('target', '_blank')
    await expect(telegram).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(nav.getByRole('link', { name: 'Почему мы' })).not.toHaveAttribute('target')
    const button = header.getByRole('link', { name: 'Рассчитать стоимость' })
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    const radius = Number.parseFloat(
      (await styleOf(button, ['border-top-left-radius']))['border-top-left-radius'] ?? '0',
    )
    expect(radius, 'таблетка').toBeGreaterThanOrEqual((box?.height ?? 0) / 2)
    expect(await styleOf(header, ['border-bottom-color'])).toEqual({
      'border-bottom-color': 'rgba(0, 0, 0, 0)',
    })
    expect(await noHorizontalScroll(wide.page)).toBe(true)
    await wide.page.screenshot({ path: testInfo.outputPath('site-1440-nojs.png') })
    await wide.context.close()

    // С JS: наведение заметно меняет фон и приподнимает кнопку, фокус — кольцо, не сливается
    const live = await visitor(browser, 1440, true)
    await live.page.goto(site.url)
    const liveButton = live.page
      .locator('header[data-site-header]')
      .getByRole('link', { name: 'Рассчитать стоимость' })
    const pageBg = String(
      await live.page.evaluate('getComputedStyle(document.body).backgroundColor'),
    )
    const rest = await styleOf(liveButton, ['background-color', 'color'])
    await liveButton.hover()
    await expect
      .poll(async () => (await styleOf(liveButton, ['transform'])).transform)
      .toMatch(/^matrix\(1, 0, 0, 1, 0, -2\)$/)
    const hover = await styleOf(liveButton, ['background-color'])
    const hoverBg = hover['background-color'] ?? ''
    expect(
      contrast(hoverBg, rest['background-color'] ?? ''),
      'наведение видно',
    ).toBeGreaterThanOrEqual(1.15)
    expect(contrast(hoverBg, rest.color ?? ''), 'текст на наведении').toBeGreaterThanOrEqual(4.5)
    await live.page.screenshot({ path: testInfo.outputPath('site-1440-hover.png') })
    // Пункт меню под курсором («Цвет акцента»): цвет заметно другой — или, если акцент почти
    // цвета текста, ещё и подчёркивание (WCAG 1.4.1)
    const item = live.page
      .getByRole('navigation', { name: 'Меню сайта' })
      .getByRole('link', { name: 'Почему мы' })
    const itemProps = ['color', 'text-decoration-line']
    const itemRest = await styleOf(item, itemProps)
    await item.hover()
    await expect.poll(async () => (await styleOf(item, itemProps)).color).not.toBe(itemRest.color)
    const itemHover = await styleOf(item, itemProps)
    const recolored = contrast(itemHover.color ?? '', itemRest.color ?? '') >= 3
    const underlined =
      itemRest['text-decoration-line'] === 'none' &&
      itemHover['text-decoration-line'] === 'underline'
    expect(recolored || underlined, 'наведение на пункт видно').toBe(true)
    await live.page.mouse.move(0, 700)
    // С клавиатуры: :focus-visible после мыши браузер ставит только по Tab
    await liveButton.focus()
    await live.page.keyboard.press('Shift+Tab')
    await live.page.keyboard.press('Tab')
    await expect(liveButton).toBeFocused()
    const ring = await styleOf(liveButton, ['outline-style', 'outline-color', 'outline-offset'])
    expect(ring['outline-style']).toBe('solid')
    expect(Number.parseFloat(ring['outline-offset'] ?? '0')).toBeGreaterThanOrEqual(2)
    expect(contrast(ring['outline-color'] ?? '', pageBg), 'кольцо на фоне').toBeGreaterThanOrEqual(
      3,
    )
    expect(
      contrast(rest['background-color'] ?? '', pageBg),
      'кнопка на фоне',
    ).toBeGreaterThanOrEqual(3)
    await live.page.screenshot({ path: testInfo.outputPath('site-1440-focus.png') })
    // Подвал: фон страницы, без линии, свой текст, согласие, без «©»
    const footer = live.page.locator('footer[data-site-footer]')
    await footer.scrollIntoViewIfNeeded()
    expect((await styleOf(footer, ['background-color']))['background-color']).toBe(pageBg)
    expect((await styleOf(footer, ['border-top-color']))['border-top-color']).toBe(
      'rgba(0, 0, 0, 0)',
    )
    await expect(footer.locator('p[data-font="accent"]')).toHaveText(
      'Работаем с 9 до 18\nбез выходных',
    )
    await expect(footer.getByRole('link', { name: /^Согласие на обработку/ })).toHaveAttribute(
      'href',
      '/consent/',
    )
    await expect(footer.locator('[data-part="mark"]')).toHaveText('Ре')
    await expect(footer).not.toContainText('©')
    await footer.screenshot({ path: testInfo.outputPath('site-1440-footer.png') })
    await live.context.close()

    // «Уменьшить движение» — цвет меняется, кнопка не двигается
    const calm = await visitor(browser, 1440, true, 'reduce')
    await calm.page.goto(site.url)
    const calmButton = calm.page
      .locator('header[data-site-header]')
      .getByRole('link', { name: 'Рассчитать стоимость' })
    await calmButton.hover()
    await calm.page.waitForTimeout(300)
    expect((await styleOf(calmButton, ['transform'])).transform).toBe('none')
    await calm.context.close()

    // Телефон без JS (375 и 320): кнопка с текстом для телефона в строке, меню во весь экран
    for (const width of [375, 320]) {
      const narrow = await visitor(browser, width, false)
      await narrow.page.goto(site.url)
      const row = narrow.page.locator('header[data-site-header]')
      const phoneButton = row.getByRole('link', { name: 'Расчёт', exact: true })
      await expect(phoneButton).toBeVisible()
      const brand = row.locator('a[href="/"]').first()
      const summary = row.locator('summary')
      const boxes = await Promise.all(
        [brand, phoneButton, summary].map((part) => part.boundingBox()),
      )
      for (const [index, part] of boxes.entries()) {
        if (!part) throw new Error(`нет рамки ${index}, ${width}`)
        expect(part.x + part.width, `в окне ${width}`).toBeLessThanOrEqual(width)
      }
      const [b0, b1, b2] = boxes as Box[]
      expect(
        apart(b0 as Box, b1 as Box) && apart(b1 as Box, b2 as Box),
        `не налезают ${width}`,
      ).toBe(true)
      expect(await noHorizontalScroll(narrow.page)).toBe(true)
      await narrow.page.screenshot({ path: testInfo.outputPath(`site-${width}-nojs.png`) })
      await summary.click()
      const panelNav = narrow.page.getByRole('navigation', { name: 'Меню сайта' })
      await expect(panelNav).toBeVisible()
      await expect(panelNav.getByRole('link')).toHaveText([
        'Почему выбирают нас',
        'Telegram (откроется в новой вкладке)',
      ])
      // В меню кнопки второй раз нет: она в строке
      await expect(row.locator('details').getByRole('link', { name: 'Расчёт' })).toHaveCount(0)
      const firstItem = panelNav.getByRole('link').first()
      expect((await styleOf(firstItem, ['text-align']))['text-align']).toBe('center')
      // Во весь экран: панель закрывает окно под строкой шапки
      const panel = await panelNav.locator('..').boundingBox()
      // Низ панели — ровно низ окна, без поправки на высоту шапки: так ловится высота «64 px»
      // вместо настоящей
      expect((panel?.y ?? 0) + (panel?.height ?? 0)).toBeGreaterThanOrEqual(812 - 1)
      await narrow.page.screenshot({ path: testInfo.outputPath(`site-${width}-nojs-menu.png`) })
      await narrow.context.close()
    }

    // Телефон с JS: Esc закрывает меню и возвращает фокус на «Меню»
    const phone = await visitor(browser, 375, true)
    await phone.page.goto(site.url)
    const burger = phone.page.locator('header[data-site-header] summary')
    await burger.click()
    await expect(phone.page.getByRole('navigation', { name: 'Меню сайта' })).toBeVisible()
    await phone.page.keyboard.press('Escape')
    await expect(phone.page.getByRole('navigation', { name: 'Меню сайта' })).toBeHidden()
    await expect(burger).toBeFocused()
    await phone.context.close()

    // Короткая шапка «Спасибо»: логотип и «← На главную», подвал у низа окна — без JS
    for (const width of [1440, 375]) {
      const short = await visitor(browser, width, false)
      await short.page.goto(`${site.url}/spasibo/`)
      const shortHeader = short.page.locator('header[data-site-header]')
      await expect(shortHeader.getByRole('navigation')).toHaveCount(0)
      await expect(shortHeader.getByRole('link', { name: 'Рассчитать стоимость' })).toHaveCount(0)
      await expect(
        shortHeader.getByRole('link', { name: 'На главную', exact: true }),
      ).toHaveAttribute('href', '/')
      const footerBox = await short.page.locator('footer[data-site-footer]').boundingBox()
      const height = width < 768 ? 812 : 900
      expect(
        Math.round((footerBox?.y ?? 0) + (footerBox?.height ?? 0)),
        `подвал у низа ${width}`,
      ).toBe(height)
      expect(await noHorizontalScroll(short.page)).toBe(true)
      await short.page.screenshot({ path: testInfo.outputPath(`site-${width}-short.png`) })
      await short.context.close()
    }
  } finally {
    site.close()
  }
})

/**
 * Администратор сайта: роль подменяется в ответе API о сайте (как в client.spec.ts) — экран
 * слушается роли. Сам запрет решает API (header.test.ts): правка вида — 403
 */
test('администратор сайта меняет тексты и ссылки шапки, а вид — только читает', async ({
  page,
}) => {
  await page.route(/\/api\/sites\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), access: 'client' } })
  })
  await page.goto('/header')
  await expect(
    page.getByText(/Раскладку, поведение и вид шапки и подвала меняет владелец/),
  ).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Классика' })).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: 'Липкая шапка' })).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: 'Линия под шапкой' })).toBeDisabled()
  await expect(page.getByRole('radio', { name: 'В строке шапки' })).toBeDisabled()
  // Тексты и логотип — его
  await expect(page.getByRole('radio', { name: 'Текст', exact: true })).toBeEnabled()
  await expect(page.getByRole('checkbox', { name: 'Кнопка в шапке' })).toBeEnabled()
  await page.getByRole('tab', { name: 'Подвал' }).click()
  await expect(page.getByRole('radio', { name: 'Как у страницы' })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Свой текст' })).toBeEnabled()
  await expect(
    page.getByRole('checkbox', { name: 'Ссылка на согласие на обработку данных' }),
  ).toBeEnabled()
})
