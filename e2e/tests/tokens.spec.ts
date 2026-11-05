import { urls } from '../urls'
import { expect, test } from './fixtures'

// «Доступ для ИИ» по-настоящему: владелец выпускает токен «только черновики», копирует фрагмент
// .mcp.json, токен работает в API через адрес из фрагмента и не может публиковать, а после
// «Отозвать» API его не пускает. Права и роли подробно проверяют тесты API (modules/tokens)

const overflow = (page: import('@playwright/test').Page) =>
  page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  ) as Promise<number>

test('выпустить токен, скопировать фрагмент .mcp.json, отозвать — и API его больше не пускает', async ({
  page,
  context,
  demoSite,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: urls.admin })
  const name = `Claude Code e2e ${Date.now()}`

  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Установка' })
    .getByRole('link', { name: 'Доступ для ИИ' })
    .click()
  await expect(page).toHaveURL('/tokens')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Доступ для ИИ')

  // По умолчанию — «только черновики»: черновики своих блоков да, публикация и удаление нет
  const form = page.getByRole('form', { name: 'Выпустить токен' })
  await expect(form.getByRole('checkbox', { name: 'Черновики своих блоков' })).toBeChecked()
  await expect(form.getByRole('checkbox', { name: 'Публикация страниц' })).not.toBeChecked()
  await expect(
    form.getByRole('checkbox', { name: 'Удаление страниц и картинок' }),
  ).not.toBeChecked()

  // Пустое имя — ошибка у поля, фокус на нём
  await form.getByRole('button', { name: 'Выпустить токен' }).click()
  await expect(form.getByLabel('Имя')).toBeFocused()
  await expect(form).toContainText('Введите имя токена')

  await form.getByLabel('Имя').fill(name)
  await form.getByRole('button', { name: 'Выпустить токен' }).click()

  const dialog = page.getByRole('dialog', { name: `Токен «${name}» выпущен` })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('показывается один раз')
  const token = await dialog.getByLabel('Токен', { exact: true }).inputValue()
  expect(token).toMatch(/^cms_[0-9a-f-]{36}_[0-9a-f]{64}$/)

  // Первый фокус — не на «×»: лишний Enter копирует токен, а не закрывает окно. Пока ничего не
  // скопировано, Esc окно не закрывает: токен показывается один раз. Chrome после пары Esc подряд
  // перестаёт давать отменить закрытие (close watcher), и окно закрывалось на третьем нажатии,
  // поэтому нажимаем с запасом: окно на месте, токен на месте, а подсказка говорит, что делать
  await expect(dialog.getByRole('button', { name: 'Скопировать токен' })).toBeFocused()
  // Окно не закрывается ни на миг: событие close не приходит (раньше Chrome закрывал окно и
  // возвращал его: читалка объявляла его заново, фокус на мгновение уходил на кнопку под ним)
  await dialog.evaluate((element) => {
    element.addEventListener('close', () => {
      element.dataset.closes = String(Number(element.dataset.closes ?? 0) + 1)
    })
  })
  for (let press = 0; press < 6; press++) await page.keyboard.press('Escape')
  await expect(dialog).not.toHaveAttribute('data-closes', /./)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Токен', { exact: true })).toHaveValue(token)
  await expect(dialog.getByRole('status')).toContainText('Esc не закрывает окно')
  await expect(dialog.getByRole('button', { name: 'Скопировать токен' })).toBeFocused()

  // Копирование не удалось (браузер не дал доступа к буферу): токен не скопирован, поэтому Esc по
  // прежнему не закрывает окно — и подсказка про Esc не теряется за сообщением о копировании
  await page.evaluate(
    "navigator.clipboard.writeText = () => Promise.reject(new Error('нет доступа'))",
  )
  await dialog.getByRole('button', { name: 'Скопировать токен' }).click()
  await expect(dialog.getByRole('status')).toContainText('Браузер не дал скопировать')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('status')).toContainText('Браузер не дал скопировать')
  await expect(dialog.getByRole('status')).toContainText('Esc не закрывает окно')
  await page.evaluate('delete navigator.clipboard.writeText')

  await dialog.getByRole('button', { name: 'Скопировать фрагмент .mcp.json' }).click()
  await expect(dialog.getByRole('status')).toHaveText('Фрагмент .mcp.json скопирован')
  const copied = JSON.parse(
    await (page.evaluate('navigator.clipboard.readText()') as Promise<string>),
  ) as {
    mcpServers: { averra: { command: string; env: { CMS_API_URL: string; CMS_API_TOKEN: string } } }
  }
  expect(copied.mcpServers.averra.env).toEqual({ CMS_API_URL: urls.admin, CMS_API_TOKEN: token })
  expect(copied.mcpServers.averra.command).toBe('node_modules/.bin/node')

  await dialog.getByRole('button', { name: 'Скопировать токен' }).click()
  await expect(dialog.getByRole('status')).toHaveText('Токен скопирован')
  expect(await (page.evaluate('navigator.clipboard.readText()') as Promise<string>)).toBe(token)

  // Токен работает по адресу из фрагмента — так его возьмёт MCP-сервер: черновик да, публикация нет
  const { request } = page
  const apiUrl = copied.mcpServers.averra.env.CMS_API_URL
  const headers = { authorization: `Bearer ${token}` }
  const pageUrl = `${apiUrl}/api/sites/${demoSite.id}/pages/index`
  expect((await request.get(pageUrl, { headers })).status()).toBe(200)
  const publish = await request.post(`${pageUrl}/publish`, { headers })
  expect(publish.status()).toBe(403)
  expect(await publish.text()).toContain('Публиковать этому токену не разрешено')

  // Закрыли окно — токена на экране больше нет, в списке — имя и права без него
  await dialog.getByRole('button', { name: 'Готово, я сохранил токен' }).click()
  await expect(dialog).toBeHidden()
  // Окно убрано из страницы открытым: фокус возвращается на кнопку, которая его открыла
  await expect(form.getByRole('button', { name: 'Выпустить токен' })).toBeFocused()
  await page.reload()
  await expect(page.locator('body')).not.toContainText(token.slice(-64))
  const table = page.getByRole('table', { name: 'Токены' })
  const row = table.getByRole('row').filter({ hasText: name })
  await expect(row).toContainText('Только черновики')
  await expect(row).toContainText('Черновики страниц, черновики своих блоков')
  await expect(row).not.toContainText('публикация страниц')

  // Телефон: страница не ездит вбок, «Отозвать» видно целиком
  await page.setViewportSize({ width: 375, height: 812 })
  const revokeButton = page.getByRole('button', { name: `Отозвать токен «${name}»` })
  await revokeButton.scrollIntoViewIfNeeded()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await expect(revokeButton).toBeInViewport({ ratio: 1 })
  await page.setViewportSize({ width: 1440, height: 900 })

  // Отзыв — с подтверждением в окне; «Отмена» ничего не меняет
  await revokeButton.click()
  const confirm = page.getByRole('dialog', { name: `Отозвать токен «${name}»?` })
  await expect(confirm).toContainText('сразу потеряет доступ')
  await confirm.getByRole('button', { name: 'Отмена' }).click()
  await expect(confirm).toBeHidden()
  await expect(revokeButton).toBeFocused()
  expect((await request.get(pageUrl, { headers })).status()).toBe(200)

  await revokeButton.click()
  await confirm.getByRole('button', { name: 'Отозвать' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'отозван' })).toHaveText(
    `Токен «${name}» отозван: программа с ним больше не войдёт`,
  )
  await expect(row).toContainText('Отозван')
  await expect(row.getByRole('button')).toHaveCount(0)
  // Кнопки строки пропали: фокус — на заголовке списка, а не на body
  await expect(page.getByRole('heading', { level: 2, name: 'Токены', exact: true })).toBeFocused()
  expect((await request.get(pageUrl, { headers })).status()).toBe(401)
})

