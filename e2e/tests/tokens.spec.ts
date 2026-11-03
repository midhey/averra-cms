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
  expect((await request.get(pageUrl, { headers })).status()).toBe(200)

  await revokeButton.click()
  await confirm.getByRole('button', { name: 'Отозвать' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'отозван' })).toHaveText(
    `Токен «${name}» отозван: программа с ним больше не войдёт`,
  )
  await expect(row).toContainText('Отозван')
  await expect(row.getByRole('button')).toHaveCount(0)
  expect((await request.get(pageUrl, { headers })).status()).toBe(401)
})

test('права токена меняются в окне и действуют сразу', async ({ page, demoSite }) => {
  const name = `Права e2e ${Date.now()}`
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
  const row = page.getByRole('table', { name: 'Токены' }).getByRole('row').filter({ hasText: name })
  await expect(row).toContainText('публикация страниц')
  await expect(row).not.toContainText('Только черновики')

  const headers = { authorization: `Bearer ${token}` }
  const publish = await page.request.post(
    `${urls.api}/api/sites/${demoSite.id}/pages/index/publish`,
    { headers },
  )
  expect(publish.status()).toBe(200)
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
