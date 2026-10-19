import { expect, test } from './fixtures'

// Экран «Состояние установки» — только у владельца, пункт «Состояние» в панели. Что в нём
// и кому он открыт, проверяют тесты API (modules/status); здесь — что владелец его видит,
// а участник нет

test('владелец видит состояние установки с версией, базой и почтой', async ({ page }) => {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Установка' })
    .getByRole('link', { name: /^Состояние/ })
    .click()
  await expect(page).toHaveURL('/status')
  await expect(page).toHaveTitle('Состояние установки — Averra CMS')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Состояние установки')
  const section = page.getByRole('region', { name: 'Сведения' })
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
  await expect(page.getByRole('navigation', { name: 'Установка' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Состояние/ })).toHaveCount(0)
  expect(asked).toBe(false)
})

test('участник по прямому адресу /status — понятный отказ, а не пустой экран', async ({ page }) => {
  const ownerOnly = 'Состояние установки видит только владелец'
  await page.route(/\/api\/me$/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, user: { ...body.user, role: 'member' } } })
  })
  await page.route(/\/api\/status$/, (route) =>
    route.fulfill({ status: 403, json: { error: { code: 'forbidden', message: ownerOnly } } }),
  )
  await page.goto('/status')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не получилось открыть')
  await expect(page.getByRole('alert')).toHaveText(ownerOnly)
  await expect(page.getByRole('region', { name: 'Сведения' })).toHaveCount(0)
})
