import { randomInt } from 'node:crypto'
import type { Browser, Page } from '@playwright/test'
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

/** Раскладка таблицы приглашений: листается ли она и все ли колонки левее прижатых действий */
const layoutOf = (page: Page, email: string) =>
  page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.includes(${JSON.stringify(email)}))
    const frame = button.closest('[role=group]')
    const row = button.closest('tr')
    const actions = button.closest('td').getBoundingClientRect()
    const cells = [...row.children].slice(0, -1)
    return {
      scrolls: frame.scrollWidth > frame.clientWidth + 1,
      leftOfActions: cells.every((cell) => cell.getBoundingClientRect().right <= actions.left + 1),
    }
  })()`) as Promise<{ scrolls: boolean; leftOfActions: boolean }>

test('приглашение с очень длинной почтой: на 375 px страница не ездит вбок, на 1440 таблица не листается, «Отозвать» в рамке', async ({
  page,
  demoSite: site,
}) => {
  const email = `very-long-client-address-for-review-${Date.now()}@example-company.test`
  await page.goto('/settings')
  const members = page.getByRole('region', { name: 'Участники' })
  const form = members.getByRole('form', { name: 'Пригласить участника' })
  await form.getByLabel('Почта').fill(email)
  await form.getByRole('button', { name: 'Пригласить' }).click()
  await expect(members.getByRole('status')).toHaveText(`Приглашение отправлено на ${email}`)
  expect(site.id).toBeTruthy()
  // Рядом — приглашение редактора: в строке с другой ролью и теми же кнопками таблица тоже
  // должна помещаться (раньше на 1440 она становилась на 5 px шире рамки)
  const editorEmail = `editor-for-layout-${Date.now()}@example-company.test`
  await form.getByLabel('Почта').fill(editorEmail)
  await form.getByRole('radio', { name: /^Редактор/ }).check()
  await form.getByRole('button', { name: 'Пригласить' }).click()
  await expect(members.getByRole('status')).toHaveText(`Приглашение отправлено на ${editorEmail}`)

  const overflow = () =>
    page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  const revoke = members.getByRole('button', { name: `Отозвать приглашение для ${email}` })

  // Телефон: карточка переносит адрес по символам, горизонтальной прокрутки у страницы нет
  await page.setViewportSize({ width: 375, height: 812 })
  await revoke.scrollIntoViewIfNeeded()
  expect(Number(await overflow())).toBeLessThanOrEqual(0)
  await expect(revoke).toBeInViewport({ ratio: 1 })

  // Широкий экран: «Отозвать» целиком в рамке; если таблица листается — у края прижатой колонки
  // видна тень (градиент псевдоэлемента), иначе её нет
  await page.setViewportSize({ width: 700, height: 900 })
  const read = async () =>
    (await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.includes(${JSON.stringify(email)}))
    const frame = button.closest('[role=group]')
    const box = button.getBoundingClientRect()
    const edge = frame.getBoundingClientRect()
    const pinned = button.closest('td')
    const shadow = getComputedStyle(pinned, '::before')
    return {
      inside: box.left >= edge.left - 1 && box.right <= edge.right + 1,
      scrolls: frame.scrollWidth > frame.clientWidth + 1,
      shadowImage: shadow.backgroundImage,
      shadowOpacity: shadow.opacity,
    }
  })()`)) as { inside: boolean; scrolls: boolean; shadowImage: string; shadowOpacity: string }
  const state = await read()
  expect(state.inside).toBe(true)
  expect(state.scrolls).toBe(true)
  expect(state.shadowImage).toContain('linear-gradient')
  // Тень проявляется плавно после того, как DataTable заметил прокрутку
  await expect.poll(async () => (await read()).shadowOpacity).toBe('1')
  await page.setViewportSize({ width: 1440, height: 900 })
  // На 1440 длинная почта переносится, таблица не листается: «Состояние» и
  // «Действует до» лежат левее прижатой колонки, а не под ней
  for (const address of [email, editorEmail]) {
    const wide = await layoutOf(page, address)
    expect(wide.scrolls, address).toBe(false)
    expect(wide.leftOfActions, address).toBe(true)
  }
})

