import { readFile } from 'node:fs/promises'
import { demoPage, demoPageTitle, form, MAIN_PAGE_SLUG } from '@averra/schema'
import type { Browser } from '@playwright/test'
import { e2eOwner, urls } from '../urls'
import { editor, expect, ownerApi, sites, test } from './fixtures'
import { waitForMail } from './mailbox'

// Форма заявки на опубликованном сайте без JavaScript: посетитель отправляет обычную HTML-форму
// в API, видит «Спасибо» по якорю #…-sent (CSS :target), заявка — в разделе «Заявки» админки,
// письма — в файловом ящике e2e. Ловушка для ботов отвечает тем же «Спасибо», но ничего не пишет

const DEMO_SITE_NAME = 'Демо: ремонт квартир'
const SUCCESS = 'Спасибо! Заявка отправлена, мы скоро свяжемся с вами.'

let visitorCount = 0

/**
 * Посетитель сайта: свой контекст браузера без JavaScript и без входа в админку. Свой
 * X-Forwarded-For (API e2e доверяет прокси): лимит заявок с одного IP не делится между тестами
 */
async function visitor(browser: Browser, path = '') {
  visitorCount += 1
  const context = await browser.newContext({
    javaScriptEnabled: false,
    storageState: { cookies: [], origins: [] },
    locale: 'ru-RU',
    extraHTTPHeaders: { 'x-forwarded-for': `10.20.${Date.now() % 250}.${visitorCount}` },
  })
  const page = await context.newPage()
  await page.goto(`${urls.renderer}${path}`)
  return { context, page, form: page.getByRole('form', { name: form.example.title }) }
}

test('форма без JavaScript: посетитель отправляет — видит «Спасибо», заявка в админке, письма ушли', async ({
  page,
  browser,
}) => {
  // Владелец ставит форму из каталога и публикует: пример блока готов к работе
  const ed = editor(page)
  await ed.open()
  await ed.addBlock('Форма заявки')
  await expect(ed.inspector.getByRole('heading', { name: 'Форма заявки' })).toBeVisible()
  await expect(ed.field('Ссылка на политику конфиденциальности')).toHaveValue('/privacy')
  await ed.publishButton.click()
  await expect(ed.status).toHaveText('Опубликовано. Обнови сайт, чтобы увидеть')

  const email = `visitor-${Date.now()}@e2e.test`
  const site = await visitor(browser)
  try {
    await site.form.getByLabel('Имя').fill('Анна Тестова')
    await site.form.getByLabel('Телефон').fill('+7 900 123-45-67')
    await site.form.getByLabel('Почта').fill(email)
    await site.form.getByLabel('Комментарий').fill('Нужен ремонт ванной\nЗвонить после 18:00')
    await site.form.getByLabel('Я согласен на обработку персональных данных').check()
    await site.form.getByRole('button', { name: 'Отправить заявку' }).click()

    // 303 из API вернул на ту же страницу с якорем: CSS показывает «Спасибо» и прячет форму
    await expect(site.page).toHaveURL(`${urls.renderer}/#form-1-sent`)
    await expect(site.page.getByText(SUCCESS)).toBeVisible()
    await expect(site.form).toBeHidden()
  } finally {
    await site.context.close()
  }

  // Письмо владельцу: тема без ввода посетителя, Reply-To — посетитель, все поля
  const notice = await waitForMail(e2eOwner.email, `Новая заявка с сайта «${DEMO_SITE_NAME}»`)
  expect(notice.text).toContain('Имя: Анна Тестова')
  expect(notice.text).toContain('Комментарий: Нужен ремонт ванной\n  Звонить после 18:00')
  expect(notice.replyTo).toBe(email)
  // Подтверждение посетителю — фиксированный текст без того, что он ввёл
  const confirmation = await waitForMail(email, `Заявка получена — ${DEMO_SITE_NAME}`)
  expect(confirmation.text).not.toContain('Анна')

  // Заявка в админке: счётчик новых в панели, список, карточка рядом, «обработана»
  await page.goto('/')
  const leadsLink = page
    .getByRole('navigation', { name: 'Разделы сайта' })
    .getByRole('link', { name: /^Заявки/ })
  await expect(leadsLink).toContainText(/новых: \d+/)
  await leadsLink.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Заявки' })).toBeVisible()
  await page
    .getByRole('list', { name: 'Список заявок' })
    .getByRole('link')
    .filter({ hasText: 'Анна Тестова' })
    .first()
    .click()
  const card = page.getByRole('article', { name: 'Анна Тестова' })
  await expect(card).toBeVisible()
  await expect(card.getByText(email)).toBeVisible()
  await expect(card.getByText(/Я согласен на обработку персональных данных/)).toBeVisible()
  await expect(card.getByRole('link', { name: 'Ответить письмом' })).toHaveAttribute(
    'href',
    new RegExp(`^mailto:${email.replace(/[.]/g, '\\.')}\\?subject=`),
  )
  await page.getByRole('button', { name: 'Отметить обработанной' }).click()
  await expect(page.getByRole('status')).toHaveText('Заявка обработана')
  await expect(page.getByRole('button', { name: 'Вернуть в новые' })).toBeVisible()
})

