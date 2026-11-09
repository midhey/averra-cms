import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultTheme, faq, features, form, hero, MAIN_PAGE_SLUG, steps } from '@averra/schema'
import { type Browser, chromium, type Page } from '@playwright/test'
import sharp from 'sharp'
import { publishDir, urls } from '../urls'
import { editor, expect, ownerApi, sites, test } from './fixtures'
import { serveRelease } from './release-server'

// Окна и поведения (решение «Окна и поведения»): кнопка с «Открывать в окне» открывает
// страницу-окно поверх, Esc и фон закрывают, фокус возвращается; без JS — переход на страницу;
// форма в окне отправляется без перехода с успехом и ошибкой в окне. Появление при прокрутке и
// плавный FAQ — только с JS и без «уменьшить движение»; тема и SEO для соцсетей — в <head>

const release = (siteId: string) => join(publishDir, siteId, 'current')

async function servedHtml(siteId: string, slug = '') {
  const file = join(release(siteId), slug, 'index.html')
  return existsSync(file) ? readFile(file, 'utf8') : ''
}

let visitors = 0

/** Посетитель: свой контекст, свой IP для лимита заявок, с JS или без, своя ширина */
async function visitor(
  browser: Browser,
  width: number,
  options: { javaScriptEnabled?: boolean; reducedMotion?: 'reduce' | 'no-preference' } = {},
) {
  visitors += 1
  const context = await browser.newContext({
    locale: 'ru-RU',
    javaScriptEnabled: options.javaScriptEnabled ?? true,
    reducedMotion: options.reducedMotion ?? 'no-preference',
    viewport: { width, height: width < 768 ? 812 : 900 },
    storageState: { cookies: [], origins: [] },
  })
  const page = await context.newPage()
  // Свой IP для лимита заявок (API e2e доверяет прокси) — подстановкой в сети, а не заголовком
  // страницы: лишний заголовок у fetch превратил бы простой запрос формы в окне в CORS-preflight
  const ip = `10.30.${Date.now() % 250}.${visitors}`
  await page.route('**/api/forms/**', (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
  )
  const violations: string[] = []
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text())
  })
  return { context, page, violations }
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate('document.documentElement.scrollWidth <= window.innerWidth') as Promise<boolean>

// Код в браузере — строкой: типов DOM у e2e нет (как в dev-ui.spec.ts)
const rootOverflow = (page: Page) =>
  page.evaluate('getComputedStyle(document.documentElement).overflow') as Promise<string>

const signupForm = {
  ...form.example,
  title: 'Запишитесь на пробный урок',
  fields: [
    { name: 'name', type: 'name' as const, label: 'Как тебя зовут', required: true },
    {
      name: 'channel',
      type: 'select' as const,
      label: 'Где удобнее общаться',
      required: true,
      options: [
        { label: 'Telegram', contact: 'telegram' as const },
        { label: 'Телефон', contact: 'phone' as const },
      ],
    },
    {
      name: 'contact',
      type: 'text' as const,
      label: 'Как с тобой связаться',
      required: true,
      contactBy: 'channel',
    },
  ],
}

/**
 * Страница-окно /zapis с формой — через админку (панель «SEO» → «Окно»), главная с кнопкой в окно,
 * карточками с появлением и плавным FAQ — через API
 */
