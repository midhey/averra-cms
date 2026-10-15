import type { Page } from '@playwright/test'
import { editor, expect, siteScreen, sites, test } from './fixtures'

// Что админка прячет от клиента сайта. Роль подменяется в браузере — в ответах API о пользователе
// и о сайте: так один тест проверяет все экраны на демо-сайте с его страницами. Настоящего клиента
// заводит приглашение (invitations.spec.ts). Права это не проверяет (их решает API, см. apps/api/src/auth/access.test.ts):
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

test('клиенту не видны «Новый сайт», «Новая страница», «Удалить» и «Опубликовать»', async ({
  page,
  demoSite,
}) => {
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug: 'o-nas', title: 'О нас' },
  })
  expect(created.status).toBe(201)
  await actAsClient(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сайты')
  await expect(page.getByRole('form', { name: 'Новый сайт' })).toHaveCount(0)

  await page.goto(`/sites/${demoSite.id}`)
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
