import { expect, sidebar, test } from './fixtures'
import { disablePerson, guestContext, newMember, signInContext } from './people'

// Профиль — у каждого, кто вошёл: имя, смена своего пароля и «Выйти на других устройствах».
// Владелец e2e тут не годится: смена пароля и выход везде погасили бы его сессию для остальных
// тестов, поэтому — свой участник

test('имя меняется в профиле и сразу видно в панели; на 375 px без прокрутки вбок', async ({
  browser,
  demoSite,
}) => {
  const member = await newMember(browser, demoSite, 'editor', 'Ольга Старое')
  try {
    const page = await member.context.newPage()
    await page.goto('/')
    await page.getByRole('link', { name: 'Профиль' }).click()
    await expect(page).toHaveURL('/profile')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Профиль')
    await expect(page.getByText(member.email)).toBeVisible()

    const name = page.getByRole('textbox', { name: 'Имя' })
    await name.fill('')
    await page.getByRole('button', { name: 'Сохранить имя' }).click()
    await expect(name).toBeFocused()
    await expect(page.getByText('Введите имя')).toBeVisible()
    await name.fill('Ольга Новая')
    await page.getByRole('button', { name: 'Сохранить имя' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Имя сохранено' })).toBeVisible()
    // Панель берёт имя из того же кеша: без перезагрузки
    await expect(page.getByText('Ольга Новая', { exact: true })).toBeVisible()

    await page.setViewportSize({ width: 375, height: 812 })
    const overflow = await page.evaluate<number>(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    )
    expect(overflow).toBeLessThanOrEqual(0)
  } finally {
    await disablePerson(demoSite.id, member)
  }
})

test('смена пароля: неверный текущий — у поля; после смены старый не подходит, второй браузер — на вход', async ({
  browser,
  demoSite,
}) => {
  const member = await newMember(browser, demoSite, 'client')
  // Второй вход того же человека — свой браузер со своей сессией
  const laptop = await guestContext(browser)
  try {
    expect(await signInContext(laptop, member.email, member.password)).toBe(200)
    const there = await laptop.newPage()
    await there.goto('/pages')
    await expect(there.getByRole('heading', { level: 1 })).toHaveText('Страницы')
    const page = await member.context.newPage()
    await page.goto('/profile')
    const form = page.getByRole('form', { name: 'Сменить пароль' })
    await form.getByLabel('Текущий пароль').fill('не-тот-пароль-совсем')
    await form.getByLabel('Новый пароль', { exact: true }).fill('новый-пароль-e2e-1')
    await form.getByLabel('Новый пароль ещё раз').fill('новый-пароль-e2e-2')
    await form.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(form.getByText('Пароли не совпадают')).toBeVisible()

    await form.getByLabel('Новый пароль ещё раз').fill('новый-пароль-e2e-1')
    await form.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(form.getByLabel('Текущий пароль')).toBeFocused()
    await expect(form.getByText('Неверный пароль')).toBeVisible()

    await form.getByLabel('Текущий пароль').fill(member.password)
    await form.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(form.getByRole('status')).toContainText('Пароль изменён')
    // Этот браузер работает дальше
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Профиль')
    // Второй браузер — на вход при первом же переходе
    await sidebar(there).section('Медиатека').click()
    await expect(there).toHaveURL(/\/login/)
    // Старый пароль больше не подходит, новый — да
    expect(await signInContext(laptop, member.email, member.password)).toBe(401)
    expect(await signInContext(laptop, member.email, 'новый-пароль-e2e-1')).toBe(200)
  } finally {
    await laptop.close()
    await disablePerson(demoSite.id, member)
  }
})

test('«Выйти на других устройствах»: второй браузер — на вход, этот остаётся', async ({
  browser,
  demoSite,
}) => {
  const member = await newMember(browser, demoSite, 'editor')
  const laptop = await guestContext(browser)
  try {
    expect(await signInContext(laptop, member.email, member.password)).toBe(200)
    const there = await laptop.newPage()
    await there.goto('/pages')
    await expect(there.getByRole('heading', { level: 1 })).toHaveText('Страницы')

    const page = await member.context.newPage()
    await page.goto('/profile')
    const sessions = page.getByRole('region', { name: 'Входы' })
    await expect(sessions).toContainText('Кроме этого браузера, админка открыта ещё: 1.')
    await sessions.getByRole('button', { name: 'Выйти на других устройствах' }).click()
    const ask = page.getByRole('alertdialog', { name: 'Выйти на других устройствах?' })
    await expect(ask.getByRole('button', { name: 'Отмена' })).toBeFocused()
    await ask.getByRole('button', { name: 'Выйти на других устройствах' }).click()
    await expect(sessions.getByRole('status')).toContainText('завершено входов — 1')
    await expect(sessions).toContainText('Админка открыта только здесь.')

    // Тот браузер — на вход при первом же переходе, этот — работает
    await sidebar(there).section('Медиатека').click()
    await expect(there).toHaveURL(/\/login/)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Профиль')
  } finally {
    await laptop.close()
    await disablePerson(demoSite.id, member)
  }
})
