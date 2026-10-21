import { randomInt } from 'node:crypto'
import type { Browser } from '@playwright/test'
import { urls } from '../urls'
import { answerDialogs, expect, lineCount, sidebar, test } from './fixtures'
import { linkFrom, waitForMail } from './mailbox'

// Приглашение по-настоящему: владелец приглашает клиента в настройках сайта, письмо ложится
// в файловый ящик e2e, клиент открывает ссылку в чистом браузере, задаёт имя и пароль и сразу
// работает с сайтом установки. Сайт у установки один, поэтому приглашения всех тестов — на нём:
// тесты различают их по своей почте

/** Браузер приглашённого: без сессии владельца и со своим «IP» для лимита входа */
const guestContext = (browser: Browser) =>
  browser.newContext({
    storageState: { cookies: [], origins: [] },
    baseURL: urls.admin,
    locale: 'ru-RU',
    extraHTTPHeaders: { 'x-forwarded-for': `10.20.${randomInt(256)}.${randomInt(1, 255)}` },
  })

test('владелец приглашает клиента → клиент по ссылке задаёт пароль и сразу работает с сайтом', async ({
  page,
  browser,
  demoSite: site,
}) => {
  const email = `client-${Date.now()}-${randomInt(1000)}@e2e.test`

  await page.goto('/settings')
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
  // На широком экране почта и роль не рвутся посреди слова: раньше узкая колонка давала
  // «client@…tes / t» и «Клиен / т»
  await page.setViewportSize({ width: 1440, height: 900 })
  expect(await lineCount(row.getByRole('rowheader'))).toBe(1)
  expect(await lineCount(row.getByRole('cell', { name: 'Клиент', exact: true }))).toBe(1)

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

    await expect(guest).toHaveURL(`${urls.admin}/`)
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(site.name)
    await expect(guest.getByText('Мария Клиентова')).toBeVisible()
    await expect(guest.getByText('Клиент', { exact: true })).toBeVisible()
    // Клиент правит черновики, но доступ к сайту не раздаёт: в настройках нет «Участников»
    await guest.getByRole('link', { name: /^Настройки сайта/ }).click()
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Настройки сайта')
    await expect(guest.getByRole('region', { name: 'Заявки' })).toBeVisible()
    await expect(guest.getByRole('region', { name: 'Участники' })).toHaveCount(0)

    // Выбирать сайт не из чего: в установке он один, его название — заголовок панели
    await guest.goto('/')
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(site.name)
    await expect(sidebar(guest).siteLink).toBeVisible()
    await expect(guest.getByRole('link', { name: 'Все сайты' })).toHaveCount(0)

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

  // В очереди писем адрес получателя тоже в одну строку
  await page.goto('/mail')
  const queued = page
    .getByRole('table', { name: 'Очередь писем' })
    .getByRole('row')
    .filter({ hasText: email })
    .first()
  await expect(queued).toBeVisible()
  expect(await lineCount(queued.getByRole('rowheader').getByText(email))).toBe(1)
})

test('отозванное приглашение больше не открывается', async ({ page, browser, demoSite: site }) => {
  const email = `revoked-${Date.now()}-${randomInt(1000)}@e2e.test`

  await page.goto('/settings')
  const members = page.getByRole('region', { name: 'Участники' })
  const form = members.getByRole('form', { name: 'Пригласить участника' })
  await form.getByLabel('Почта').fill(email)
  await form.getByRole('button', { name: 'Пригласить' }).click()
  await expect(members.getByRole('status')).toHaveText(`Приглашение отправлено на ${email}`)
  const link = linkFrom(
    await waitForMail(email, `Приглашение на сайт «${site.name}» в Averra CMS`),
    'invite',
  )

  // Отзыв — после подтверждения: «Отмена» оставляет приглашение в силе
  const dialogs = answerDialogs(page, [false, true])
  const revoke = members.getByRole('button', { name: `Отозвать приглашение для ${email}` })
  await revoke.click()
  await expect.poll(() => dialogs.length).toBe(1)
  expect(dialogs[0]).toBe(
    `Отозвать приглашение для ${email}? Ссылка из письма перестанет работать.`,
  )
  await expect(revoke).toBeVisible()
  await revoke.click()
  await expect.poll(() => dialogs.length).toBe(2)
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
  const failure = { error: { code: 'internal', message: 'Внутренняя ошибка сервера' } }
  const fail = (url: RegExp) =>
    page.route(url, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 500, json: failure })
        : route.continue(),
    )
  await fail(/\/api\/sites\/[^/]+\/invitations$/)
  await fail(/\/api\/mail$/)

  await page.goto('/settings')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Настройки сайта')
  const members = page.getByRole('region', { name: 'Участники' })
  await expect(members.getByRole('alert')).toContainText(
    'Не удалось загрузить приглашения: Внутренняя ошибка сервера',
  )
  await expect(members).toContainText('Не удалось узнать, настроена ли почта')
  // Форма приглашения работает: о выключенной почте скажет сам API
  await expect(members.getByRole('button', { name: 'Пригласить' })).toBeEnabled()

  await page.unrouteAll()
  await members.getByRole('button', { name: 'Повторить' }).click()
  // Список загрузился: пустой или с приглашениями других тестов (сайт у установки один)
  await expect(
    members
      .getByText('Приглашений пока нет')
      .or(members.getByRole('table', { name: 'Приглашения' })),
  ).toBeVisible()
  await expect(members.getByRole('alert')).toHaveCount(0)
  await expect(members).not.toContainText('Не удалось узнать')
})
