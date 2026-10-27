import type { Browser, Page } from '@playwright/test'
import { urls } from '../urls'
import { editor, expect, sites, test } from './fixtures'

// Подвал сайта: владелец выбирает «Большой» на вкладке «Подвал» экрана «Шапка и подвал»,
// публикация без политики не проходит, с ней — проходит. На сайте без JS на 1440 и 375 подвал
// умещается, в нём разделы из меню шапки, контакты и реквизиты из «Организации», политика; форма
// «Перезвоните мне» без JS создаёт заявку, она в админке с пометкой «подвал». «Настройки cookie»
// из подвала со скриптом открывают окно настроек. Подвал демо-сайта после теста убирает фикстура

const ORGANIZATION = {
  name: 'ИП Иванов Иван Иванович',
  phone: '+7 (342) 200-10-10',
  email: 'info@remont-ivana.ru',
  address: { city: 'Пермь', street: 'ул. Ленина, 1' },
  socials: ['https://vk.com/remont_ivana', 'https://t.me/remont_ivana'],
  inn: '590000000000',
  ogrn: '304590000000000',
}

let visitorCount = 0

/**
 * Посетитель сайта (рендерер e2e берёт свежий снимок на каждый запрос): свой контекст без входа,
 * свой X-Forwarded-For — лимит заявок с одного IP не делится между тестами
 */
async function visitor(browser: Browser, width: number, javaScriptEnabled: boolean) {
  visitorCount += 1
  const context = await browser.newContext({
    javaScriptEnabled,
    storageState: { cookies: [], origins: [] },
    locale: 'ru-RU',
    viewport: { width, height: width < 768 ? 812 : 900 },
    extraHTTPHeaders: { 'x-forwarded-for': `10.30.${Date.now() % 250}.${visitorCount}` },
  })
  return { context, page: await context.newPage() }
}

const noHorizontalScroll = async (page: Page) =>
  (await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )) === 0

