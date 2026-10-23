import { randomUUID } from 'node:crypto'
import { urls } from '../urls'
import { editor, expect, sites, test } from './fixtures'

// Каталог «Добавить блок» и блоки лендинга: цены, вопросы, цифры, шаги, текст с картинкой.
// Человек находит блок поиском или разделом, заполняет, публикует — посетитель видит его на сайте,
// и без JavaScript тоже

const QUESTION = 'Сколько стоит выезд мастера?'
const ANSWER = 'Выезд по городу бесплатный.'
const SECOND_QUESTION = 'Может ли цена вырасти по ходу работ?'
const PLAN = 'Эконом'

test('каталог: поиск, разделы, клавиатура; новые блоки — в редакторе и на сайте', async ({
  page,
  browser,
  demoSite,
}) => {
  // Разметку вопросов для поисковиков получает только открытая для поиска страница
  const opened = await sites[':siteId'].settings.$patch({
    param: { siteId: demoSite.id },
    json: { hideFromSearch: false },
  })
  expect(opened.status).toBe(200)
  const slug = `bloki-${randomUUID().slice(0, 8)}`
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug, title: 'Ремонт ванной', template: 'hero' },
  })
  expect(created.status, 'создание страницы').toBe(201)

  const ed = editor(page)
  await ed.open(slug)
  const dialog = ed.addBlockDialog
  const cards = dialog.getByRole('list', { name: 'Каталог блоков' }).getByRole('button')

  // Поиск: фокус сразу в поле, одно слово — одна карточка, дальше Tab и Enter
  await ed.addBlockButton.click()
  const search = dialog.getByRole('searchbox', { name: 'Найти блок' })
  await expect(search).toBeFocused()
  await expect(cards).toHaveCount(11)
  await page.keyboard.type('цены')
  await expect(cards).toHaveCount(1)
  await expect(dialog.getByRole('status')).toHaveText('Найдено: 1 блок')
  const pricingCard = dialog.getByRole('button', { name: /^Услуги и цены/ })
  await expect(pricingCard).toContainText('новый')
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('radio', { name: 'Все · 11' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(pricingCard).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(ed.inspector.getByRole('heading', { name: 'Услуги и цены' })).toBeVisible()

  // Тариф: название; второй выделенный — ошибка у флажка, сохранить нельзя
  await ed.inspector.getByLabel('Название', { exact: true }).first().fill(PLAN)
  const featured = ed.inspector.getByLabel('Выделить', { exact: true })
  await expect(featured.nth(1)).toBeChecked()
  await featured.first().check()
  await expect(featured.nth(1)).toHaveAttribute('aria-invalid', 'true')
  await expect(ed.inspector).toContainText('Выделить можно один тариф')
  await expect(ed.saveButton).toBeDisabled()
  await featured.first().uncheck()
  await expect(featured.nth(1)).not.toHaveAttribute('aria-invalid')

  // Раздел «Доверие» — радиокнопкой; каталог открывается заново без прежнего поиска
  await ed.addBlockButton.click()
  await expect(search).toHaveValue('')
  await dialog.getByRole('radio', { name: 'Доверие' }).check()
  await expect(cards).toHaveCount(2)
  await dialog.getByRole('button', { name: /^Вопросы и ответы/ }).click()
  await expect(dialog).toBeHidden()
  await ed.inspector.getByLabel('Вопрос', { exact: true }).first().fill(QUESTION)
  await ed.inspector.getByLabel('Ответ', { exact: true }).first().fill(ANSWER)
  await ed.inspector.getByLabel('Вопрос', { exact: true }).nth(1).fill(SECOND_QUESTION)

  await ed.addBlock('Цифры')
  await ed.addBlock('Как мы работаем')
  await ed.addBlock('Текст с картинкой')
  await expect(ed.blocks).toHaveCount(6)

  // Предпросмотр — те же компоненты: вопросы раскрываются, первый открыт
  await expect(ed.preview.locator('details').first()).toHaveAttribute('open', '')
  await expect(ed.preview.getByRole('heading', { level: 3, name: PLAN })).toBeVisible()

  await ed.publishButton.click()
  await expect(ed.status).toHaveText('Опубликовано. Обнови сайт, чтобы увидеть')

  // Посетитель без JavaScript: все блоки на месте, вопросы раскрываются кликом
  const context = await browser.newContext({ locale: 'ru-RU', javaScriptEnabled: false })
  const site = await context.newPage()
  await site.goto(`${urls.renderer}/${slug}`)
  await expect(site.getByRole('heading', { level: 3, name: PLAN })).toBeVisible()
  await expect(site.getByRole('link', { name: 'Обсудить' })).toHaveCount(3)
  await expect(site.getByText('Чаще выбирают')).toBeVisible()
  await expect(site.getByRole('heading', { name: 'Как мы работаем' })).toBeVisible()
  await expect(site.locator('ol[role="list"] > li')).toHaveCount(4)
  await expect(site.getByText('[340]')).toBeVisible()
  await expect(site.getByRole('heading', { name: 'О компании' })).toBeVisible()

  const answer = site.getByText(ANSWER)
  await expect(answer).toBeVisible()
  const second = site.locator('details').nth(1)
  await expect(second).not.toHaveAttribute('open')
  await expect(second.getByText('[Ответ: что фиксирует договор]')).toBeHidden()
  await second.getByText(SECOND_QUESTION).click()
  await expect(second.getByText('[Ответ: что фиксирует договор]')).toBeVisible()

  // Разметка FAQPage для поисковиков — данные, а не скрипт
  const jsonLd = await site.locator('script[type="application/ld+json"]').allTextContents()
  const faq = jsonLd.map((text) => JSON.parse(text)).find((data) => data['@type'] === 'FAQPage')
  expect(faq?.mainEntity[0]).toEqual({
    '@type': 'Question',
    name: QUESTION,
    acceptedAnswer: { '@type': 'Answer', text: ANSWER },
  })
  expect(faq?.mainEntity).toHaveLength(3)

  // Телефон: страница без горизонтальной прокрутки
  await site.setViewportSize({ width: 375, height: 812 })
  const overflow = await site.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )
  expect(overflow).toBe(0)
  await context.close()
})

test.describe('на телефоне', () => {
  // Палец, а не мышь: (pointer: coarse) — фокус не уходит в поиск
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

  test('каталог — список в одну колонку, без горизонтальной прокрутки', async ({ page }) => {
    const ed = editor(page)
    await ed.open()
    await ed.addBlockButton.click()
    const dialog = ed.addBlockDialog
    await expect(dialog).toBeVisible()
    // На телефоне фокус не прыгает в поиск: клавиатура закрыла бы каталог
    await expect(dialog.getByRole('searchbox', { name: 'Найти блок' })).not.toBeFocused()
    const cards = dialog.getByRole('list', { name: 'Каталог блоков' }).getByRole('button')
    const boxes = await Promise.all([0, 1, 2].map((index) => cards.nth(index).boundingBox()))
    const lefts = new Set(boxes.map((box) => Math.round(box?.x ?? -1)))
    expect(lefts.size).toBe(1)
    const overflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)
    expect(overflow).toBe(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