test('телефон: окно токена не закрылось — подсказка видна, а не под краем экрана', async ({
  page,
}) => {
  const name = `Телефон e2e ${Date.now()}`
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/tokens')
  const form = page.getByRole('form', { name: 'Выпустить токен' })
  await form.getByLabel('Имя').fill(name)
  await form.getByRole('button', { name: 'Выпустить токен' }).click()
  const dialog = page.getByRole('dialog', { name: `Токен «${name}» выпущен` })
  await expect(dialog).toBeVisible()
  // Подсказка — внизу окна, под фрагментом .mcp.json: без прокрутки её не было бы видно. Esc
  // с фокусом в окне окно гасит ещё на keydown — до события cancel
  const hint = dialog.getByText('Esc не закрывает окно')
  const token = await dialog.getByLabel('Токен', { exact: true }).inputValue()
  const toTop = () =>
    dialog.evaluate((element) => {
      for (const node of [element, ...element.querySelectorAll('*')]) node.scrollTop = 0
    })
  await page.keyboard.press('Escape')
  await expect(hint).toBeInViewport({ ratio: 1 })
  // «Назад» на телефоне идёт другим путём: браузер сам просит окно закрыться (cancel, а без
  // него — close). requestClose() — тот же запрос. Человек прокрутил окно обратно к токену и
  // жмёт «Назад» дважды: окно на месте, токен тот же, подсказка каждый раз на виду
  for (let press = 0; press < 2; press++) {
    await toTop()
    await expect(dialog.getByLabel('Токен', { exact: true })).toBeInViewport()
    await expect(hint).not.toBeInViewport()
    await dialog.evaluate((element) =>
      (element as unknown as { requestClose(): void }).requestClose(),
    )
    await expect(hint).toBeInViewport({ ratio: 1 })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Токен', { exact: true })).toHaveValue(token)
  }
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  // Убираем за собой: закрыть кнопкой и отозвать
  await dialog.getByRole('button', { name: 'Готово, я сохранил токен' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: `Отозвать токен «${name}»` }).click()
  await page
    .getByRole('dialog', { name: `Отозвать токен «${name}»?` })
    .getByRole('button', { name: 'Отозвать' })
    .click()
  await expect(
    page.getByRole('table', { name: 'Токены' }).getByRole('row').filter({ hasText: name }),
  ).toContainText('Отозван')
})