test('большой подвал: публикация с политикой, на сайте без JS, форма «Перезвоните мне» — заявка с пометкой «подвал»', async ({
  page,
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  const param = { siteId: demoSite.id }
  // «Организация» — реквизиты, контакты и соцсети подвала. Меню шапки — разделы подвала
  const organization = await sites[':siteId'].settings.$patch({
    param,
    json: { organization: ORGANIZATION },
  })
  expect(organization.status).toBe(200)
  const header = sites[':siteId'].header
  const menu = [
    { label: 'Почему мы', page: 'index', block: 'benefits' },
    { label: 'Связаться', page: 'index', block: 'contact' },
  ]
  expect((await header.$put({ param, json: { menu } })).status).toBe(200)
  expect((await header.publish.$post({ param })).status).toBe(200)

  await page.goto('/header')
  await page.getByRole('tab', { name: 'Подвал' }).click()
  await expect(page.getByText('Подвал пока не опубликован')).toBeVisible()
  await page.getByRole('radio', { name: /^Большой/ }).check()
  await page.getByRole('radio', { name: 'Акцент' }).check()
  await expect(page.getByText(/Политика конфиденциальности не выбрана/)).toBeVisible()
  await page.getByRole('textbox', { name: 'Заголовок формы' }).fill('Есть вопросы?')

  // Предпросмотр — настоящий подвал под главной: разделы из меню, контакты. Формы пока нет —
  // как и на сайте, без опубликованной политики её не показывают
  const preview = page.frameLocator('iframe[title="Предпросмотр подвала"]')
  const previewFooter = preview.getByRole('contentinfo')
  await expect(previewFooter).toHaveAttribute('data-tone', 'accent')
  await expect(previewFooter.getByRole('heading', { name: 'Есть вопросы?' })).toHaveCount(0)
  await expect(
    previewFooter.getByRole('navigation', { name: 'Разделы сайта' }).getByRole('link'),
  ).toHaveText(['Почему мы', 'Связаться'])
  await expect(previewFooter.getByRole('link', { name: '+7 (342) 200-10-10' })).toBeVisible()

  // Без опубликованной политики большой подвал не опубликовать: понятная ошибка, фокус на виде
  await page.getByRole('button', { name: 'Опубликовать подвал' }).click()
  await expect(
    page.getByText(/^Не удалось опубликовать: Подвал не опубликовать: в большом подвале форма/),
  ).toBeVisible()
  await expect(page.getByRole('radio', { name: /^Большой/ })).toBeFocused()

  // Политика из шаблона, опубликованная и выбранная в «Cookie и согласие»
  const legal = await sites[':siteId'].settings['legal-pages'].$post({
    param,
    json: { document: 'privacy' },
  })
  expect(legal.status).toBe(201)
  expect(
    (await sites[':siteId'].pages[':slug'].publish.$post({ param: { ...param, slug: 'privacy' } }))
      .status,
  ).toBe(200)
  const policy = await sites[':siteId'].settings.$patch({
    param,
    json: { cookies: { policyPage: 'privacy' } },
  })
  expect(policy.status).toBe(200)

  await page.reload()
  await page.getByRole('tab', { name: 'Подвал' }).click()
  // Черновик сохранён попыткой публикации: вид и фон на месте
  await expect(page.getByRole('radio', { name: /^Большой/ })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Акцент' })).toBeChecked()
  await expect(page.getByText(/Политика конфиденциальности не выбрана/)).toBeHidden()
  await expect(previewFooter.getByRole('heading', { name: 'Есть вопросы?' })).toBeVisible()
  await page.getByRole('button', { name: 'Опубликовать подвал' }).click()
  await expect(page.getByText(/Подвал опубликован/)).toBeVisible()
  await expect(page.getByText('Опубликован', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('admin-footer-1440.png'), fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('admin-footer-375.png'), fullPage: true })

  // Сайт без JS на широком экране и телефоне: подвал целиком, без горизонтальной прокрутки
  for (const width of [1440, 375]) {
    const site = await visitor(browser, width, false)
    await site.page.goto(urls.renderer)
    const footer = site.page.getByRole('contentinfo')
    await expect(footer).toHaveAttribute('data-tone', 'accent')
    await expect(footer.getByRole('heading', { name: 'Есть вопросы?' })).toBeVisible()
    await expect(
      footer.getByRole('navigation', { name: 'Разделы сайта' }).getByRole('link'),
    ).toHaveText(['Почему мы', 'Связаться'])
    await expect(footer.getByRole('link', { name: '+7 (342) 200-10-10' })).toHaveAttribute(
      'href',
      'tel:+73422001010',
    )
    await expect(footer.getByRole('link', { name: 'VK — ВКонтакте' })).toHaveAttribute(
      'href',
      'https://vk.com/remont_ivana',
    )
    await expect(footer).toContainText(
      'ИП Иванов Иван Иванович · ИНН 590000000000 · ОГРНИП 304590000000000',
    )
    await expect(
      footer.getByRole('link', { name: 'Политика конфиденциальности', exact: true }),
    ).toHaveAttribute('href', '/privacy')
    // Счётчиков нет — и «Настроек cookie» нет
    await expect(footer.getByRole('button', { name: 'Настройки cookie' })).toHaveCount(0)
    expect(await noHorizontalScroll(site.page)).toBe(true)
    await footer.scrollIntoViewIfNeeded()
    await footer.screenshot({ path: testInfo.outputPath(`site-footer-${width}-nojs.png`) })
    await site.context.close()
  }

  // Форма подвала без JS: «Спасибо» на той же странице, заявка — в админке с пометкой «подвал»
  const phone = `+7 900 ${String(Date.now()).slice(-3)}-00-00`
  const site = await visitor(browser, 375, false)
  await site.page.goto(urls.renderer)
  const form = site.page.getByRole('form', { name: 'Есть вопросы?' })
  await form.getByLabel('Телефон').fill(phone)
  await form.getByLabel('Я согласен на обработку персональных данных').check()
  await form.getByRole('button', { name: 'Перезвоните мне' }).click()
  await expect(site.page).toHaveURL(`${urls.renderer}/?sent=~footer#~footer-sent`)
  await expect(site.page.getByText('Спасибо! Мы получили номер и скоро перезвоним.')).toBeVisible()
  await expect(form).toBeHidden()

  // Своей страницы 404 у демо-сайта нет: стандартной нет в базе, API заявку с неё не примет —
  // подвал на ней большой, но без формы, чтобы посетитель не заполнял то, что теряет заявку
  await site.page.goto(`${urls.renderer}/net-takoy-stranicy`)
  const notFoundFooter = site.page.getByRole('contentinfo')
  await expect(notFoundFooter).toHaveAttribute('data-layout', 'big')
  await expect(notFoundFooter.getByRole('form')).toHaveCount(0)
  await expect(
    notFoundFooter.getByRole('link', { name: 'Политика конфиденциальности', exact: true }),
  ).toBeVisible()
  await site.context.close()

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/leads')
  const item = page
    .getByRole('list', { name: 'Список заявок' })
    .getByRole('link')
    .filter({ hasText: phone })
  await expect(item).toContainText('подвал, форма «Есть вопросы?»')
  await item.click()
  await expect(page.getByText(/форма в подвале сайта «Есть вопросы\?»/)).toBeVisible()
})

test('простой подвал: «Настройки cookie» из подвала открывают окно, скрытый на странице — только документы', async ({
  page: admin,
  browser,
  demoSite,
}) => {
  test.slow()
  const param = { siteId: demoSite.id }
  const legal = await sites[':siteId'].settings['legal-pages'].$post({
    param,
    json: { document: 'privacy' },
  })
  expect(legal.status).toBe(201)
  const page = sites[':siteId'].pages[':slug']
  expect((await page.publish.$post({ param: { ...param, slug: 'privacy' } })).status).toBe(200)
  const settings = await sites[':siteId'].settings.$patch({
    param,
    json: {
      analytics: { metrika: '12345678' },
      cookies: { policyPage: 'privacy' },
      organization: { name: 'ООО «Ремонт»', inn: '5900000000' },
    },
  })
  expect(settings.status).toBe(200)
  // Промо-страница: подвал на ней скрывают флажком в редакторе (панель «SEO») и публикуют
  const promo = await page.$put({
    param: { ...param, slug: 'promo' },
    json: {
      title: 'Промо',
      content: { blocks: [{ id: 'hero', type: 'hero', props: { title: 'Акция месяца' } }] },
    },
  })
  expect(promo.status).toBe(200)
  const ed = editor(admin)
  await ed.open('promo')
  await admin.getByRole('button', { name: /^SEO/ }).click()
  await admin
    .getByRole('complementary', { name: 'SEO страницы' })
    .getByLabel('Скрыть подвал на этой странице')
    .check()
  await ed.publishButton.click()
  await expect(ed.status).toHaveText(/Опубликовано/)
  const footer = sites[':siteId'].footer
  expect((await footer.$put({ param, json: { layout: 'simple' } })).status).toBe(200)
  expect((await footer.publish.$post({ param })).status).toBe(200)

  // Предпросмотр на экране «Cookie и согласие» — документы там, где их видит посетитель: в нижней
  // строке опубликованного подвала, а не в прежней полосе
  await admin.goto('/seo/cookies')
  const cookiePreview = admin
    .frameLocator('iframe[title="Предпросмотр уведомления о cookie"]')
    .getByRole('contentinfo')
  await expect(cookiePreview).toHaveAttribute('data-layout', 'simple')
  await expect(
    cookiePreview.getByRole('link', { name: 'Политика конфиденциальности', exact: true }),
  ).toBeVisible()

  const site = await visitor(browser, 375, true)
  await site.page.goto(urls.renderer)
  // Уведомление в углу закрыло бы подвал на телефоне: сначала ответ на него
  await site.page
    .getByRole('region', { name: 'Cookie на этом сайте' })
    .getByRole('button', { name: 'Только необходимые' })
    .click()
  const bottom = site.page.getByRole('contentinfo')
  await expect(bottom).toHaveAttribute('data-layout', 'simple')
  await expect(bottom).toContainText('ООО «Ремонт» · ИНН 5900000000')
  // Кнопку показывает скрипт cookie-уведомления — та же, что была у прежней полосы
  await bottom.getByRole('button', { name: 'Настройки cookie' }).click()
  await expect(site.page.getByRole('dialog', { name: 'Настройки cookie' })).toBeVisible()
  await site.page.keyboard.press('Escape')
  expect(await noHorizontalScroll(site.page)).toBe(true)

  // Подвал скрыт — внизу прежняя полоса: политика и «Настройки cookie» остаются
  await site.page.goto(`${urls.renderer}/promo`)
  const legalStrip = site.page.getByRole('contentinfo')
  await expect(legalStrip).not.toHaveAttribute('data-site-footer', '')
  await expect(legalStrip.getByRole('link', { name: 'Политика конфиденциальности' })).toBeVisible()
  await expect(legalStrip.getByRole('button', { name: 'Настройки cookie' })).toBeVisible()
  await site.context.close()
})
