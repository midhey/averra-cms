import { randomInt } from 'node:crypto'
import { request as playwrightRequest } from '@playwright/test'
import { e2eOwner, urls } from '../urls'
import { expect, test } from './fixtures'

// Здесь браузер без сохранённой сессии владельца: вход проверяется по-настоящему, через форму.
// Свой «IP» на тест (API e2e доверяет X-Forwarded-For от прокси админки): лимит попыток
// входа считается по IP, и неудачные попытки одного теста не должны мешать другому
test.use({ storageState: { cookies: [], origins: [] } })

test.beforeEach(async ({ page }) => {
  const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip })
})

function loginForm(page: import('@playwright/test').Page) {
  const form = page.getByRole('form', { name: 'Вход в админку' })
  return {
    form,
    email: form.getByLabel('Почта'),
    password: form.getByLabel('Пароль'),
    submit: form.getByRole('button', { name: 'Войти' }),
    error: form.getByRole('alert'),
  }
}

test('без входа ведёт на вход и возвращает туда, где был; «Выйти» закрывает админку', async ({
  page,
  demoSite,
}) => {
  await page.goto(`/sites/${demoSite.id}`)
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход в админку')
  // Без входа нет и шапки с пользователем
  await expect(page.getByRole('button', { name: 'Выйти' })).toHaveCount(0)

  const login = loginForm(page)
  await login.email.fill(e2eOwner.email)
  await login.password.fill(e2eOwner.password)
  await login.submit.click()

  await expect(page).toHaveURL(`/sites/${demoSite.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(demoSite.name)
  const banner = page.getByRole('banner')
  await expect(banner).toContainText(e2eOwner.name)

  // Сессия переживает перезагрузку: она в cookie, а не в памяти вкладки
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(demoSite.name)

  await banner.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Выйти' })).toHaveCount(0)

  // Админка снова закрыта: и экраны, и API с cookie этого браузера
  await page.goto('/')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  const api = await page.request.get('/api/sites')
  expect(api.status()).toBe(401)
})

test('неверный пароль — сообщение у формы, остаёмся на входе', async ({ page }) => {
  await page.goto('/login')
  const login = loginForm(page)
  await login.email.fill(e2eOwner.email)
  await login.password.fill('wrong-password-1')
  await login.submit.click()

  await expect(login.error).toHaveText('Неверная почта или пароль')
  await expect(page).toHaveURL(/\/login$/)
  // Пароль набирают заново: поле пустое и в фокусе
  await expect(login.password).toHaveValue('')
  await expect(login.password).toBeFocused()
})

test('пустая форма не уходит в API: ошибки у полей', async ({ page }) => {
  await page.goto('/login')
  const login = loginForm(page)
  await login.submit.click()

  await expect(login.email).toHaveAttribute('aria-invalid', 'true')
  await expect(login.email).toHaveAccessibleDescription('Нужна почта вида name@example.ru')
  await expect(login.password).toHaveAccessibleDescription('Введите пароль')
  await expect(login.email).toBeFocused()
})

test('после трёх неудачных попыток вход временно закрыт', async ({ page }) => {
  await page.goto('/login')
  const login = loginForm(page)
  await login.email.fill(e2eOwner.email)
  for (let attempt = 0; attempt < 3; attempt++) {
    await login.password.fill('wrong-password-1')
    await login.submit.click()
    await expect(login.error).toHaveText('Неверная почта или пароль')
    await expect(login.password).toHaveValue('')
  }
  await login.password.fill(e2eOwner.password)
  await login.submit.click()
  await expect(login.error).toContainText('Слишком много попыток')
  await expect(page).toHaveURL(/\/login$/)
})

test('сессия кончилась посреди работы — вход и возврат на тот же экран', async ({
  page,
  demoSite,
}) => {
  await page.goto('/login')
  const login = loginForm(page)
  await login.email.fill(e2eOwner.email)
  await login.password.fill(e2eOwner.password)
  await login.submit.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сайты')

  await page.getByRole('link', { name: demoSite.name }).click()
  await expect(page).toHaveURL(`/sites/${demoSite.id}`)
  // Сессию отозвали (или она истекла): cookie больше нет, а админка ещё открыта
  await page.context().clearCookies()
  await page.getByRole('link', { name: 'Ремонт квартир под ключ' }).click()

  await expect(page).toHaveURL(/\/login\?redirect=/)
  await login.email.fill(e2eOwner.email)
  await login.password.fill(e2eOwner.password)
  await login.submit.click()
  await expect(page).toHaveURL(`/sites/${demoSite.id}/pages/index`)
  await expect(page.getByLabel('Заголовок страницы')).toHaveValue('Ремонт квартир под ключ')
})

test('API без входа закрыт, а опубликованный сайт открыт', async ({ demoSite }) => {
  const anonymous = await playwrightRequest.newContext()
  try {
    const sites = await anonymous.get(`${urls.api}/api/sites`)
    expect(sites.status()).toBe(401)
    expect(await sites.json()).toEqual({
      error: { code: 'unauthorized', message: 'Нужно войти' },
    })
    const snapshot = await anonymous.get(`${urls.api}/api/sites/${demoSite.id}/snapshot`)
    expect(snapshot.status()).toBe(200)
    const site = await anonymous.get(urls.renderer)
    expect(site.status()).toBe(200)
  } finally {
    await anonymous.dispose()
  }
})
