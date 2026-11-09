import type { Page } from '@playwright/test'
import { demo, editor, expect, sidebar, sites, test } from './fixtures'

// Оболочка и экраны на ширине телефона: нет горизонтальной прокрутки страницы, меню открывается
// кнопкой и закрывается Esc. И что панель прячет от роли (подмена роли в ответах API, как
// в client.spec.ts; права проверяют тесты API)

const overflowOf = (page: Page) =>
  page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')

test('на 375 px ни один экран не прокручивается вбок', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const screens = [
    '/',
    '/',
    '/pages',
    '/media',
    '/leads',
    '/settings',
    '/mail',
    '/status',
    '/script',
  ]
  for (const path of screens) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(Number(await overflowOf(page)), path).toBeLessThanOrEqual(0)
  }
  // У редактора h1 только для диктора: на виду поле заголовка страницы
  await page.goto('/pages/index')
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached()
  await expect(page.getByLabel('Заголовок страницы')).toBeVisible()
  expect(Number(await overflowOf(page)), 'редактор').toBeLessThanOrEqual(0)
})

test('на телефоне панель — меню: кнопка, Esc закрывает и возвращает фокус, переход закрывает', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  const panel = sidebar(page)
  await expect(panel.sections).toBeHidden()
  const menu = page.getByRole('button', { name: 'Меню' })
  await menu.click()
  await expect(page.getByRole('button', { name: 'Закрыть меню' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(panel.sections).toBeVisible()
  expect(Number(await overflowOf(page))).toBeLessThanOrEqual(0)
  await page.keyboard.press('Escape')
  await expect(panel.sections).toBeHidden()
  await expect(menu).toBeFocused()

  // С клавиатуры: Enter на разделе — меню закрыто, фокус на содержимом, а не на body
  await menu.click()
  await panel.section('Страницы').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/pages')
  await expect(panel.sections).toBeHidden()
  await expect(page.locator('#content')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('main').locator(':focus')).toHaveCount(1)
})

test('вход и другие экраны без входа на 375 px — форма по центру без прокрутки вбок', async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 375, height: 812 },
  })
  try {
    const page = await context.newPage()
    await page.goto('/login')
    await expect(page.getByRole('form', { name: 'Вход в админку' })).toBeVisible()
    expect(Number(await overflowOf(page))).toBeLessThanOrEqual(0)
    // Без токена «новый пароль» и приглашение показывают отказ — он тоже не шире экрана
    for (const path of ['/forgot-password', '/reset-password', '/invite']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(Number(await overflowOf(page)), path).toBeLessThanOrEqual(0)
    }
  } finally {
    await context.close()
  }
})

