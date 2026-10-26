import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { publishDir } from '../urls'
import { expect, sites, test } from './fixtures'
import { serveRelease } from './release-server'

// Cookie-уведомление на собранном сайте: владелец включает Метрику, сайт собирается на «сервере»
// (PUBLISH_DIR), и посетитель открывает версию из папки релиза — как её отдал бы Caddy. Запросы к
// счётчикам перехватываются: наружу тест не ходит, но видно, когда страница их запросила

const METRIKA = '98765432'
const METRIKA_SCRIPT = 'script[src="https://mc.yandex.ru/metrika/tag.js"]'

/** Посетитель: свой браузер без входа, счётчики отвечают пустым скриптом */
async function visitor(browser: Browser, options: { javaScriptEnabled?: boolean } = {}) {
  const context = await browser.newContext({ locale: 'ru-RU', ...options })
  const requested: string[] = []
  await context.route(/^https:\/\/(mc\.yandex\.ru|www\.googletagmanager\.com)\//, (route) => {
    requested.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
  })
  return { context, requested }
}

const currentIndex = (siteId: string) => join(publishDir, siteId, 'current', 'index.html')
const servedIndex = async (siteId: string) =>
  existsSync(currentIndex(siteId)) ? readFile(currentIndex(siteId), 'utf8') : ''

const notice = (page: Page) => page.getByRole('region', { name: 'Cookie на этом сайте' })
const consentCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((cookie) => cookie.name === 'averra_consent')?.value

