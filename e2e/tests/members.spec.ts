import { randomInt } from 'node:crypto'
import type { Page } from '@playwright/test'
import { urls } from '../urls'
import { confirmDialog, expect, ownerApi, sidebar, sites, test } from './fixtures'
import { linkFrom, waitForMail } from './mailbox'
import { disablePerson, newMember, type Person, signInContext } from './people'

// Участники из админки: смена роли (меню участника меняется), отключение (второй браузер — на
// вход, войти снова нельзя), возврат доступа, второй владелец и передача владения, повторная
// отправка приглашения. Всё — действием владельца в «Настройках сайта → Участники»

const membersRegion = (page: Page) => page.getByRole('region', { name: 'Участники' })
const membersTable = (page: Page) =>
  membersRegion(page).getByRole('table', { name: 'Участники сайта' })
const memberRow = (page: Page, email: string) =>
  membersTable(page).getByRole('row').filter({ hasText: email })

const overflow = (page: Page) =>
  page.evaluate<number>(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )

test('смена роли: редактор становится администратором сайта, и его меню меняется', async ({
  page,
  browser,
  demoSite,
}) => {
  const member = await newMember(browser, demoSite, 'editor')
  try {
    const own = await member.context.newPage()
    await own.goto('/')
    await expect(sidebar(own).section('Страницы')).toBeVisible()
    await expect(sidebar(own).section('Заявки')).toHaveCount(0)
    await expect(own.getByText('Редактор', { exact: true })).toBeVisible()

    await page.goto('/settings')
    const row = memberRow(page, member.email)
    await expect(row).toContainText('Редактор')
    await expect(row).toContainText('Действует')
    await row.getByRole('button', { name: `Роль: ${member.name}` }).click()
    const dialog = page.getByRole('dialog', { name: `Роль: ${member.name}` })
    await expect(dialog).toBeVisible()
    // «Отмена» закрывает окно, и фокус возвращается на кнопку «Роль» (раньше уходил на body)
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog).toBeHidden()
    await expect(row.getByRole('button', { name: `Роль: ${member.name}` })).toBeFocused()
    await row.getByRole('button', { name: `Роль: ${member.name}` }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio', { name: /^Администратор сайта/ }).check()
    await dialog.getByRole('button', { name: 'Сменить роль' }).click()
    await expect(dialog).toBeHidden()
    await expect(membersRegion(page).getByRole('status')).toContainText(
      `${member.name}: роль «Администратор сайта»`,
    )
    await expect(row).toContainText('Администратор сайта')

    // У участника меню меняется при следующем переходе — без нового входа и без перезагрузки:
    // переход внутри админки, а не own.reload(), иначе тест прошёл бы и при залипшем кеше роли
    await sidebar(own).section('Страницы').click()
    await expect(own).toHaveURL(/\/pages$/)
    await expect(sidebar(own).section('Заявки')).toBeVisible()
    await expect(sidebar(own).section('SEO')).toBeVisible()
    await expect(own.getByText('Администратор сайта', { exact: true })).toBeVisible()
  } finally {
    await disablePerson(demoSite.id, member)
  }
})