test('ловушка для ботов: «Спасибо» на экране, но заявки и писем нет', async ({
  browser,
  demoSite,
}) => {
  // Форма на опубликованной главной — через API, быстрее, чем через редактор
  const param = { siteId: demoSite.id, slug: MAIN_PAGE_SLUG }
  const page = sites[':siteId'].pages[':slug']
  const content = {
    blocks: [...demoPage.blocks, { id: 'lead', type: 'form' as const, props: form.example }],
  }
  expect((await page.$put({ param, json: { title: demoPageTitle, content } })).status).toBe(200)
  expect((await page.publish.$post({ param })).status).toBe(200)

  const marker = `Бот ${Date.now()}`
  const email = `bot-${Date.now()}@e2e.test`
  const site = await visitor(browser)
  try {
    await site.form.getByLabel('Имя').fill(marker)
    await site.form.getByLabel('Телефон').fill('+7 900 000-00-00')
    await site.form.getByLabel('Почта').fill(email)
    await site.form.getByLabel('Я согласен на обработку персональных данных').check()
    // Ловушку человек не видит (она за краем экрана и скрыта от диктора), а бот заполняет
    await site.page.locator('input[name="website"]').fill('https://spam.example', { force: true })
    await site.form.getByRole('button', { name: 'Отправить заявку' }).click()
    await expect(site.page).toHaveURL(`${urls.renderer}/#lead-sent`)
    await expect(site.page.getByText(SUCCESS)).toBeVisible()
  } finally {
    await site.context.close()
  }

  // Заявка и письма пишутся в одной транзакции с ответом: проверять можно сразу
  const leads = await ownerApi.sites[':siteId'].leads.$get({
    param: { siteId: demoSite.id },
    query: {},
  })
  if (leads.status !== 200) throw new Error(`Список заявок: ${leads.status}`)
  const { items } = await leads.json()
  expect(JSON.stringify(items)).not.toContain(marker)
  const outbox = await ownerApi.mail.outbox.$get()
  expect(JSON.stringify(await outbox.json())).not.toContain(email)
})

test('форма на неглавной странице без JavaScript: после отправки — та же страница и «Спасибо»', async ({
  browser,
  demoSite,
}) => {
  // Браузер шлёт в API Referer без пути («http://сайт/»): API возвращает на страницу формы
  // по её адресу из маршрута приёма, а не на главную
  const slug = `o-nas-${Date.now()}`
  const param = { siteId: demoSite.id, slug }
  const page = sites[':siteId'].pages[':slug']
  const content = {
    blocks: [{ id: 'about-form', type: 'form' as const, props: form.example }],
  }
  expect((await page.$put({ param, json: { title: 'О нас', content } })).status).toBe(200)
  expect((await page.publish.$post({ param })).status).toBe(200)

  const site = await visitor(browser, `/${slug}`)
  try {
    await site.form.getByLabel('Имя').fill('Пётр Со Страницы')
    await site.form.getByLabel('Телефон').fill('+7 900 765-43-21')
    await site.form.getByLabel('Я согласен на обработку персональных данных').check()
    await site.form.getByRole('button', { name: 'Отправить заявку' }).click()
    await expect(site.page).toHaveURL(`${urls.renderer}/${slug}#about-form-sent`)
    await expect(site.page.getByText(SUCCESS)).toBeVisible()
    await expect(site.form).toBeHidden()
  } finally {
    await site.context.close()
  }
})

test('«Скачать CSV» в разделе «Заявки» скачивает файл потоком из API: BOM, колонки, заявка', async ({
  page,
  browser,
  demoSite,
}) => {
  const param = { siteId: demoSite.id, slug: MAIN_PAGE_SLUG }
  const pageApi = sites[':siteId'].pages[':slug']
  const content = {
    blocks: [...demoPage.blocks, { id: 'csv-form', type: 'form' as const, props: form.example }],
  }
  expect((await pageApi.$put({ param, json: { title: demoPageTitle, content } })).status).toBe(200)
  expect((await pageApi.publish.$post({ param })).status).toBe(200)

  const marker = `Выгрузка ${Date.now()}`
  const site = await visitor(browser)
  try {
    await site.form.getByLabel('Имя').fill(marker)
    await site.form.getByLabel('Телефон').fill('+7 900 111-22-33')
    await site.form.getByLabel('Я согласен на обработку персональных данных').check()
    await site.form.getByRole('button', { name: 'Отправить заявку' }).click()
    await expect(site.page.getByText(SUCCESS)).toBeVisible()
  } finally {
    await site.context.close()
  }

  await page.goto('/leads')
  await expect(page.getByRole('heading', { level: 1, name: 'Заявки' })).toBeVisible()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать CSV' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/)
  const bytes = await readFile(await download.path())
  // BOM: иначе Excel прочтёт UTF-8 как Windows-1251
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const [header, ...rows] = bytes.toString('utf8').slice(1).split('\r\n')
  expect(header).toMatch(/^"Дата \(МСК\)";"Статус";"Страница";"Форма";.*"Имя";.*"Телефон"/)
  const row = rows.find((line) => line.includes(`"${marker}"`))
  expect(row).toContain(`"'+7 900 111-22-33"`)
  await expect(page.getByRole('status')).toHaveText('Файл CSV со всеми заявками скачан')
})