test('редактору сайта панель не показывает заявки и установку', async ({ page }) => {
  await page.route(/\/api\/me$/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, user: { ...body.user, role: 'member' } } })
  })
  await page.route(/\/api\/sites\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    await route.fulfill({
      response,
      json: { ...(await response.json()), access: 'editor', newLeads: null },
    })
  })
  await page.goto('/')
  const panel = sidebar(page)
  await expect(panel.section('Обзор')).toBeVisible()
  await expect(panel.section('Страницы')).toBeVisible()
  await expect(panel.section('Заявки')).toHaveCount(0)
  await expect(panel.installation).toHaveCount(0)
  await expect(page.getByText('Редактор', { exact: true })).toBeVisible()
  // И на обзоре нет ни карточки, ни раздела заявок
  await expect(page.getByRole('region', { name: 'Коротко' })).not.toContainText('Новые заявки')
  await expect(page.getByRole('region', { name: 'Последние заявки' })).toHaveCount(0)
  // Настройки: заявок и участников нет, выгрузка — только архив сайта
  await panel.section('Настройки сайта').click()
  await expect(page.getByRole('region', { name: 'Заявки' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Участники' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Скачать сайт архивом' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Выгрузить все данные' })).toHaveCount(0)
})

test('редактор на 375 px: вкладки «Блоки / Предпросмотр / Поля», всё работает', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const ed = editor(page)
  await ed.open()
  const tabs = page.getByRole('tablist', { name: 'Части редактора' })
  await expect(tabs.getByRole('tab')).toHaveText([/^Блоки/, /^Предпросмотр/, /^Поля/, /^SEO/])
  await expect(tabs.getByRole('tab', { name: 'Блоки' })).toHaveAttribute('aria-selected', 'true')
  await expect(ed.blockList).toBeVisible()
  await expect(ed.inspector).toBeHidden()
  await expect(ed.previewFrame).toBeHidden()

  // Полоса редактора — две строки (название, действия), с длинным состоянием между ними ещё
  // одна, но тонкая: полям с экранной клавиатурой остаётся высота
  const topbarHeight = () =>
    page
      .getByRole('banner')
      .evaluate(
        (el: { getBoundingClientRect: () => { height: number } }) =>
          el.getBoundingClientRect().height,
      )
  expect(Number(await topbarHeight())).toBeLessThanOrEqual(124)
  await page.setViewportSize({ width: 320, height: 640 })
  expect(Number(await topbarHeight())).toBeLessThanOrEqual(124)
  expect(Number(await overflowOf(page))).toBeLessThanOrEqual(0)
  await page.setViewportSize({ width: 375, height: 812 })

  // Переставить и удалить блок можно прямо в списке, не уходя на «Поля»
  const last = ed.blocks.last()
  await expect(last).toContainText('Призыв к действию')
  await last.getByRole('button', { name: 'Поднять блок' }).click()
  await expect(ed.blocks.nth(1)).toContainText('Призыв к действию')
  await expect(tabs.getByRole('tab', { name: 'Блоки' })).toHaveAttribute('aria-selected', 'true')
  await ed.blocks.nth(1).getByRole('button', { name: 'Опустить блок' }).click()
  await expect(ed.blocks.last()).toContainText('Призыв к действию')
  await expect(ed.block('Преимущества').getByRole('button', { name: 'Удалить блок' })).toBeVisible()

  // Стрелки переключают вкладки
  await tabs.getByRole('tab', { name: 'Блоки' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.getByRole('tab', { name: 'Предпросмотр' })).toBeFocused()
  await expect(ed.previewFrame).toBeVisible()
  await expect(ed.blockList).toBeHidden()
  // На телефоне предпросмотр сразу шириной телефона, переключатель — над ним
  await expect(ed.device('Телефон')).toBeChecked()
  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText(demo.heroTitle)

  // Выбор блока в списке открывает его поля
  await tabs.getByRole('tab', { name: 'Блоки' }).click()
  await ed.selectBlock('Призыв к действию')
  await expect(tabs.getByRole('tab', { name: 'Поля' })).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.getByRole('tab', { name: 'Поля' })).toBeFocused()
  await expect(ed.inspector.getByRole('heading', { name: 'Призыв к действию' })).toBeVisible()

  // Правка поля видна во вкладке «Предпросмотр»
  await ed.field('Заголовок').fill('Звоните сегодня')
  await expect(ed.status).toHaveText('Есть несохранённые правки')
  await tabs.getByRole('tab', { name: 'Предпросмотр' }).click()
  await expect(ed.preview.getByRole('heading', { name: 'Звоните сегодня' })).toBeVisible()
  expect(Number(await overflowOf(page))).toBeLessThanOrEqual(0)

  // История — в третьей вкладке, она так и называется
  await page.getByRole('button', { name: 'История', exact: true }).click()
  await expect(tabs.getByRole('tab', { name: 'История' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('complementary', { name: 'История публикаций' })).toBeVisible()
  expect(Number(await overflowOf(page))).toBeLessThanOrEqual(0)

  // SEO страницы — своя вкладка, видна сразу, без прокрутки списка блоков
  await tabs.getByRole('tab', { name: 'Блоки' }).click()
  await expect(tabs.getByRole('tab', { name: /^SEO/ })).toBeInViewport()
  await tabs.getByRole('tab', { name: /^SEO/ }).click()
  await expect(tabs.getByRole('tab', { name: /^SEO/ })).toHaveAttribute('aria-selected', 'true')
  await expect(
    page
      .getByRole('complementary', { name: 'SEO страницы' })
      .getByLabel('Описание', { exact: true }),
  ).toBeVisible()
  expect(Number(await overflowOf(page))).toBeLessThanOrEqual(0)
})

test('редактор на 375 px: название страницы не налезает на состояние', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const ed = editor(page)
  await ed.open()
  // Длинное название и самое длинное состояние («Есть несохранённые правки…»)
  await page
    .getByRole('textbox', { name: 'Заголовок страницы' })
    .fill('Очень длинное название страницы, которое не помещается')
  const boxes = (await page.evaluate(`(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
    return {
      title: rect(document.querySelector('input[title^="Заголовок страницы"]')),
      status: rect(document.querySelector('header [role=status]')),
    }
  })()`)) as Record<
    'title' | 'status',
    { left: number; right: number; top: number; bottom: number }
  >
  const { title, status } = boxes
  // Состояние стоит отдельной строкой под названием, а название не сжато до обрубка (раньше при
  // nowrap оно ужималось до ~96 px и читалось как «рое не по»: рамки не пересекались, но поле
  // было бесполезным)
  const where = `название ${JSON.stringify(title)}, состояние ${JSON.stringify(status)}`
  expect(status.top, where).toBeGreaterThanOrEqual(title.bottom - 1)
  expect(title.right - title.left, where).toBeGreaterThanOrEqual(200)
  expect(Number(await overflowOf(page))).toBeLessThanOrEqual(0)
})

test('вкладки на 375 px: выбранная вкладка не прячется за краем полосы', async ({
  page,
  demoSite,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const key = `tabs-${Date.now()}`
  const created = await sites[':siteId']['custom-blocks'].$post({
    param: { siteId: demoSite.id },
    json: { key, title: 'Вкладки' },
  })
  expect(created.status).toBe(201)
  await page.goto(`/blocks/${key}`)
  const tabs = page.getByRole('tablist').first()
  await expect(tabs.getByRole('tab')).toHaveCount(7)
  const last = tabs.getByRole('tab').last()
  await last.click()
  await expect(last).toBeInViewport({ ratio: 1 })
  // Назад по клавише Home: первая вкладка снова целиком на виду
  await page.keyboard.press('Home')
  await expect(tabs.getByRole('tab').first()).toBeInViewport({ ratio: 1 })
  // Тень у края: полоса листается, и у неё градиент-подсказка (приём background-attachment)
  const strip = (await page.evaluate(`(() => {
    const el = document.querySelector('[role=tablist]')
    return {
      scrolls: el.scrollWidth > el.clientWidth,
      image: getComputedStyle(el).backgroundImage,
    }
  })()`)) as { scrolls: boolean; image: string }
  expect(strip.scrolls).toBe(true)
  expect(strip.image.match(/linear-gradient/gu)?.length).toBe(4)
})

test('редактор на 375 px: заливка края вкладок — цвет полосы, а не страницы', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await editor(page).open()
  const colors = (await page.evaluate(`(() => {
    const list = document.querySelector('[role=tablist]')
    const strip = list.parentElement
    const own = getComputedStyle(list)
    const holder = [...document.querySelectorAll('*')].find((el) =>
      getComputedStyle(el).getPropertyValue('--tabs-backdrop').trim())
    const probe = document.createElement('i')
    probe.style.color = own.getPropertyValue('--tabs-cover')
    list.append(probe)
    const cover = getComputedStyle(probe).color
    probe.remove()
    const backdrop = getComputedStyle(holder).backgroundColor
    return { cover, backdrop, same: Boolean(holder && strip) }
  })()`)) as { cover: string; backdrop: string; same: boolean }
  expect(colors.cover).toBe(colors.backdrop)
})

test('активный пункт меню: полоска слева, жирный шрифт, не только заливка', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const current = page.locator('nav a[aria-current=page]').first()
  await expect(current).toBeVisible()
  await expect(current).toHaveCSS('font-weight', '600')
  const bar = (await page.evaluate(`(() => {
    const cs = getComputedStyle(document.querySelector('nav a[aria-current=page]'), '::before')
    return { color: cs.backgroundColor, width: cs.width }
  })()`)) as { color: string; width: string }
  expect(bar.color).not.toBe('rgba(0, 0, 0, 0)')
  expect(bar.width).toBe('3px')
})