test('«Отключить»: второй браузер участника попадает на вход, войти снова нельзя; «Вернуть доступ» — входит', async ({
  page,
  browser,
  demoSite,
}) => {
  const member = await newMember(browser, demoSite, 'client')
  try {
    const own = await member.context.newPage()
    await own.goto('/pages')
    await expect(own.getByRole('heading', { level: 1 })).toHaveText('Страницы')

    await page.goto('/settings')
    const row = memberRow(page, member.email)
    await row.getByRole('button', { name: `Отключить доступ: ${member.name}` }).click()
    // Окно админки: вопрос по имени, фокус — на безопасной кнопке, опасная — «Отключить доступ»
    const ask = confirmDialog(page)
    await expect(ask).toHaveAccessibleName(`Отключить доступ для ${member.name}?`)
    await expect(ask.getByRole('button', { name: 'Оставить' })).toBeFocused()
    await ask.getByRole('button', { name: 'Отключить доступ' }).click()
    await expect(membersRegion(page).getByRole('status')).toContainText(
      `Доступ для ${member.name} отключён`,
    )
    await expect(row).toContainText('Отключён')
    await expect(row.getByRole('button', { name: `Вернуть доступ: ${member.name}` })).toBeVisible()

    // Второй браузер: следующий же переход — на вход
    await sidebar(own).section('Медиатека').click()
    await expect(own).toHaveURL(/\/login/)
    // И войти снова нельзя: форма говорит почему
    await own.getByLabel('Почта').fill(member.email)
    await own.getByLabel('Пароль', { exact: true }).fill(member.password)
    await own.getByRole('button', { name: 'Войти' }).click()
    await expect(own.getByRole('alert')).toContainText('Доступ к админке отключён')

    // Вернуть доступ — с выбором роли
    await row.getByRole('button', { name: `Вернуть доступ: ${member.name}` }).click()
    const restore = page.getByRole('dialog', { name: `Вернуть доступ: ${member.name}` })
    await restore.getByRole('radio', { name: /^Редактор/ }).check()
    await restore.getByRole('button', { name: 'Вернуть доступ' }).click()
    await expect(row).toContainText('Редактор')
    await expect(row).toContainText('Действует')
    expect(await signInContext(member.context, member.email, member.password)).toBe(200)
    await own.goto('/')
    await expect(own.getByText('Редактор', { exact: true })).toBeVisible()
  } finally {
    await disablePerson(demoSite.id, member)
  }
})

test('окно «Отключить» напоминает про токены по их числу: выпустил владелец, которого потом понизили', async ({
  page,
  browser,
  demoSite,
}) => {
  const member = await newMember(browser, demoSite, 'editor')
  const siteParam = { siteId: demoSite.id, userId: member.id }
  let tokenId = ''
  try {
    // Человек был владельцем и выпустил токен, потом его понизили до редактора: роль уже ни о чём
    // не говорит, а токен работает
    const promoted = await sites[':siteId'].members[':userId'].$patch({
      param: siteParam,
      json: { role: 'owner' },
    })
    expect(promoted.status).toBe(200)
    const issued = await member.context.request.post(`${urls.admin}/api/tokens`, {
      data: { name: `Токен ушедшего ${Date.now()}` },
      headers: { origin: urls.admin },
    })
    expect(issued.status(), await issued.text()).toBe(201)
    tokenId = ((await issued.json()) as { id: string }).id

    // Пока он владелец, окно «Роль» напоминает про токен при выборе роли ниже, и только тогда
    await page.goto('/settings')
    const row = memberRow(page, member.email)
    await row.getByRole('button', { name: `Роль: ${member.name}` }).click()
    const role = page.getByRole('dialog', { name: `Роль: ${member.name}` })
    await expect(role).not.toContainText('Выпущен')
    await role.getByRole('radio', { name: /^Редактор/ }).check()
    await expect(role).toContainText('Выпущен им 1 токен для ИИ: он продолжит работать')
    await expect(role).toContainText('отзовите его в «Установка → Доступ для ИИ»')
    await role.getByRole('radio', { name: /^Владелец/ }).check()
    await expect(role).not.toContainText('Выпущен')
    await role.getByRole('button', { name: 'Отмена' }).click()
    await expect(role).toBeHidden()

    const demoted = await sites[':siteId'].members[':userId'].$patch({
      param: siteParam,
      json: { role: 'editor' },
    })
    expect(demoted.status).toBe(200)

    await page.reload()
    await row.getByRole('button', { name: `Отключить доступ: ${member.name}` }).click()
    const ask = confirmDialog(page)
    await expect(ask).toContainText('Выпущен им 1 токен для ИИ: он продолжит работать')
    await expect(ask).toContainText('отзовите его в «Установка → Доступ для ИИ»')
    await ask.getByRole('button', { name: 'Оставить' }).click()

    // Токен отозван — напоминания нет
    const revoked = await ownerApi.tokens[':id'].$delete({ param: { id: tokenId } })
    expect(revoked.status).toBe(204)
    await page.reload()
    await row.getByRole('button', { name: `Отключить доступ: ${member.name}` }).click()
    await expect(confirmDialog(page)).not.toContainText('токен')
    await confirmDialog(page).getByRole('button', { name: 'Оставить' }).click()
  } finally {
    if (tokenId) await ownerApi.tokens[':id'].$delete({ param: { id: tokenId } })
    await disablePerson(demoSite.id, member)
  }
})