async function setUp(page: Page, siteId: string) {
  const pages = sites[':siteId'].pages
  const zapis = { siteId, slug: 'zapis' }
  expect(
    (await pages.$post({ param: { siteId }, json: { slug: 'zapis', title: 'Запись' } })).status,
  ).toBe(201)
  const content = { blocks: [{ id: 'signup', type: 'form' as const, props: signupForm }] }
  expect(
    (await pages[':slug'].$put({ param: zapis, json: { title: 'Запись', content } })).status,
  ).toBe(200)

  const ed = editor(page)
  await ed.open('zapis')
  await page.getByRole('button', { name: /^SEO/ }).click()
  const panel = page.getByRole('complementary', { name: 'SEO страницы' })
  await panel.getByRole('checkbox', { name: 'Открывать страницу окном' }).check()
  await panel.getByLabel('Заголовок окна').fill('Пробный урок')
  await panel
    .getByRole('group', { name: 'Ширина окна' })
    .getByRole('radio', { name: 'Узкое' })
    .check()
  await ed.publishButton.click()
  await expect(ed.status).toHaveText('Опубликовано. Обнови сайт, чтобы увидеть')

  const main = { siteId, slug: MAIN_PAGE_SLUG }
  const blocks = [
    {
      id: 'hero',
      type: 'hero' as const,
      props: {
        ...hero.example,
        button: { label: 'Записаться на урок', href: '/zapis/', window: true },
      },
    },
    { id: 'steps', type: 'steps' as const, props: steps.example },
    {
      id: 'benefits',
      type: 'features' as const,
      props: { ...features.example, reveal: 'up' as const },
    },
    {
      id: 'questions',
      type: 'faq' as const,
      props: { ...faq.example, openFirst: false, smooth: true },
    },
  ]
  const saved = await pages[':slug'].$put({
    param: main,
    json: { title: 'Главная', content: { blocks } as never },
  })
  expect(saved.status, await saved.clone().text()).toBe(200)
  expect((await pages[':slug'].publish.$post({ param: main })).status).toBe(200)
}

