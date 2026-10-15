import { randomInt } from 'node:crypto'
import type { Browser } from '@playwright/test'
import { urls } from '../urls'
import { expect, sites, test } from './fixtures'
import { linkFrom, waitForMail } from './mailbox'

// Приглашение по-настоящему: владелец приглашает клиента с экрана сайта, письмо ложится
// в файловый ящик e2e, клиент открывает ссылку в чистом браузере, задаёт имя и пароль
// и видит только сайт, на который его пригласили

/** Браузер приглашённого: без сессии владельца и со своим «IP» для лимита входа */
const guestContext = (browser: Browser) =>
  browser.newContext({
    storageState: { cookies: [], origins: [] },
    baseURL: urls.admin,
    locale: 'ru-RU',
    extraHTTPHeaders: { 'x-forwarded-for': `10.20.${randomInt(256)}.${randomInt(1, 255)}` },
  })

/** Свой сайт на тест: приглашения разных тестов не пересекаются */
async function newSite(prefix: string) {
  const name = `${prefix} ${Date.now()}-${randomInt(1000)}`
  const created = await sites.$post({ json: { name } })
  if (created.status !== 201) throw new Error(`Сайт не создался: ${created.status}`)
  return created.json()
}

test('владелец приглашает клиента → клиент по ссылке задаёт пароль и видит только свой сайт', async ({
  page,
  browser,
}) => {
  const site = await newSite('Сайт для клиента')
  const email = `client-${Date.now()}-${randomInt(1000)}@e2e.test`

  await page.goto(`/sites/${site.id}`)
  const members = page.getByRole('region', { name: 'Участники' })
  const form = members.getByRole('form', { name: 'Пригласить участника' })
  await form.getByLabel('Почта').fill(email)
  await form.getByRole('radio', { name: /^Клиент/ }).check()
  await form.getByRole('button', { name: 'Пригласить' }).click()
  await expect(members.getByRole('status')).toHaveText(`Приглашение отправлено на ${email}`)
  const row = members
    .getByRole('table', { name: 'Приглашения' })
    .getByRole('row')
    .filter({ hasText: email })
  await expect(row).toContainText('Клиент')
  await expect(row).toContainText('Ждёт ответа')

  const mail = await waitForMail(email, `Приглашение на сайт «${site.name}» в Averra CMS`)
  const link = linkFrom(mail, 'invite')
  expect(link.startsWith(`${urls.admin}/invite#token=`)).toBe(true)

  const context = await guestContext(browser)
  try {
    const guest = await context.newPage()
    await guest.goto(link)
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Приглашение на сайт')
    const about = guest.getByRole('region', { name: 'О приглашении' })
    await expect(about).toContainText(`с сайтом «${site.name}»`)
    await expect(about).toContainText('Роль — клиент')
    await expect(about).toContainText(email)
    // Токен убран из адресной строки сразу после открытия
    await expect(guest).toHaveURL(`${urls.admin}/invite`)

    const signUp = guest.getByRole('form', { name: 'Имя и пароль' })
    await signUp.getByLabel('Имя').fill('Мария Клиентова')
    await signUp.getByLabel('Пароль', { exact: true }).fill('maria-e2e-password')
    await signUp.getByLabel('Пароль ещё раз').fill('maria-e2e-password')
    await signUp.getByRole('button', { name: 'Принять приглашение' }).click()

    await expect(guest).toHaveURL(`${urls.admin}/sites/${site.id}`)
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(site.name)
    await expect(guest.getByRole('banner')).toContainText('Мария Клиентова')
    // Клиент правит черновики, но доступ к сайту не раздаёт
    await expect(guest.getByRole('region', { name: 'Участники' })).toHaveCount(0)

    await guest.goto('/')
    const list = guest.getByRole('region', { name: 'Список сайтов' })
    await expect(list.getByRole('link')).toHaveText([site.name])

    // Ссылка одноразовая: второй раз — понятный отказ, а не форма
    await guest.goto(link)
    await expect(guest.getByRole('alert')).toHaveText(
      'Приглашение уже принято. Войдите в админку своей почтой и паролем',
    )
  } finally {
    await context.close()
  }

  await page.reload()
  await expect(row).toContainText('Принято')
  await expect(row.getByRole('button')).toHaveCount(0)
})

test('отозванное приглашение больше не открывается', async ({ page, browser }) => {
  const site = await newSite('Сайт для отзыва')
  const email = `revoked-${Date.now()}-${randomInt(1000)}@e2e.test`

  await page.goto(`/sites/${site.id}`)
  const members = page.getByRole('region', { name: 'Участники' })
  const form = members.getByRole('form', { name: 'Пригласить участника' })
  await form.getByLabel('Почта').fill(email)
  await form.getByRole('button', { name: 'Пригласить' }).click()
  await expect(members.getByRole('status')).toHaveText(`Приглашение отправлено на ${email}`)
  const link = linkFrom(
    await waitForMail(email, `Приглашение на сайт «${site.name}» в Averra CMS`),
    'invite',
  )

  await members.getByRole('button', { name: `Отозвать приглашение для ${email}` }).click()
  await expect(members.getByRole('status')).toHaveText(
    `Приглашение для ${email} отозвано: ссылка больше не работает`,
  )
  await expect(members.getByRole('heading', { name: 'Приглашения' })).toBeFocused()
  await expect(
    members.getByRole('table', { name: 'Приглашения' }).getByRole('row').filter({ hasText: email }),
  ).toContainText('Отозвано')

  const context = await guestContext(browser)
  try {
    const guest = await context.newPage()
    await guest.goto(link)
    await expect(guest.getByRole('alert')).toHaveText(
      'Приглашение отозвано. Если доступ всё же нужен, попросите владельца прислать новое',
    )
    await expect(guest.getByRole('form')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('сбой приглашений и почты не прячет сайт: ошибка — внутри раздела «Участники»', async ({
  page,
}) => {
  const site = await newSite('Сайт со сбоем приглашений')
  const failure = { error: { code: 'internal', message: 'Внутренняя ошибка сервера' } }
  const fail = (url: RegExp) =>
    page.route(url, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 500, json: failure })
        : route.continue(),
    )
  await fail(/\/api\/sites\/[^/]+\/invitations$/)
  await fail(/\/api\/mail$/)

  await page.goto(`/sites/${site.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(site.name)
  const members = page.getByRole('region', { name: 'Участники' })
  await expect(members.getByRole('alert')).toContainText(
    'Не удалось загрузить приглашения: Внутренняя ошибка сервера',
  )
  await expect(members).toContainText('Не удалось узнать, настроена ли почта')
  // Форма приглашения работает: о выключенной почте скажет сам API
  await expect(members.getByRole('button', { name: 'Пригласить' })).toBeEnabled()

  await page.unrouteAll()
  await members.getByRole('button', { name: 'Повторить' }).click()
  await expect(members.getByText('Приглашений пока нет.')).toBeVisible()
  await expect(members.getByRole('alert')).toHaveCount(0)
  await expect(members).not.toContainText('Не удалось узнать')
})
