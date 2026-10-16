import { expect, test } from './fixtures'

// Блок «Состояние установки» на экране сайтов — только у владельца. Что в нём и кому он открыт,
// проверяют тесты API (modules/status); здесь — что владелец его видит, а участник нет

test('владелец видит состояние установки с версией, базой и почтой', async ({ page }) => {
  await page.goto('/')
  const section = page.getByRole('region', { name: 'Состояние установки' })
  await expect(section).toBeVisible()
  // API e2e без версии из образа и без папки состояния (бэкапов в разработке нет)
  await expect(section.getByRole('definition').first()).toHaveText('dev')
  await expect(section).toContainText('работает, миграций применено')
  await expect(section).toContainText('не ведётся на этой установке')
  await expect(section).toContainText('Почта')
})

test('участнику блока нет: API ему его не отдаст', async ({ page }) => {
  await page.route(/\/api\/me$/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, user: { ...body.user, role: 'member' } } })
  })
  let asked = false
  await page.route(/\/api\/status$/, async (route) => {
    asked = true
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сайты')
  await expect(page.getByRole('region', { name: 'Состояние установки' })).toHaveCount(0)
  expect(asked).toBe(false)
})