test('права токена меняются в окне и действуют сразу', async ({ page, demoSite }) => {
  const name = `Права e2e ${Date.now()}`
  // Часы подменяем до загрузки страницы: их ход видят и таймеры списка токенов
  await page.clock.install()
  await page.goto('/tokens')
  const form = page.getByRole('form', { name: 'Выпустить токен' })
  await form.getByLabel('Имя').fill(name)
  await form.getByRole('button', { name: 'Выпустить токен' }).click()
  const issued = page.getByRole('dialog', { name: `Токен «${name}» выпущен` })
  const token = await issued.getByLabel('Токен', { exact: true }).inputValue()
  await issued.getByRole('button', { name: 'Готово, я сохранил токен' }).click()

  await page.getByRole('button', { name: `Права токена «${name}»` }).click()
  const rights = page.getByRole('dialog', { name: `Права токена «${name}»` })
  await expect(rights.getByRole('button', { name: 'Сохранить права' })).toBeDisabled()
  await rights.getByRole('checkbox', { name: 'Публикация страниц' }).check()
  await rights.getByRole('button', { name: 'Сохранить права' }).click()
  await expect(rights).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'сохранены' })).toBeVisible()
  await expect(page.getByRole('button', { name: `Права токена «${name}»` })).toBeFocused()
  const row = page.getByRole('table', { name: 'Токены' }).getByRole('row').filter({ hasText: name })
  await expect(row).toContainText('публикация страниц')
  await expect(row).not.toContainText('Только черновики')

  const headers = { authorization: `Bearer ${token}` }
  const publish = await page.request.post(
    `${urls.api}/api/sites/${demoSite.id}/pages/index/publish`,
    { headers },
  )
  expect(publish.status()).toBe(200)
  // Токеном пользовались вне админки: человек остаётся на вкладке, ничего не нажимая, а список
  // сам перечитывается раз в 30 с, без перезагрузки — «не пользовались» сменяется на «только что».
  // Часы подменены (clock): ни возврата на вкладку, ни события фокуса, только ход времени
  await expect(row).toContainText('не пользовались')
  await page.clock.fastForward(31_000)
  await expect(row).not.toContainText('не пользовались')
  // Убираем за собой: токен с правом публикации не должен пережить тест
  await page.getByRole('button', { name: `Отозвать токен «${name}»` }).click()
  await page
    .getByRole('dialog', { name: `Отозвать токен «${name}»?` })
    .getByRole('button', {
      name: 'Отозвать',
    })
    .click()
  await expect(row).toContainText('Отозван')
})
