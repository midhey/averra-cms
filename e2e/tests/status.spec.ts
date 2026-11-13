import { e2eVersion } from '../urls'
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
  // API e2e — с релизной версией и папкой состояния, но бэкапов в ней не было: их делает
  // averra.sh на сервере
  await expect(section.getByRole('definition').first()).toHaveText(e2eVersion)
  await expect(section).toContainText('работает, миграций применено')
  await expect(section).toContainText('ещё не было')
  await expect(section).toContainText('Почта')
})

test('«Проверить снова» ждёт свежую проверку новых версий', async ({ page }) => {
  let requestedAt: string | null = null
  let polls = 0
  await page.route(/\/api\/status\/check-update$/, async (route) => {
    requestedAt = new Date().toISOString()
    await route.fulfill({ status: 202, json: { requestedAt, message: 'Проверяю новые версии…' } })
  })
  await page.route(/\/api\/status$/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    if (requestedAt) polls += 1
    const finished = requestedAt && polls > 1
    await route.fulfill({
      response,
      json: {
        ...body,
        release: {
          ...body.release,
          checkAvailable: true,
          checkPending: finished ? null : requestedAt,
          check: {
            checkedAt: finished
              ? new Date(Date.parse(requestedAt ?? '') + 1000).toISOString()
              : '2026-01-01T00:00:00.000Z',
            current: e2eVersion,
            ok: true,
            error: null,
            adminUpdate: true,
            requestsWatched: true,
            checksWatched: true,
          },
        },
      },
    })
  })
  await page.goto('/status')
  await page.getByRole('button', { name: 'Проверить снова' }).click()
  await expect(page.getByText('Проверяю новые версии…', { exact: true })).toBeVisible()
  await expect(page.getByText('Проверка новых версий завершена.', { exact: true })).toBeVisible()
  expect(polls).toBeGreaterThan(1)
})

test('участнику блока нет: API ему его не отдаст', async ({ page, demoSite }) => {
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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(demoSite.name)
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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Нет доступа к разделу «Состояние»',
  )
  await expect(page.getByRole('alert')).toHaveText(ownerOnly)
  await expect(page.getByRole('region', { name: 'Сведения' })).toHaveCount(0)
})
