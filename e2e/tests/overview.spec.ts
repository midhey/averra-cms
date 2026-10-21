import { demoPage, demoPageTitle, MAIN_PAGE_SLUG } from '@averra/schema'
import { urls } from '../urls'
import { answerDialogs, demo, expect, openSite, sidebar, siteScreen, sites, test } from './fixtures'

// Обзор сайта по концепту (Main.dc.html): строка сведений, «Опубликовать правки», карточки,
// таблица страниц и боковая панель. Публикацию как таковую проверяют publish.spec.ts и тесты API

test('обзор: что опубликовано, карточки и таблица страниц; поиск по страницам', async ({
  page,
  demoSite,
}) => {
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug: 'ceny', title: 'Цены' },
  })
  expect(created.status).toBe(201)

  await page.goto('/')
  const screen = siteScreen(page)
  await expect(screen.heading).toHaveText(demoSite.name)
  await expect(page.getByText(/^Опубликован /)).toBeVisible()
  // Новый черновик — не «правки»: публикуется из редактора
  await expect(page.getByText(/^Неопубликованные правки/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Опубликовать правки' })).toHaveCount(0)

  const stats = page.getByRole('region', { name: 'Коротко' })
  await expect(stats).toContainText('Страницы')
  await expect(stats).toContainText('1 опубликована, 1 черновик')
  await expect(stats.getByRole('link', { name: /Новые заявки/ })).toHaveAttribute(
    'href',
    '/leads?status=new',
  )

  await expect(screen.row('/ceny')).toContainText('Черновик')
  await expect(screen.row(demo.pageTitle)).toContainText('Опубликована')
  await expect(screen.row('/ceny').locator('time')).toHaveAttribute('datetime', /^2\d{3}-/)

  const search = page.getByRole('searchbox', { name: 'Найти страницу' })
  await search.fill('цен')
  await expect(screen.pages.getByRole('row')).toHaveCount(2)
  await expect(screen.row('/ceny')).toBeVisible()
  await search.fill('нет-такой')
  await expect(page.getByRole('heading', { name: 'Ничего не нашлось' })).toBeVisible()
})

test('«Опубликовать правки» публикует изменённые страницы, а новый черновик не трогает', async ({
  page,
  demoSite,
}) => {
  const param = { siteId: demoSite.id, slug: MAIN_PAGE_SLUG }
  const title = `Правка с обзора ${Date.now()}`
  const blocks = demoPage.blocks.map((block) =>
    block.type === 'hero' ? { ...block, props: { ...block.props, title } } : block,
  )
  const saved = await sites[':siteId'].pages[':slug'].$put({
    param,
    json: { title: demoPageTitle, content: { blocks } },
  })
  expect(saved.status).toBe(200)
  const draft = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug: 'chernovik', title: 'Черновик акции' },
  })
  expect(draft.status).toBe(201)

  await page.goto('/')
  const screen = siteScreen(page)
  await expect(page.getByText('Неопубликованные правки на 1 странице')).toBeVisible()
  await expect(screen.row(demo.pageTitle)).toContainText('Есть правки')

  // Сначала вопрос со списком страниц: «Отмена» ничего не публикует
  const dialogs = answerDialogs(page, [false, true])
  await page.getByRole('button', { name: 'Опубликовать правки' }).click()
  await expect.poll(() => dialogs.length).toBe(1)
  expect(dialogs[0]).toBe(
    `Опубликовать правки на сайте: «${demo.pageTitle}»? Сайт обновится после сборки.`,
  )
  await expect(screen.row(demo.pageTitle)).toContainText('Есть правки')
  await page.getByRole('button', { name: 'Опубликовать правки' }).click()
  await expect.poll(() => dialogs.length).toBe(2)
  await expect(page.getByRole('status').filter({ hasText: 'Правки опубликованы' })).toHaveText(
    'Правки опубликованы: 1 страница. Сайт обновится после сборки.',
  )
  await expect(screen.row(demo.pageTitle)).toContainText('Опубликована')
  await expect(screen.row('/chernovik')).toContainText('Черновик')
  await expect(page.getByRole('button', { name: 'Опубликовать правки' })).toHaveCount(0)

  const site = await openSite(page)
  await expect(site.getByRole('heading', { level: 1 })).toHaveText(title)
  const missing = await page.request.get(`${urls.renderer}/chernovik`)
  expect(missing.status()).toBe(404)
})

test('панель: название и домен сайта вместо выбора сайта, выбранный раздел отмечен', async ({
  page,
  demoSite,
}) => {
  await page.goto('/')
  const panel = sidebar(page)
  // Одна установка — один сайт: в заголовке панели его название и домен, раскрывать нечего
  await expect(panel.siteLink.locator('xpath=..')).toContainText(demoSite.name)
  await expect(page.getByRole('button', { name: /выбрать другой сайт/ })).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Сайты' })).toHaveCount(0)

  await expect(panel.section('Обзор')).toHaveAttribute('aria-current', 'page')
  await expect(panel.section('Медиатека')).not.toHaveAttribute('aria-current')

  await panel.section('Медиатека').click()
  await expect(page).toHaveURL('/media')
  await expect(panel.section('Медиатека')).toHaveAttribute('aria-current', 'page')
  await expect(panel.section('Обзор')).not.toHaveAttribute('aria-current')

  // Домен открывает опубликованный сайт в новой вкладке, админка остаётся на месте
  const [site] = await Promise.all([page.context().waitForEvent('page'), panel.siteLink.click()])
  await site.waitForLoadState()
  await expect(site.getByRole('heading', { level: 1 })).toHaveText(demo.heroTitle)
  await site.close()
  await expect(page).toHaveURL('/media')
})

test('сборка не загрузилась — обзор открыт, карточка говорит это и даёт «Повторить»', async ({
  page,
  demoSite,
}) => {
  let failing = true
  await page.route(/\/api\/sites\/[^/]+\/build$/, (route) =>
    failing && route.request().method() === 'GET'
      ? route.fulfill({
          status: 403,
          json: { error: { code: 'forbidden', message: 'Сборка сейчас недоступна' } },
        })
      : route.continue(),
  )
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(demoSite.name)
  const stats = page.getByRole('region', { name: 'Коротко' })
  await expect(stats).toContainText('Не загрузилась')
  await expect(stats).toContainText('Сборка сейчас недоступна')

  failing = false
  await stats.getByRole('button', { name: 'Повторить' }).click()
  await expect(stats).not.toContainText('Не загрузилась')
  await expect(stats.getByRole('button', { name: 'Повторить' })).toHaveCount(0)
})
