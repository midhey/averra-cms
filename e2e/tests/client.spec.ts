import { demoPage, demoPageTitle, MAIN_PAGE_SLUG } from '@averra/schema'
import type { Page } from '@playwright/test'
import { editor, expect, sidebar, siteScreen, sites, test } from './fixtures'

// Что админка показывает администратору сайта (ключ client) и редактору. Роль подменяется
// в браузере — в ответах API о пользователе и о сайте: так один тест проверяет все экраны на
// демо-сайте с его страницами. Настоящих участников заводит приглашение (invitations.spec.ts,
// members.spec.ts). Права это не проверяет (их решает API, см. apps/api/src/auth/access.test.ts):
// здесь только то, что экраны слушаются роли и не показывают недоступное

async function actAs(page: Page, access: 'client' | 'editor') {
  await page.route(/\/api\/me$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, user: { ...body.user, role: 'member' } } })
  })
  await page.route(/\/api\/sites\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), access } })
  })
}

test('администратор сайта ведёт контент сам: «Новая страница», «Опубликовать», SEO и шапка', async ({
  page,
  demoSite,
}) => {
  // Неопубликованная правка главной: без неё кнопки «Опубликовать правки» нет ни у кого
  const saved = await sites[':siteId'].pages[':slug'].$put({
    param: { siteId: demoSite.id, slug: MAIN_PAGE_SLUG },
    json: {
      title: demoPageTitle,
      content: {
        blocks: demoPage.blocks.map((block) =>
          block.type === 'hero'
            ? { ...block, props: { ...block.props, title: `Правка ${Date.now()}` } }
            : block,
        ),
      },
    },
  })
  expect(saved.status).toBe(200)

  await actAs(page, 'client')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(demoSite.name)
  await expect(page.getByRole('link', { name: 'Новая страница' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Опубликовать правки' })).toBeVisible()
  // Заявки, шапка и SEO — его; тема, свои блоки и установка — студии
  await expect(sidebar(page).section('Заявки')).toBeVisible()
  await expect(sidebar(page).section('Шапка и подвал')).toBeVisible()
  await expect(sidebar(page).section('SEO')).toBeVisible()
  await expect(sidebar(page).section('Тема')).toHaveCount(0)
  await expect(sidebar(page).section('Свои блоки')).toHaveCount(0)
  await expect(sidebar(page).installation).toHaveCount(0)
  await expect(page.getByText('Администратор сайта', { exact: true })).toBeVisible()

  await sidebar(page).section('Страницы').click()
  await expect(siteScreen(page).newPageForm).toBeVisible()

  const ed = editor(page)
  await ed.open(MAIN_PAGE_SLUG)
  await expect(ed.saveButton).toBeVisible()
  await expect(ed.publishButton).toBeVisible()
})

test('редактору — страницы и медиатека: ни заявок, ни шапки, ни SEO, ни темы', async ({ page }) => {
  await actAs(page, 'editor')
  await page.goto('/')
  await expect(sidebar(page).section('Страницы')).toBeVisible()
  await expect(sidebar(page).section('Медиатека')).toBeVisible()
  for (const name of ['Заявки', 'Уведомления', 'Шапка и подвал', 'SEO', 'Тема', 'Свои блоки']) {
    await expect(sidebar(page).section(name), name).toHaveCount(0)
  }
  await expect(page.getByText('Редактор', { exact: true })).toBeVisible()
})

test('«Только просмотр» помечен, выключенные поля читаемы: тема у администратора, шапка у редактора', async ({
  page,
  demoSite,
}) => {
  expect(demoSite.id).toBeTruthy()
  for (const [access, path] of [
    ['client', '/theme'],
    ['editor', '/header'],
  ] as const) {
    await page.unrouteAll()
    await actAs(page, access)
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText('Только просмотр', { exact: true }).first()).toBeVisible()
    if (path !== '/theme') continue
    // Выключенное поле не бледнеет и отличается пунктиром, а не только цветом
    const field = page.locator(
      'input:disabled:not([type=color], [type=radio], [type=checkbox]), select:disabled',
    )
    await expect(field.first()).toBeVisible()
    await expect(field.first()).toHaveCSS('opacity', '1')
    await expect(field.first()).toHaveCSS('border-top-style', 'dashed')
    // Палитра в режиме просмотра тоже не выглядит рабочей
    const picker = page.locator('input[type=color]:disabled').first()
    await expect(picker).toHaveCSS('border-top-style', 'dashed')
  }
})