test('своя строка без действий: себя не понизить и не отключить; на 375 px таблица без прокрутки страницы', async ({
  page,
}) => {
  await page.goto('/settings')
  const self = membersTable(page).getByRole('row').filter({ hasText: 'это вы' })
  await expect(self).toContainText('Владелец')
  await expect(self.getByRole('button')).toHaveCount(0)
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(membersTable(page)).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await page.setViewportSize({ width: 1440, height: 900 })
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

test('второй владелец и передача владения — из админки, с предупреждением', async ({
  page,
  browser,
  demoSite,
}) => {
  const people: Person[] = []
  try {
    const anna = await newMember(browser, demoSite, 'client', 'Анна Вторая')
    people.push(anna)
    const egor = await newMember(browser, demoSite, 'editor', 'Егор Будущий')
    people.push(egor)

    // Владелец делает Анну вторым владельцем
    await page.goto('/settings')
    await memberRow(page, anna.email)
      .getByRole('button', { name: `Роль: ${anna.name}` })
      .click()
    const dialog = page.getByRole('dialog', { name: `Роль: ${anna.name}` })
    await dialog.getByRole('radio', { name: /^Владелец/ }).check()
    await expect(dialog.getByText('Владелец может всё')).toBeVisible()
    await dialog.getByRole('button', { name: 'Сделать владельцем' }).click()
    await expect(memberRow(page, anna.email)).toContainText('Владелец')
    // Она уже владелец: передавать ей нечего — флажка «Передать владение» в окне нет
    await memberRow(page, anna.email)
      .getByRole('button', { name: `Роль: ${anna.name}` })
      .click()
    const again = page.getByRole('dialog', { name: `Роль: ${anna.name}` })
    await expect(again.getByRole('radio', { name: /^Владелец/ })).toBeChecked()
    await expect(again.getByLabel('Передать владение')).toHaveCount(0)
    await again.getByRole('button', { name: 'Отмена' }).click()

    // У Анны появилась «Установка»
    const annaPage = await anna.context.newPage()
    await annaPage.goto('/settings')
    await expect(sidebar(annaPage).installation).toBeVisible()

    // Анна передаёт владение Егору: он — владелец, она — администратор сайта
    await memberRow(annaPage, egor.email)
      .getByRole('button', { name: `Роль: ${egor.name}` })
      .click()
    const transfer = annaPage.getByRole('dialog', { name: `Роль: ${egor.name}` })
    await transfer.getByRole('radio', { name: /^Владелец/ }).check()
    await transfer.getByLabel('Передать владение').check()
    await transfer.getByRole('button', { name: 'Передать владение' }).click()
    await expect(membersRegion(annaPage).getByRole('status')).toContainText(
      `Владелец теперь ${egor.name}. Ваша роль — «Администратор сайта»`,
    )
    await expect(sidebar(annaPage).installation).toHaveCount(0)
    await expect(annaPage.getByText('Администратор сайта', { exact: true }).first()).toBeVisible()

    await page.reload()
    await expect(memberRow(page, egor.email)).toContainText('Владелец')
    await expect(memberRow(page, anna.email)).toContainText('Администратор сайта')
  } finally {
    for (const person of people) await disablePerson(demoSite.id, person)
  }
})

test('администратор сайта в своём браузере: только редакторы, вернуть доступ — только им', async ({
  browser,
  demoSite,
}) => {
  const people: Person[] = []
  try {
    const admin = await newMember(browser, demoSite, 'client', 'Ира Администратор')
    people.push(admin)
    const editor = await newMember(browser, demoSite, 'editor', 'Зоя Редактор')
    people.push(editor)
    const other = await newMember(browser, demoSite, 'client', 'Оля Администратор')
    people.push(other)
    // Владелец отключил другого администратора сайта
    const off = await sites[':siteId'].members[':userId'].disable.$post({
      param: { siteId: demoSite.id, userId: other.id },
    })
    expect(off.status).toBe(200)

    // Права редактора и тексты «только просмотр» — по новым ролям
    const editorPage = await editor.context.newPage()
    await editorPage.goto('/theme')
    await expect(editorPage.getByText('Тему меняет владелец установки (студия)')).toBeVisible()
    await editorPage.goto('/header')
    await expect(
      editorPage.getByText('Шапку, меню и подвал меняют владелец и администратор сайта'),
    ).toBeVisible()

    const own = await admin.context.newPage()
    await own.goto('/theme')
    await expect(own.getByText('Тему меняет владелец установки (студия)')).toBeVisible()
    await own.goto('/settings')
    // Приглашает только редакторов: выбора роли в форме нет
    await expect(
      membersRegion(own).getByText('Администратора сайта приглашает владелец'),
    ).toBeVisible()
    await expect(membersRegion(own).getByRole('radio')).toHaveCount(0)
    // Строка редактора: «Отключить» есть, «Роль» — нет (назначать, кроме редактора, некого)
    const editorRow = memberRow(own, editor.email)
    await expect(editorRow.getByRole('button', { name: `Роль: ${editor.name}` })).toHaveCount(0)
    // Отключённый владельцем администратор: роль до отключения видна, вернуть — нельзя
    const otherRow = memberRow(own, other.email)
    await expect(otherRow).toContainText('до отключения: Администратор сайта')
    await expect(otherRow.getByRole('button')).toHaveCount(0)
    const restore = await admin.context.request.post(
      `${urls.admin}/api/sites/${demoSite.id}/members/${other.id}/restore`,
      { data: { role: 'editor' }, headers: { origin: urls.admin } },
    )
    expect(restore.status()).toBe(403)
    expect(await signInContext(other.context, other.email, other.password)).toBe(403)

    // Отключить редактора — и вернуть ему доступ: он был редактором
    await editorRow.getByRole('button', { name: `Отключить доступ: ${editor.name}` }).click()
    await confirmDialog(own).getByRole('button', { name: 'Отключить доступ' }).click()
    await expect(editorRow).toContainText('Отключён')
    await expect(editorRow).toContainText('до отключения: Редактор')
    await editorRow.getByRole('button', { name: `Вернуть доступ: ${editor.name}` }).click()
    const back = own.getByRole('dialog', { name: `Вернуть доступ: ${editor.name}` })
    await expect(back.getByRole('radio', { name: /^Редактор/ })).toBeChecked()
    await back.getByRole('button', { name: 'Вернуть доступ' }).click()
    await expect(editorRow).toContainText('Действует')
  } finally {
    for (const person of people) await disablePerson(demoSite.id, person)
  }
})

test('«Отправить ещё раз»: новое письмо с той же ролью, прежняя ссылка гаснет', async ({
  page,
  browser,
  demoSite,
}) => {
  const email = `resend-${Date.now()}-${randomInt(1000)}@e2e.test`
  await page.goto('/settings')
  const form = membersRegion(page).getByRole('form', { name: 'Пригласить участника' })
  await form.getByLabel('Почта').fill(email)
  await form.getByRole('radio', { name: /^Редактор/ }).check()
  await form.getByRole('button', { name: 'Пригласить' }).click()
  const subject = `Приглашение на сайт «${demoSite.name}» в Averra CMS`
  const first = linkFrom(await waitForMail(email, subject), 'invite')

  await membersRegion(page)
    .getByRole('button', { name: `Отправить ещё раз: ${email}` })
    .click()
  await expect(membersRegion(page).getByRole('status')).toContainText(
    `Приглашение отправлено на ${email} ещё раз`,
  )
  let second = first
  await expect(async () => {
    second = linkFrom(await waitForMail(email, subject), 'invite')
    expect(second).not.toBe(first)
  }).toPass({ timeout: 15_000 })
  const row = membersRegion(page)
    .getByRole('table', { name: 'Приглашения' })
    .getByRole('row')
    .filter({ hasText: email })
  await expect(row.first()).toContainText('Редактор')

  const guest = await (
    await browser.newContext({ storageState: { cookies: [], origins: [] } })
  ).newPage()
  await guest.goto(first)
  await expect(guest.getByRole('alert')).toContainText('Приглашение отозвано')
  await guest.goto(second)
  await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Приглашение на сайт')
  await guest.context().close()
})
