import { confirmDialog, editor, expect, siteScreen, sites, test } from './fixtures'

// Подтверждения — окном админки (useConfirm), а не системным confirm(): подписи с глаголом,
// опасное действие красное, фокус на безопасной кнопке, Esc — отказ, фокус возвращается туда,
// откуда открыли. Проверяем руками с клавиатуры на удалении страницы и уходе из редактора

test('удаление страницы с клавиатуры: Esc — отказ и фокус назад, Tab к «Удалить страницу» — удаляет', async ({
  page,
  demoSite,
}) => {
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug: 'na-udalenie', title: 'На удаление' },
  })
  expect(created.status).toBe(201)
  // Системных окон браузера быть не должно вовсе
  const native: string[] = []
  page.on('dialog', (dialog) => {
    native.push(dialog.message())
    return dialog.dismiss()
  })

  await page.goto('/pages')
  const remove = siteScreen(page)
    .row('На удаление')
    .getByRole('button', { name: 'Удалить страницу «На удаление»' })
  await remove.focus()
  await page.keyboard.press('Enter')

  const ask = confirmDialog(page)
  await expect(ask).toBeVisible()
  await expect(ask).toHaveAccessibleName('Удалить страницу «На удаление» (/na-udalenie)?')
  await expect(ask).toHaveAccessibleDescription('Вернуть её не получится.')
  const keep = ask.getByRole('button', { name: 'Оставить' })
  const confirm = ask.getByRole('button', { name: 'Удалить страницу' })
  await expect(keep).toBeFocused()
  // Опасная кнопка отличается не только цветом от «Оставить»: у неё другой фон
  const background = (button: typeof keep) =>
    button.evaluate(
      (element) => element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor,
    )
  expect(await background(confirm)).not.toBe(await background(keep))

  await page.keyboard.press('Escape')
  await expect(ask).toBeHidden()
  await expect(remove).toBeFocused()
  await expect(siteScreen(page).row('На удаление')).toBeVisible()

  await page.keyboard.press('Enter')
  await expect(keep).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(siteScreen(page).row('На удаление')).toHaveCount(0)
  expect(native).toEqual([])
})

test('уход из редактора с правками: окно «Уйти без сохранения?», «Остаться» оставляет правку; на 375 px окно целиком', async ({
  page,
}) => {
  const native: string[] = []
  page.on('dialog', (dialog) => {
    native.push(dialog.message())
    return dialog.dismiss()
  })
  const ed = editor(page)
  await ed.open()
  await ed.field('Заголовок').fill('Правка без сохранения')
  // Телефон: окно целиком в экране, кнопки не обрезаны
  await page.setViewportSize({ width: 375, height: 812 })
  await ed.backToSite.click()

  const ask = confirmDialog(page)
  await expect(ask).toHaveAccessibleName('Уйти без сохранения?')
  await expect(ask.getByRole('button', { name: 'Остаться' })).toBeFocused()
  await expect(ask.getByRole('button', { name: 'Уйти без сохранения' })).toBeInViewport({
    ratio: 1,
  })
  const box = await ask.boundingBox()
  expect(box?.width ?? 0).toBeLessThanOrEqual(375)

  await ask.getByRole('button', { name: 'Остаться' }).click()
  await expect(page).toHaveURL('/pages/index')
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(ed.field('Заголовок')).toHaveValue('Правка без сохранения')

  await ed.backToSite.click()
  await ask.getByRole('button', { name: 'Уйти без сохранения' }).click()
  await expect(page).toHaveURL('/')
  expect(native).toEqual([])
})