test('окно с формой: Esc, фон, фокус, отправка с успехом и ошибкой в окне — на 1440 и 375; без JS — переход', async ({
  page,
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  await setUp(page, demoSite.id)

  for (const width of [1440, 375]) {
    const site = await visitor(browser, width)
    try {
      await site.page.goto(urls.renderer)
      const button = site.page.getByRole('link', { name: 'Записаться на урок' })
      const dialog = site.page.getByRole('dialog', { name: 'Пробный урок' })
      await expect(dialog).toBeHidden()

      // Клик — окно поверх, адрес тот же, страница не прокручивается. Фокус — на первом поле, а
      // на телефоне — на заголовке окна: клавиатура не поднимается сразу и не закрывает заголовок
      await button.click()
      await expect(dialog).toBeVisible()
      await expect(site.page).toHaveURL(`${urls.renderer}/`)
      if (width === 375) {
        await expect(
          dialog.getByRole('heading', { name: 'Пробный урок', exact: true }),
        ).toBeFocused()
        await expect(
          dialog.getByRole('heading', { name: 'Пробный урок', exact: true }),
        ).toBeInViewport()
      } else await expect(dialog.getByLabel('Как тебя зовут')).toBeFocused()
      expect(await rootOverflow(site.page)).toBe('hidden')
      const close = dialog.getByRole('button', { name: 'Закрыть окно' })
      const box = await close.boundingBox()
      expect(box?.width).toBeGreaterThanOrEqual(44)
      expect(box?.height).toBeGreaterThanOrEqual(44)
      expect(await noHorizontalScroll(site.page)).toBe(true)
      await site.page.screenshot({ path: testInfo.outputPath(`window-${width}.png`) })

      // На 375 окно с формой прокручивается и само получает фокус: Shift+Tab с «Закрыть» ставит
      // фокус на <dialog>, и кольцо фокуса у него видно
      if (width === 375) {
        // Низкий экран: окно с формой точно прокручивается
        await site.page.setViewportSize({ width, height: 420 })
        expect(
          await site.page.evaluate(
            "(d => d.scrollHeight > d.clientHeight)(document.querySelector('dialog[open]'))",
          ),
        ).toBe(true)
        await close.focus()
        await site.page.keyboard.press('Shift+Tab')
        expect(
          await site.page.evaluate(
            "[document.activeElement?.tagName, getComputedStyle(document.activeElement).outlineStyle].join(' ')",
          ),
        ).toBe('DIALOG solid')
        await site.page.setViewportSize({ width, height: 812 })
      }

      // Tab не уходит за окно
      for (let step = 0; step < 12; step += 1) await site.page.keyboard.press('Tab')
      expect(
        await site.page.evaluate(
          "document.activeElement?.closest('dialog[data-site-window]') !== null",
        ),
      ).toBe(true)

      // Esc — закрыто, фокус на кнопке
      await site.page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(button).toBeFocused()
      expect(await rootOverflow(site.page)).not.toBe('hidden')

      // Клик по фону — закрыто; кнопка «Закрыть» — тоже
      await button.click()
      await expect(dialog).toBeVisible()
      await site.page.mouse.click(4, 4)
      await expect(dialog).toBeHidden()
      await button.click()
      await dialog.getByRole('button', { name: 'Закрыть окно' }).click()
      await expect(dialog).toBeHidden()
      await expect(button).toBeFocused()

      // Короткий ник останавливает браузер, номер не номер — сервер: ошибка в окне
      await button.click()
      const signup = dialog.getByRole('form', { name: signupForm.title })
      await signup.getByLabel('Как тебя зовут').fill(`Окно ${width}`)
      await signup.getByLabel('Где удобнее общаться').selectOption('Телефон')
      await signup.getByLabel('Как с тобой связаться').fill('abcdefgh')
      await signup.getByLabel('Я согласен на обработку персональных данных').check()
      await signup.getByRole('button', { name: 'Отправить заявку' }).click()
      const error = dialog.getByRole('alert')
      await expect(error).toContainText('Поправьте поля формы')
      const contact = signup.getByLabel('Как с тобой связаться')
      await expect(contact).toBeFocused()
      await expect(contact).toHaveAttribute('aria-invalid', 'true')
      // Текст ошибки — у поля, связан с ним и виден в экране (на телефоне общая ошибка у кнопки
      // ниже экрана: смотрят на поле в фокусе)
      await expect(contact).toHaveAccessibleDescription(/Похоже, в номере не хватает цифр/)
      const fieldError = dialog.getByText('Похоже, в номере не хватает цифр')
      await expect(fieldError).toBeVisible()
      await expect(fieldError).toBeInViewport({ ratio: 1 })
      await expect(contact).toBeInViewport({ ratio: 1 })
      await expect(dialog).toBeVisible()
      await expect(site.page).toHaveURL(`${urls.renderer}/`)
      await site.page.screenshot({ path: testInfo.outputPath(`window-error-${width}.png`) })

      // Верный ник — успех в окне, без перехода
      await signup.getByLabel('Где удобнее общаться').selectOption('Telegram')
      await signup.getByLabel('Как с тобой связаться').fill(`@window${width}`)
      await signup.getByRole('button', { name: 'Отправить заявку' }).click()
      await expect(dialog.getByRole('status')).toHaveText(signupForm.successText ?? /Спасибо/)
      await expect(signup).toBeHidden()
      await expect(site.page).toHaveURL(`${urls.renderer}/`)
      expect(site.violations).toEqual([])
      await site.page.screenshot({ path: testInfo.outputPath(`window-sent-${width}.png`) })
    } finally {
      await site.context.close()
    }
  }

  // Видимая полоса прокрутки (как в Windows): headless Chromium её прячет, поэтому отдельный
  // браузер без --hide-scrollbars. Полоса уходит при открытии окна, её место остаётся
  // (scrollbar-gutter), и кнопка под затемнением не сдвигается
  const withBar = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  try {
    const site = await visitor(withBar, 1440)
    await site.page.goto(urls.renderer)
    expect(
      await site.page.evaluate('window.innerWidth - document.documentElement.clientWidth'),
    ).toBeGreaterThan(0)
    const button = site.page.getByRole('link', { name: 'Записаться на урок' })
    const before = await button.boundingBox()
    await button.click()
    await expect(site.page.getByRole('dialog', { name: 'Пробный урок' })).toBeVisible()
    const after = await button.boundingBox()
    expect(after?.x).toBe(before?.x)
    expect(after?.width).toBe(before?.width)
  } finally {
    await withBar.close()
  }

  // Заявки из окна пришли со страницы-окна
  const leads = await ownerApi.sites[':siteId'].leads.$get({
    param: { siteId: demoSite.id },
    query: {},
  })
  if (leads.status !== 200) throw new Error(`Список заявок: ${leads.status}`)
  const text = JSON.stringify((await leads.json()).items)
  expect(text).toContain('@window1440')
  expect(text).toContain('@window375')
  expect(text).not.toContain('abcdefgh')

  // Без JS — переход на страницу-окно, форма там на месте
  const plain = await visitor(browser, 375, { javaScriptEnabled: false })
  try {
    await plain.page.goto(urls.renderer)
    await expect(plain.page.getByRole('dialog')).toBeHidden()
    await plain.page.getByRole('link', { name: 'Записаться на урок' }).click()
    await expect(plain.page).toHaveURL(`${urls.renderer}/zapis/`)
    await expect(plain.page.getByRole('form', { name: signupForm.title })).toBeVisible()
    // Ответы FAQ — обычный details, карточки видны
    await plain.page.goto(urls.renderer)
    await expect(plain.page.getByText(features.example.items[2]?.title ?? '')).toBeVisible()
  } finally {
    await plain.context.close()
  }

  // Ctrl-клик — обычная ссылка (новая вкладка), окно не открывается
  const ctrl = await visitor(browser, 1440)
  try {
    await ctrl.page.goto(urls.renderer)
    const [opened] = await Promise.all([
      ctrl.context.waitForEvent('page'),
      ctrl.page.getByRole('link', { name: 'Записаться на урок' }).click({ modifiers: ['Control'] }),
    ])
    await opened.waitForLoadState()
    expect(opened.url()).toBe(`${urls.renderer}/zapis/`)
    await expect(ctrl.page.getByRole('dialog', { name: 'Пробный урок' })).toBeHidden()
  } finally {
    await ctrl.context.close()
  }

  // Собранный сайт: окно в странице, скрипт поведений файлом, без нарушений CSP
  await expect
    .poll(() => servedHtml(demoSite.id), { timeout: 120_000 })
    .toMatch(/<dialog[^>]+data-site-window="zapis"/)
  const html = await servedHtml(demoSite.id)
  expect(html).not.toMatch(/<script(?![^>]*src=)(?![^>]*application\/ld\+json)[^>]*>/)
  // Страница-окно сама себе не окно: на /zapis/ окна нет
  const zapisHtml = await servedHtml(demoSite.id, 'zapis')
  expect(zapisHtml).not.toMatch(/<dialog[^>]+data-site-window/)
  const served = await serveRelease(release(demoSite.id))
  try {
    const site = await visitor(browser, 1440)
    await site.page.goto(served.url)
    await site.page.getByRole('link', { name: 'Записаться на урок' }).click()
    await expect(site.page.getByRole('dialog', { name: 'Пробный урок' })).toBeVisible()
    await site.page.keyboard.press('Escape')
    await expect(site.page.getByRole('dialog', { name: 'Пробный урок' })).toBeHidden()
    expect(site.violations).toEqual([])
    await site.context.close()
  } finally {
    served.close()
  }
})

test('появление при прокрутке и плавный FAQ: с JS — анимация, без JS и при «уменьшить движение» — всё видно', async ({
  page,
  browser,
  demoSite,
}) => {
  test.slow()
  await setUp(page, demoSite.id)
  const cards = (site: Page) => site.locator('[data-av-reveal]')

  const animated = await visitor(browser, 1440)
  try {
    await animated.page.goto(urls.renderer)
    // Карточки ниже экрана ждут прокрутки
    await expect(cards(animated.page).first()).toHaveAttribute('data-av-pending', '')
    await cards(animated.page).last().scrollIntoViewIfNeeded()
    await expect(cards(animated.page).last()).not.toHaveAttribute('data-av-pending', '')
    await expect
      .poll(() =>
        cards(animated.page)
          .last()
          .evaluate((node) => node.ownerDocument.defaultView?.getComputedStyle(node).opacity),
      )
      .toBe('1')
    // Плавный FAQ: раскрывается, ответ виден
    const question = animated.page.getByText(faq.example.items[0]?.question ?? '')
    await question.click()
    await expect(animated.page.getByText(faq.example.items[0]?.answer ?? '')).toBeVisible()
    expect(animated.violations).toEqual([])
    // Скрипт поведений — только там, где он нужен: на главной есть, на /zapis/ (ни окон, ни
    // data-av-*) — нет
    await expect(animated.page.locator('script[src*="SiteBehaviors"]')).toHaveCount(1)
    await animated.page.goto(`${urls.renderer}/zapis/`)
    await expect(animated.page.locator('form')).toHaveCount(1)
    await expect(animated.page.locator('script[src*="SiteBehaviors"]')).toHaveCount(0)
  } finally {
    await animated.context.close()
  }

  // Строка у самого низа (копирайт подвала): с суженной областью появления она не пересекается
  // никогда, но после прокрутки до упора видна — на 1440 и 375
  for (const width of [1440, 375]) {
    const bottom = await visitor(browser, width)
    try {
      await bottom.page.route(`${urls.renderer}/`, async (route) => {
        const response = await route.fetch()
        const body = (await response.text()).replace(
          '</body>',
          '<p data-av-reveal id="last-line">© Последняя строка</p></body>',
        )
        await route.fulfill({ response, body })
      })
      await bottom.page.goto(urls.renderer)
      const last = bottom.page.locator('#last-line')
      await expect(last).toHaveAttribute('data-av-pending', '')
      await bottom.page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
      await expect(last).not.toHaveAttribute('data-av-pending', '')
      await expect
        .poll(() =>
          last.evaluate((node) => node.ownerDocument.defaultView?.getComputedStyle(node).opacity),
        )
        .toBe('1')
    } finally {
      await bottom.context.close()
    }
  }

  for (const options of [{ javaScriptEnabled: false }, { reducedMotion: 'reduce' as const }]) {
    const calm = await visitor(browser, 375, options)
    try {
      await calm.page.goto(urls.renderer)
      await expect(calm.page.locator('[data-av-pending]')).toHaveCount(0)
      expect(
        await cards(calm.page)
          .last()
          .evaluate((node) => node.ownerDocument.defaultView?.getComputedStyle(node).opacity),
      ).toBe('1')
      await calm.page.getByText(faq.example.items[1]?.question ?? '').click()
      await expect(calm.page.getByText(faq.example.items[1]?.answer ?? '')).toBeVisible()
      expect(await noHorizontalScroll(calm.page)).toBe(true)
    } finally {
      await calm.context.close()
    }
  }
})

test('кнопка и пункт меню шапки с «Открывать в окне»: флажок сохраняется, окно открывается на 1440 и 375', async ({
  page,
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  await setUp(page, demoSite.id)

  // В админке: кнопка шапки и пункт меню — на страницу-окно, с флажком
  await page.goto('/header')
  await page.getByRole('checkbox', { name: 'Кнопка в шапке' }).check()
  await page.getByRole('textbox', { name: 'Текст кнопки' }).fill('Урок бесплатно')
  await page.getByRole('combobox', { name: 'Куда ведёт' }).selectOption('zapis')
  await page.getByRole('checkbox', { name: 'Открывать в окне' }).check()
  await page.getByRole('tab', { name: 'Меню' }).click()
  await page.getByRole('button', { name: 'Пункт меню', exact: true }).click()
  const item = page.getByRole('list', { name: 'Пункты меню' }).getByRole('listitem').first()
  await item.getByRole('textbox', { name: 'Подпись', exact: true }).fill('Запись')
  await item.getByRole('combobox', { name: 'Куда ведёт' }).selectOption('zapis')
  await item.getByRole('checkbox', { name: 'Открывать в окне' }).check()
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByText(/Шапка опубликована/)).toBeVisible()

  // После перезагрузки флажки на месте — и в опубликованной шапке API
  await page.reload()
  await page.getByRole('tab', { name: 'Меню' }).click()
  await expect(
    page
      .getByRole('list', { name: 'Пункты меню' })
      .getByRole('listitem')
      .first()
      .getByRole('checkbox', { name: 'Открывать в окне' }),
  ).toBeChecked()
  await page.getByRole('tab', { name: 'Шапка' }).click()
  await expect(page.getByRole('checkbox', { name: 'Открывать в окне' })).toBeChecked()
  const view = await sites[':siteId'].header.$get({ param: { siteId: demoSite.id } })
  const stored = (await view.json()) as {
    published: { button: { window?: boolean }; menu: { window?: boolean }[] }
  }
  expect(stored.published.button.window).toBe(true)
  expect(stored.published.menu[0]?.window).toBe(true)

  // Сайт: кнопка шапки открывает окно, Esc возвращает фокус на неё; пункт меню — тоже окно
  const wide = await visitor(browser, 1440)
  try {
    await wide.page.goto(urls.renderer)
    const siteHeader = wide.page.locator('header[data-site-header]')
    const button = siteHeader.getByRole('link', { name: 'Урок бесплатно' })
    await expect(button).toHaveAttribute('data-av-window', '')
    const dialog = wide.page.getByRole('dialog', { name: 'Пробный урок' })
    await button.click()
    await expect(dialog).toBeVisible()
    await expect(wide.page).toHaveURL(`${urls.renderer}/`)
    await wide.page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(button).toBeFocused()
    await siteHeader
      .getByRole('navigation', { name: 'Меню сайта' })
      .getByRole('link', { name: 'Запись' })
      .click()
    await expect(dialog).toBeVisible()
    await wide.page.screenshot({ path: testInfo.outputPath('header-window-1440.png') })
    expect(wide.violations).toEqual([])
  } finally {
    await wide.context.close()
  }

  // Телефон: пункт в меню-шторке открывает окно; закрыли — фокус на «Меню», а не на body
  const narrow = await visitor(browser, 375)
  try {
    await narrow.page.goto(urls.renderer)
    const burger = narrow.page.locator('header[data-site-header] summary', { hasText: 'Меню' })
    await burger.click()
    await narrow.page
      .getByRole('navigation', { name: 'Меню сайта' })
      .getByRole('link', { name: 'Запись' })
      .click()
    const dialog = narrow.page.getByRole('dialog', { name: 'Пробный урок' })
    await expect(dialog).toBeVisible()
    await expect(narrow.page).toHaveURL(`${urls.renderer}/`)
    expect(await noHorizontalScroll(narrow.page)).toBe(true)
    await narrow.page.screenshot({ path: testInfo.outputPath('header-window-375.png') })
    await narrow.page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(burger).toBeFocused()
    expect(narrow.violations).toEqual([])
  } finally {
    await narrow.context.close()
  }

  // Без JS — переход на страницу-окно
  const plain = await visitor(browser, 1440, { javaScriptEnabled: false })
  try {
    await plain.page.goto(urls.renderer)
    await plain.page
      .locator('header[data-site-header]')
      .getByRole('link', { name: 'Урок бесплатно' })
      .click()
    await expect(plain.page).toHaveURL(`${urls.renderer}/zapis/`)
  } finally {
    await plain.context.close()
  }
})

test('тема и SEO для соцсетей из админки: моно-шрифт, фон-картинка, кольцо фокуса, строка браузера, CSS окон, og-поля', async ({
  page,
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  // Страница-окно /zapis и кнопка в окно на главной: CSS окон проверяем на открытом окне
  await setUp(page, demoSite.id)
  // Экран «Тема»: новые поля — и они переживают перезагрузку
  await page.goto('/theme')
  await page.getByLabel('Моноширинный').selectOption('jetbrains-mono')
  const browserSection = page.getByRole('region', { name: 'Страница и браузер' })
  await browserSection.getByRole('button', { name: 'Выбрать картинку' }).click()
  const library = page.getByRole('dialog', { name: 'Медиатека: фон-картинка страницы' })
  const grain = `grain-${Date.now()}.png`
  await library.getByLabel('Загрузить картинку').setInputFiles({
    name: grain,
    mimeType: 'image/png',
    buffer: await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#f4efe4' },
    })
      .png()
      .toBuffer(),
  })
  await library.getByRole('button', { name: new RegExp(`^Выбрать «${grain}»`) }).click()
  await expect(library).toBeHidden()
  await browserSection
    .getByRole('group', { name: 'Как лежит картинка' })
    .getByRole('radio', { name: 'Узор (повторяется)' })
    .check()
  await browserSection.getByRole('textbox', { name: 'Кольцо фокуса' }).fill('#c2410c')
  await browserSection.getByLabel('Цвет строки браузера').selectOption('accent')
  const windowCss = page.getByRole('region', { name: 'Окна сайта' }).getByLabel('Свой CSS окон')
  const css =
    ':scope { border-top: 6px solid var(--color-accent) }\n> section h2 { font-family: var(--font-mono) }'
  await windowCss.fill(css)
  await page.screenshot({ path: testInfo.outputPath('theme-admin-1440.png'), fullPage: true })
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(
    page.getByText('Тема сохранена. На сайте она появится после публикации'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByText(/Тема опубликована/)).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Моноширинный')).toHaveValue('jetbrains-mono')
  await expect(browserSection).toContainText(grain)
  await expect(browserSection.getByRole('textbox', { name: 'Кольцо фокуса' })).toHaveValue(
    '#c2410c',
  )
  await expect(browserSection.getByLabel('Цвет строки браузера')).toHaveValue('accent')
  await expect(windowCss).toHaveValue(css)
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('theme-admin-375.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })

  // Панель «SEO»: поля для соцсетей, после перезагрузки на месте
  const ed = editor(page)
  await ed.open(MAIN_PAGE_SLUG)
  await page.getByRole('button', { name: /^SEO/ }).click()
  const panel = page.getByRole('complementary', { name: 'SEO страницы' })
  await panel.getByLabel('Заголовок для соцсетей').fill('Ремонт без сюрпризов')
  await panel.getByLabel('Описание для соцсетей').fill('Смета за день')
  await panel.getByLabel('Что на картинке').fill('Кухня после ремонта')
  await ed.publishButton.click()
  await expect(ed.status).toHaveText('Опубликовано. Обнови сайт, чтобы увидеть')
  await page.reload()
  await page.getByRole('button', { name: /^SEO/ }).click()
  await expect(panel.getByLabel('Заголовок для соцсетей')).toHaveValue('Ремонт без сюрпризов')
  await expect(panel.getByLabel('Описание для соцсетей')).toHaveValue('Смета за день')
  await expect(panel.getByLabel('Что на картинке')).toHaveValue('Кухня после ремонта')

  const site = await visitor(browser, 1440)
  try {
    await site.page.goto(urls.renderer)
    await expect(site.page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      defaultTheme.colors.accent,
    )
    await expect(site.page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      'Ремонт без сюрпризов',
    )
    await expect(site.page.locator('meta[property="og:description"]')).toHaveAttribute(
      'content',
      'Смета за день',
    )
    expect(
      await site.page.evaluate(
        "getComputedStyle(document.documentElement).getPropertyValue('--font-mono')",
      ),
    ).toContain('JetBrains Mono')
    // Фон-картинка — узором на body
    const body = (await site.page.evaluate(`(() => {
      const style = getComputedStyle(document.body)
      return { image: style.backgroundImage, repeat: style.backgroundRepeat }
    })()`)) as { image: string; repeat: string }
    expect(body.image).toMatch(/^url\(/)
    expect(body.repeat).toBe('repeat')
    // Кольцо фокуса — своим цветом и с зазором
    await site.page.keyboard.press('Tab')
    const ring = await site.page.evaluate(`(() => {
      const style = getComputedStyle(document.activeElement)
      return { color: style.outlineColor, offset: style.outlineOffset }
    })()`)
    expect(ring).toEqual({ color: 'rgb(194, 65, 12)', offset: '3px' })
    // CSS окон на деле: :scope перебивает рамку окна по умолчанию, «> section» находит блоки окна
    await site.page.getByRole('link', { name: 'Записаться на урок' }).click()
    const dialog = site.page.getByRole('dialog', { name: 'Пробный урок' })
    await expect(dialog).toBeVisible()
    expect(
      await site.page.evaluate(
        "getComputedStyle(document.querySelector('dialog[open]')).borderTopWidth",
      ),
    ).toBe('6px')
    expect(
      await site.page.evaluate(
        "getComputedStyle(document.querySelector('dialog[open] [data-site-window-content] h2')).fontFamily",
      ),
    ).toContain('JetBrains Mono')
    expect(site.violations).toEqual([])
  } finally {
    await site.context.close()
  }

  // Собранный сайт: файл фона лежит в релизе (папка картинки), а не только в снимке для dev
  const backgroundUrl = /background-image:url\("?(\/media\/[^")]+)"?\)/
  await expect
    .poll(async () => (await servedHtml(demoSite.id)).match(backgroundUrl)?.[1] ?? '', {
      timeout: 120_000,
    })
    .not.toBe('')
  const path = (await servedHtml(demoSite.id)).match(backgroundUrl)?.[1] ?? ''
  const served = await serveRelease(release(demoSite.id))
  try {
    const res = await fetch(new URL(path, served.url))
    expect(res.status, path).toBe(200)
    const visitorOfRelease = await visitor(browser, 375)
    await visitorOfRelease.page.goto(served.url)
    const loaded = await visitorOfRelease.page.evaluate(`(async () => {
      const url = getComputedStyle(document.body).backgroundImage.slice(5, -2)
      const image = new Image()
      image.src = url
      try { await image.decode(); return true } catch { return false }
    })()`)
    expect(loaded).toBe(true)
    await visitorOfRelease.context.close()
  } finally {
    served.close()
  }
})