test('владелец приглашает клиента → клиент по ссылке задаёт пароль и сразу работает с сайтом', async ({
  page,
  browser,
  demoSite: site,
}) => {
  const email = `client-${randomInt(1_000_000)}@e2e.test`

  await page.goto('/settings')
  const members = page.getByRole('region', { name: 'Участники' })
  const form = members.getByRole('form', { name: 'Пригласить участника' })
  await form.getByLabel('Почта').fill(email)
  await form.getByRole('radio', { name: /^Администратор сайта/ }).check()
  await form.getByRole('button', { name: 'Пригласить' }).click()
  await expect(members.getByRole('status')).toHaveText(`Приглашение отправлено на ${email}`)
  const row = members
    .getByRole('table', { name: 'Приглашения' })
    .getByRole('row')
    .filter({ hasText: email })
  await expect(row).toContainText('Администратор сайта')
  await expect(row).toContainText('Ждёт ответа')
  // На широком экране почта и роль не рвутся посреди слова: раньше узкая колонка давала
  // «client@…tes / t» и «Клиен / т»
  await page.setViewportSize({ width: 1440, height: 900 })
  expect(await lineCount(row.getByRole('rowheader').getByText(email, { exact: true }))).toBe(1)
  // «Администратор сайта» — не больше двух строк: рвётся между словами, а не посреди слова
  const roleCell = row.getByRole('cell', { name: 'Администратор сайта', exact: true })
  expect(await lineCount(roleCell)).toBeLessThanOrEqual(2)

  // Действие строки не обрезано рамкой таблицы: кнопка «Отозвать» целиком внутри неё и на широком
  // экране (раньше от неё было видно «Отс»), и на телефоне, где строка — карточка
  // Короткий адрес: таблица на 1440 тоже не листается
  const short = await layoutOf(page, email)
  expect(short.scrolls).toBe(false)
  expect(short.leftOfActions).toBe(true)
  // Дата не рвётся на три строки
  expect(await lineCount(row.getByRole('cell').nth(2))).toBeLessThanOrEqual(2)

  const revoke = row.getByRole('button', { name: `Отозвать приглашение для ${email}` })
  const fits = () =>
    page.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((b) =>
        b.getAttribute('aria-label')?.includes(${JSON.stringify(email)}))
      const frame = button.closest('[role=group]').getBoundingClientRect()
      const box = button.getBoundingClientRect()
      return box.left >= frame.left - 1 && box.right <= frame.right + 1 && box.right <= innerWidth
    })()`)
  await expect(revoke).toBeVisible()
  expect(await fits()).toBe(true)
  await page.setViewportSize({ width: 375, height: 812 })
  await revoke.scrollIntoViewIfNeeded()
  await expect(revoke).toBeInViewport({ ratio: 1 })
  expect(await fits()).toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })

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
    await expect(about).toContainText('Роль — администратор сайта')
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
    await expect(guest.getByText('Администратор сайта', { exact: true })).toBeVisible()
    // Администратор сайта приглашает только редакторов: роль в форме не выбирается
    await guest.getByRole('link', { name: /^Настройки сайта/ }).click()
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Настройки сайта')
    await expect(guest.getByRole('region', { name: 'Заявки' })).toBeVisible()
    const guestMembers = guest.getByRole('region', { name: 'Участники' })
    await expect(guestMembers).toBeVisible()
    await expect(
      guestMembers.getByRole('form', { name: 'Пригласить участника' }).getByRole('radio'),
    ).toHaveCount(0)
    await expect(guestMembers).toContainText(
      'Роль — редактор. Администратора сайта приглашает владелец.',
    )

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
