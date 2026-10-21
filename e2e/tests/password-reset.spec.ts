import { randomInt } from 'node:crypto'
import { request as playwrightRequest } from '@playwright/test'
import { urls } from '../urls'
import { expect, sites, test } from './fixtures'
import { linkFrom, waitForMail } from './mailbox'

// Сброс пароля по-настоящему: «Забыли пароль?» на входе → письмо в файловом ящике e2e →
// новый пароль → вход им. Сбрасываем не владельца (его сессию делят все тесты, а сброс
// завершает все входы), а участника, которого заводит приглашение

test.use({ storageState: { cookies: [], origins: [] } })

test.beforeEach(async ({ page }) => {
  // Свой «IP»: лимиты входа и сброса считаются по IP
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `10.30.${randomInt(256)}.${randomInt(1, 255)}`,
  })
})

/** Участник демо-сайта с паролем: приглашение через API и принятие по ссылке из письма */
async function createMember(site: { id: string; name: string }) {
  const email = `reset-${Date.now()}-${randomInt(1000)}@e2e.test`
  const invited = await sites[':siteId'].invitations.$post({
    param: { siteId: site.id },
    json: { email, role: 'editor' },
  })
  expect(invited.status).toBe(201)
  const mail = await waitForMail(email, `Приглашение на сайт «${site.name}» в Averra CMS`)
  const token = decodeURIComponent(linkFrom(mail, 'invite').split('#token=')[1] ?? '')
  const api = await playwrightRequest.newContext()
  try {
    const res = await api.post(`${urls.api}/api/invitations/register`, {
      data: { token, name: 'Редактор Сброса', password: 'old-e2e-password' },
    })
    expect(res.status(), await res.text()).toBe(201)
  } finally {
    await api.dispose()
  }
  return email
}

test('забыл пароль → письмо → новый пароль → вход', async ({ page, demoSite }) => {
  const email = await createMember(demoSite)

  await page.goto('/login')
  await page.getByRole('link', { name: 'Забыли пароль?' }).click()
  await expect(page).toHaveURL(/\/forgot-password$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сброс пароля')
  const request = page.getByRole('form', { name: 'Сброс пароля' })
  await request.getByLabel('Почта').fill(email)
  await request.getByRole('button', { name: 'Отправить ссылку' }).click()
  await expect(page.getByRole('status')).toContainText(
    `Если адрес ${email} есть в админке, на него придёт письмо со ссылкой`,
  )

  const link = linkFrom(await waitForMail(email, 'Сброс пароля в Averra CMS'), 'reset-password')
  expect(link.startsWith(`${urls.admin}/reset-password#token=`)).toBe(true)
  await page.goto(link)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Новый пароль')
  await expect(page).toHaveURL(`${urls.admin}/reset-password`)

  const reset = page.getByRole('form', { name: 'Новый пароль' })
  await reset.getByLabel('Новый пароль', { exact: true }).fill('new-e2e-password')
  await reset.getByLabel('Новый пароль ещё раз').fill('другой-пароль-1')
  await reset.getByRole('button', { name: 'Сохранить пароль' }).click()
  await expect(reset.getByText('Пароли не совпадают')).toBeVisible()
  await reset.getByLabel('Новый пароль ещё раз').fill('new-e2e-password')
  await reset.getByRole('button', { name: 'Сохранить пароль' }).click()
  await expect(page.getByRole('status')).toHaveText(
    'Пароль изменён. Все входы с этим паролем на других устройствах завершены.',
  )

  await page.getByRole('link', { name: 'Войти' }).click()
  const login = page.getByRole('form', { name: 'Вход в админку' })
  await login.getByLabel('Почта').fill(email)
  await login.getByLabel('Пароль').fill('new-e2e-password')
  await login.getByRole('button', { name: 'Войти' }).click()
  // Редактор сайта установки сразу на его обзоре
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(demoSite.name)
  await expect(page.getByText('Редактор Сброса')).toBeVisible()

  // Та же ссылка второй раз не работает
  await page.goto(link)
  const again = page.getByRole('form', { name: 'Новый пароль' })
  await again.getByLabel('Новый пароль', { exact: true }).fill('third-e2e-password')
  await again.getByLabel('Новый пароль ещё раз').fill('third-e2e-password')
  await again.getByRole('button', { name: 'Сохранить пароль' }).click()
  await expect(again.getByRole('alert')).toContainText('Ссылка не действует')
  await expect(again.getByRole('link', { name: 'Запросить новую ссылку' })).toBeVisible()
})

test('почта не настроена — экран честно говорит, как вернуть доступ', async ({ page }) => {
  // Почта e2e включена (файловый ящик), поэтому ответ API подменяем: так он выглядит без SMTP
  await page.route(/\/api\/password-reset$/, (route) =>
    route.fulfill({ json: { available: false } }),
  )
  await page.goto('/forgot-password')
  await expect(page.getByRole('alert')).toHaveText(
    'Сброс пароля по почте сейчас недоступен: в админке не настроена почта.',
  )
  await expect(page.getByRole('main')).toContainText('dist/server/user-password.js --email')
  await expect(page.getByRole('main')).toContainText('pnpm user:password --email')
  await expect(page.getByRole('form')).toHaveCount(0)
})

test('ссылку обрезали при копировании — экран говорит, что она повреждена, а не «устарела»', async ({
  page,
}) => {
  // Токен Better Auth — 24 буквы и цифры. Обрезанный экран узнаёт сам, до формы и запроса в API
  await page.goto('/reset-password#token=AbCdEf123')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Новый пароль')
  await expect(page.getByRole('alert')).toHaveText(
    'Ссылка повреждена: откройте её из письма целиком',
  )
  await expect(page.getByRole('alert')).not.toContainText('устарела')
  await expect(page.getByRole('link', { name: 'Запросить новую ссылку' })).toBeVisible()
  await expect(page.getByRole('form')).toHaveCount(0)
  // Токен из адреса убран и здесь
  await expect(page).toHaveURL(`${urls.admin}/reset-password`)
})
