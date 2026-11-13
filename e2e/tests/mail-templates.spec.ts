import { expect, ownerApi, test } from './fixtures'

test('владелец меняет, просматривает, публикует и сбрасывает письмо «Заявка получена»', async ({
  page,
  demoSite,
}) => {
  const endpoint = ownerApi.sites[':siteId']['mail-templates'][':template']
  const param = { siteId: demoSite.id, template: 'lead-received' }
  await endpoint.$delete({ param })
  try {
    await page.goto('/notifications')
    const letters = page.getByRole('region', { name: 'Письма', exact: true })
    const article = letters.getByRole('article', { name: 'Заявка получена', exact: true })
    await article.locator('summary').click()
    await article.getByLabel('Тема', { exact: true }).fill('Спасибо за обращение — {siteName}')
    await article
      .getByLabel('Текст письма', { exact: true })
      .fill('Мы приняли заявку.\n\nМенеджер скоро позвонит.')
    await article.getByRole('button', { name: 'Обновить предпросмотр' }).click()
    const frame = article.frameLocator('iframe')
    await expect(frame.locator('body')).toContainText('Менеджер скоро позвонит.')
    await expect(article).toContainText(`Спасибо за обращение — ${demoSite.name}`)
    await article.getByRole('button', { name: 'Опубликовать', exact: true }).click()
    await expect(article.getByRole('status')).toContainText('Текст опубликован')
    await page.reload()
    const saved = page.getByRole('article', { name: 'Заявка получена', exact: true })
    await saved.locator('summary').click()
    await expect(saved.getByLabel('Тема', { exact: true })).toHaveValue(
      'Спасибо за обращение — {siteName}',
    )
    await saved.getByRole('button', { name: 'Вернуть стандартный текст' }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Вернуть стандартный текст' })
      .click()
    await expect(saved.getByLabel('Тема', { exact: true })).toHaveValue(
      'Заявка получена — {siteName}',
    )
    await saved.getByRole('button', { name: 'Обновить предпросмотр' }).click()
    await expect(saved.frameLocator('iframe').locator('body')).toContainText(
      'Мы получили вашу заявку',
    )
  } finally {
    await endpoint.$delete({ param })
  }
})
