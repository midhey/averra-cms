import { demoPage, demoPageTitle, MAIN_PAGE_SLUG } from '@averra/schema'
import type { Page } from '@playwright/test'
import { editor, expect, sidebar, siteScreen, sites, test } from './fixtures'

// Что админка прячет от клиента сайта. Роль подменяется в браузере — в ответах
// API о пользователе и о сайте: так один тест проверяет все экраны на демо-сайте
// с его страницами. Настоящего клиента заводит приглашение (invitations.spec.ts).
// Права это не проверяет (их решает API, см. apps/api/src/auth/access.test.ts):
// здесь только то, что экраны слушаются роли и не показывают недоступное

async function actAsClient(page: Page) {
  await page.route(/\/api\/me$/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, user: { ...body.user, role: 'member' } } })
  })
  await page.route(/\/api\/sites\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), access: 'client' } })
  })
}

test('клиенту не видны «Новая страница», «Удалить» и «Опубликовать»', async ({
  page,
  demoSite,
}) => {
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug: 'o-nas', title: 'О нас' },
  })
  expect(created.status).toBe(201)
  // Неопубликованная правка главной: без неё кнопки «Опубликовать правки» нет ни у кого,
  // и проверка «клиенту не видна» прошла бы и без проверки роли
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
  // Владелец кнопку видит: значит, клиенту её прячет именно роль
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Опубликовать правки' })).toBeVisible()

  await actAsClient(page)

  // Обзор — первый экран, как у всех: ни «Новой страницы», ни «Опубликовать правки», хоть правки и
  // есть
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(demoSite.name)
  await expect(page.getByRole('link', { name: 'Новая страница' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Опубликовать правки' })).toHaveCount(0)
  // Клиенту видны заявки (это его заявки), а почта и состояние установки — нет
  await expect(sidebar(page).section('Заявки')).toBeVisible()
  // Раздел «SEO» — только владельцу: индексацию, адрес и счётчики решает студия
  await expect(sidebar(page).section('SEO')).toHaveCount(0)
  await expect(sidebar(page).installation).toHaveCount(0)
  await expect(page.getByText('Клиент', { exact: true })).toBeVisible()

  await sidebar(page).section('Страницы').click()
  const screen = siteScreen(page)
  await expect(screen.row('О нас')).toBeVisible()
  await expect(screen.pages.getByRole('button')).toHaveCount(0)
  // Пустой колонки «Действия» у клиента нет
  await expect(screen.pages.getByRole('columnheader')).toHaveCount(4)
  await expect(screen.newPageForm).toHaveCount(0)
  await expect(page.getByText('Вы можете править черновики страниц')).toBeVisible()

  const ed = editor(page)
  await ed.open('o-nas')
  await expect(ed.saveButton).toBeVisible()
  await expect(ed.publishButton).toHaveCount(0)
})