test('режим согласия на собранном сайте: Метрика только после «Принять все», выбор помнится', async ({
  browser,
  demoSite,
}) => {
  test.slow()
  const param = { siteId: demoSite.id }
  // Политика из шаблона, опубликованная: ссылка на неё — в уведомлении и внизу страниц
  const legal = await sites[':siteId'].settings['legal-pages'].$post({
    param,
    json: { document: 'privacy' },
  })
  expect(legal.status).toBe(201)
  const published = await sites[':siteId'].pages[':slug'].publish.$post({
    param: { ...param, slug: 'privacy' },
  })
  expect(published.status).toBe(200)
  const saved = await sites[':siteId'].settings.$patch({
    param,
    json: { analytics: { metrika: METRIKA }, cookies: { policyPage: 'privacy' } },
  })
  expect(saved.status).toBe(200)
  await expect
    .poll(() => servedIndex(demoSite.id), { timeout: 120_000 })
    .toContain(`data-metrika="${METRIKA}"`)
  const html = await servedIndex(demoSite.id)
  // В HTML нет ни одного скрипта счётчика: только уведомление и его модуль
  expect(html).not.toContain('mc.yandex.ru')
  expect(html).not.toContain('<noscript>')

  const site = await serveRelease(join(publishDir, demoSite.id, 'current'))
  try {
    // До согласия — уведомление, счётчика нет
    const first = await visitor(browser)
    const page = await first.context.newPage()
    await page.goto(site.url)
    await expect(notice(page)).toBeVisible()
    await expect(
      notice(page).getByRole('link', { name: 'Политика конфиденциальности' }),
    ).toHaveAttribute('href', '/privacy')
    await expect(page.locator(METRIKA_SCRIPT)).toHaveCount(0)
    expect(first.requested).toEqual([])
    // Кнопки равные: один класс у «Принять все» и «Только необходимые»
    const accept = notice(page).getByRole('button', { name: 'Принять все' })
    const necessary = notice(page).getByRole('button', { name: 'Только необходимые' })
    expect(await accept.getAttribute('class')).toBe(await necessary.getAttribute('class'))

    await accept.click()
    await expect(notice(page)).toBeHidden()
    await expect(page.locator(METRIKA_SCRIPT)).toHaveCount(1)
    expect(
      first.requested.some((url) => url.startsWith('https://mc.yandex.ru/metrika/tag.js')),
    ).toBe(true)
    // Согласие — на названный сервис: ym — Метрика. Добавят GA4 — сайт спросит снова
    expect(await consentCookie(first.context)).toBe('analytics.ym')

    // Выбор помнится: после перезагрузки уведомления нет, счётчик грузится сразу
    await page.reload()
    await expect(page.locator(METRIKA_SCRIPT)).toHaveCount(1)
    await expect(notice(page)).toBeHidden()

    // «Настройки cookie» внизу страницы — окно с фокусом внутри; Esc закрывает
    await page.getByRole('button', { name: 'Настройки cookie' }).click()
    const dialog = page.getByRole('dialog', { name: 'Настройки cookie' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('switch', { name: /Аналитика/ })).toBeChecked()
    expect(
      await dialog.evaluate((element) => element.contains(element.ownerDocument.activeElement)),
    ).toBe(true)
    for (let step = 0; step < 6; step++) await page.keyboard.press('Tab')
    expect(
      await dialog.evaluate((element) => element.contains(element.ownerDocument.activeElement)),
    ).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Настройки cookie' })).toBeFocused()
    await first.context.close()

    // «Только необходимые» — счётчика нет ни сейчас, ни после перезагрузки
    const second = await visitor(browser)
    const other = await second.context.newPage()
    await other.goto(site.url)
    await notice(other).getByRole('button', { name: 'Только необходимые' }).click()
    await expect(notice(other)).toBeHidden()
    expect(await consentCookie(second.context)).toBe('necessary')
    await other.reload()
    await expect(notice(other)).toBeHidden()
    await expect(other.locator(METRIKA_SCRIPT)).toHaveCount(0)
    expect(second.requested).toEqual([])

    // Передумал в окне настроек: включил аналитику и сохранил — счётчик загрузился
    await other.getByRole('button', { name: 'Настройки cookie' }).click()
    const settings = other.getByRole('dialog', { name: 'Настройки cookie' })
    await settings.getByRole('switch', { name: /Аналитика/ }).check()
    await settings.getByRole('button', { name: 'Сохранить выбор' }).click()
    await expect(settings).toBeHidden()
    await expect(other.locator(METRIKA_SCRIPT)).toHaveCount(1)
    expect(await consentCookie(second.context)).toBe('analytics.ym')
    await second.context.close()

    // Без JS: уведомления нет, счётчика нет, страница и ссылка на политику на месте
    const noJs = await visitor(browser, { javaScriptEnabled: false })
    const plain = await noJs.context.newPage()
    await plain.goto(site.url)
    await expect(plain.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(notice(plain)).toBeHidden()
    await expect(plain.getByRole('button', { name: 'Настройки cookie' })).toBeHidden()
    await expect(
      plain.getByRole('contentinfo').getByRole('link', { name: 'Политика конфиденциальности' }),
    ).toBeVisible()
    await plain.goto(`${site.url}/privacy`)
    await expect(plain.getByRole('heading', { level: 1 })).toHaveText('Политика конфиденциальности')
    expect(noJs.requested).toEqual([])
    await noJs.context.close()
  } finally {
    site.close()
  }
})

test('экран «Cookie и согласие»: режим, вид, предпросмотр и политика из шаблона', async ({
  page,
}) => {
  await page.goto('/seo')
  await page.getByRole('link', { name: 'Cookie и согласие' }).first().click()
  await expect(page).toHaveURL('/seo/cookies')
  await expect(page.getByRole('heading', { level: 1, name: 'Cookie и согласие' })).toBeVisible()
  // Без счётчиков уведомления на сайте нет — экран говорит об этом
  await expect(page.getByText('На сайте нет счётчиков — уведомления нет')).toBeVisible()
  await expect(page.getByRole('radio', { name: /Согласие до аналитики/ })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Карточка в углу' })).toBeChecked()

  // Предпросмотр — уведомление в iframe теми же компонентами, что на сайте
  const preview = page.frameLocator('iframe[title="Предпросмотр уведомления о cookie"]')
  await expect(preview.getByRole('button', { name: 'Принять все' })).toBeVisible()
  await page.getByRole('radio', { name: 'Только уведомление' }).check()
  await expect(preview.getByRole('button', { name: 'Понятно' })).toBeVisible()
  await page.getByRole('radio', { name: 'Плашка снизу' }).check()
  await expect(preview.locator('[data-look="bar"][data-consent-notice]')).toBeVisible()

  // Политика из шаблона: черновик и выбор страницы
  const legal = page.getByRole('region', { name: 'Тексты и политика' })
  await expect(legal.getByText(/Страница политики не выбрана/)).toBeVisible()
  await legal
    .getByText('Политика конфиденциальности', { exact: true })
    .locator('..')
    .getByRole('button', { name: 'Создать из шаблона' })
    .click()
  await expect(legal.getByRole('status')).toContainText('проверьте его с юристом', {
    ignoreCase: true,
  })
  await expect(page.getByLabel('Страница политики конфиденциальности')).toHaveValue('privacy')
  await expect(legal.getByText(/ещё не опубликована/)).toBeVisible()
  await expect(legal.getByRole('link', { name: 'Открыть /privacy в редакторе' })).toBeVisible()

  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Настройки cookie сохранены' }),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Плашка снизу' })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Только уведомление' })).toBeChecked()

  // Черновик политики открывается в редакторе: первый блок — пометка «проверьте с юристом»
  await page.getByRole('link', { name: 'Открыть /privacy в редакторе' }).click()
  await expect(page).toHaveURL('/pages/privacy')
  await expect(page.getByLabel('Заголовок страницы')).toHaveValue('Политика конфиденциальности')
  await expect(
    page.getByRole('navigation', { name: 'Блоки страницы' }).getByText(/проверьте с юристом/),
  ).toBeVisible()
})
