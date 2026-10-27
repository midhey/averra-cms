import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { e2eVersion, requestsDir, stateDir } from '../urls'
import { expect, test } from './fixtures'

// Обновление из админки на подложенной папке состояния: файлы, которые на сервере пишет
// averra.sh (проверка версии, принятая заявка, ход и итог обновления), кладёт сам тест, а заявку
// из админки он забирает из папки заявок, как служба averra-update-request. Сам хост (разбор
// заявки, бэкап, откат) проверяют тесты deploy/tests/averra.test.ts

const requestFile = join(requestsDir, 'update.json')
const hostFiles = [
  'release-check.json',
  'release-latest.json',
  'update-request.json',
  'update-last.json',
]

/** Файл состояния так, как его пишет averra.sh */
function hostState(file: string, value: unknown) {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(join(stateDir, file), `${JSON.stringify(value)}\n`)
}

/** Сервер, установленный install.sh: проверка нашла 0.2.0, папка заявок есть */
function releaseFound() {
  mkdirSync(requestsDir, { recursive: true })
  hostState('release-check.json', {
    checkedAt: new Date().toISOString(),
    current: e2eVersion,
    ok: true,
    error: null,
    adminUpdate: true,
    requestsWatched: true,
  })
  hostState('release-latest.json', {
    version: '0.2.0',
    publishedAt: '2026-10-20T10:00:00Z',
    notes: 'Features\n\n• Обновление из админки\n• <b>теги</b> — простым текстом',
  })
}

function updateRun(overrides: Record<string, unknown>) {
  return {
    from: e2eVersion,
    to: '0.2.0',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: 'in-progress',
    step: 'pull',
    dbRestored: false,
    keptDatabase: null,
    error: null,
    ...overrides,
  }
}

test.afterEach(() => {
  for (const file of hostFiles) rmSync(join(stateDir, file), { force: true })
  rmSync(requestFile, { force: true })
})

const updateSection = (page: Page) => page.getByRole('region', { name: 'Обновление' })

/** Текущий шаг обновления (aria-current="step") */
const currentStep = (page: Page) =>
  updateSection(page)
    .getByRole('list', { name: 'Шаги обновления' })
    .locator('[aria-current="step"]')

test('доступна новая версия → «Обновить» → заявка → идёт → API перезапускается → готово', async ({
  page,
}) => {
  releaseFound()
  await page.goto('/status')
  const section = updateSection(page)
  await expect(section).toContainText(`Установлена ${e2eVersion} · доступна 0.2.0`)
  await expect(section).toContainText('Последняя проверка новых версий')
  const notes = section.getByRole('region', { name: /Что нового в 0\.2\.0/ })
  await expect(notes).toContainText('• Обновление из админки')
  // Заметки — текст: тег показан как есть, а не стал разметкой
  await expect(notes).toContainText('<b>теги</b>')

  await section.getByRole('button', { name: 'Обновить до 0.2.0' }).click()
  const dialog = page.getByRole('dialog', { name: 'Обновить до 0.2.0?' })
  await expect(dialog).toContainText('бэкап базы и медиатеки')
  await expect(dialog).toContainText('недоступны минуту-две')
  await expect(dialog).toContainText(`вернёт прежнюю (${e2eVersion})`)
  await dialog.getByRole('button', { name: 'Обновить до 0.2.0' }).click()
  await expect(dialog).toBeHidden()

  // Заявка легла в папку заявок — её заберёт хост
  await expect.poll(() => existsSync(requestFile)).toBe(true)
  const request = JSON.parse(readFileSync(requestFile, 'utf8'))
  expect(request).toMatchObject({ version: '0.2.0' })
  await expect(section).toContainText('Заявка на обновление до 0.2.0 отправлена')
  await expect(section.getByRole('button', { name: /Обновить до/ })).toHaveCount(0)

  // Хост забрал заявку и делает бэкап
  rmSync(requestFile)
  const at = new Date().toISOString()
  hostState('update-request.json', {
    at,
    version: '0.2.0',
    requestedAt: request.requestedAt,
    result: 'accepted',
    error: null,
  })
  hostState('update-last.json', updateRun({ startedAt: at, step: 'backup' }))
  await expect(section).toContainText('Идёт обновление до 0.2.0', { timeout: 15_000 })
  await expect(currentStep(page)).toContainText('Бэкап базы и медиатеки')
  await expect(currentStep(page)).toContainText('идёт')

  // API остановлен посреди обновления: экран не падает, а ждёт
  await page.route(/\/api\/status$/, (route) =>
    route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' }),
  )
  await expect(section).toContainText('Админка ждёт, пока API перезапустится', {
    timeout: 30_000,
  })
  await expect(page.getByText('Не удалось обновить состояние')).toHaveCount(0)

  // Новая версия поднялась и прошла проверку. Версия API e2e не меняется — ответ правится так,
  // как ответил бы API новой версии
  hostState(
    'update-last.json',
    updateRun({
      startedAt: at,
      step: 'verify',
      result: 'updated',
      finishedAt: new Date().toISOString(),
    }),
  )
  await page.unroute(/\/api\/status$/)
  await page.route(/\/api\/status$/, async (route) => {
    const response = await route.fetch()
    const json = await response.json()
    await route.fulfill({
      response,
      json: { ...json, version: '0.2.0', release: { ...json.release, available: null } },
    })
  })
  await expect(section).toContainText('Обновлено до 0.2.0', { timeout: 30_000 })
  await expect(section).toContainText('Установлена 0.2.0 · это последняя версия')
  // Админка тоже новая: страницу предлагают обновить
  await expect(section.getByRole('button', { name: 'Обновить страницу' })).toBeVisible()
})

test('откат: новая версия не прошла проверку — что случилось и что делать', async ({ page }) => {
  releaseFound()
  const startedAt = new Date().toISOString()
  hostState('update-last.json', updateRun({ startedAt, step: 'migrate' }))
  await page.goto('/status')
  const section = updateSection(page)
  await expect(section).toContainText('Идёт обновление до 0.2.0')
  await expect(currentStep(page)).toContainText('Запуск и миграции базы')

  hostState(
    'update-last.json',
    updateRun({
      startedAt,
      step: 'rollback',
      result: 'rolled-back',
      dbRestored: true,
      finishedAt: new Date().toISOString(),
      error: 'версия 0.2.0 не прошла проверку готовности',
    }),
  )
  await expect(section).toContainText(
    `Обновление до 0.2.0 не прошло — работает прежняя версия ${e2eVersion}`,
    { timeout: 15_000 },
  )
  await expect(section).toContainText('и базу из бэкапа перед обновлением')
  await expect(section).toContainText('Сообщите студии')
  const steps = section.getByRole('list', { name: 'Шаги обновления' })
  await expect(
    steps.getByRole('listitem').filter({ hasText: 'Проверка админки и сайта' }),
  ).toContainText('не прошло')
  await expect(steps.getByRole('listitem').last()).toContainText('Откат на прежнюю версию')
  // Повторить можно: кнопка вернулась
  await expect(section.getByRole('button', { name: 'Обновить до 0.2.0' })).toBeVisible()
})

test('без хостовой части (разработка, сервер не через install.sh) — подсказка вместо кнопки', async ({
  page,
}) => {
  await page.goto('/status')
  const section = updateSection(page)
  await expect(section).toContainText(`Установлена ${e2eVersion}`)
  await expect(section).toContainText('работает только на сервере, установленном install.sh')
  await expect(section.getByRole('button', { name: /Обновить до/ })).toHaveCount(0)
})
