import type { Page } from '@playwright/test'
import { demo, editor, expect, sidebar, test } from './fixtures'

// Оболочка и экраны на ширине телефона: нет горизонтальной прокрутки страницы, меню открывается
// кнопкой и закрывается Esc. И что панель прячет от роли (подмена роли в ответах API, как
// в client.spec.ts; права проверяют тесты API)

const overflowOf = (page: Page) =>
  page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')

test('на 375 px ни один экран не прокручивается вбок', async ({ page, demoSite }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const screens = [
    '/',
    `/sites/${demoSite.id}`,
    `/sites/${demoSite.id}/pages`,
    `/sites/${demoSite.id}/media`,
    `/sites/${demoSite.id}/leads`,
    `/sites/${demoSite.id}/settings`,
    '/mail',
    '/status',
    `/sites/${demoSite.id}/pages/index`,
  ]
  for (const path of screens) {
    await page.goto(path)
    // У редактора h1 только для диктора: на виду поле заголовка страницы
    await expect(page.getByRole('heading', { level: 1 })).toBeAttached()
    expect(Number(await overflowOf(page)), path).toBeLessThanOrEqual(0)
  }
})

test('на телефоне панель — меню: кнопка, Esc закрывает и возвращает фокус, переход закрывает', async ({
  page,
  demoSite,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`/sites/${demoSite.id}`)
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
  await expect(page).toHaveURL(`/sites/${demoSite.id}/pages`)
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

test('редактору сайта панель не показывает заявки и установку', async ({ page, demoSite }) => {
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
  await page.goto(`/sites/${demoSite.id}`)
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
  await expect(tabs.getByRole('tab')).toHaveText(['Блоки', 'Предпросмотр', 'Поля'])
  await expect(tabs.getByRole('tab', { name: 'Блоки' })).toHaveAttribute('aria-selected', 'true')
  await expect(ed.blockList).toBeVisible()
  await expect(ed.inspector).toBeHidden()
  await expect(ed.previewFrame).toBeHidden()

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
})
