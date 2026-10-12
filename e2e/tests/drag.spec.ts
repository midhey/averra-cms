import type { Locator } from '@playwright/test'
import { demo, dragWithMouse, editor, expect, firstArrow, test } from './fixtures'

/** Пункты «Преимуществ» демо-лендинга по порядку */
const features = ['Смета за 1 день', 'Цена не меняется', 'Свои бригады', 'Гарантия 3 года'] as const

/** Где элемент на странице предпросмотра: по нему видно, какой блок выше */
const topOf = (locator: Locator) => locator.evaluate((el) => el.getBoundingClientRect().top)

test('блок перетаскивается мышью: меняется порядок в списке и в предпросмотре', async ({
  page,
}) => {
  const ed = editor(page)
  await ed.open()

  await dragWithMouse(page, ed.dragHandle('Призыв к действию'), ed.block('Первый экран'))

  await expect(ed.blocks.nth(0)).toContainText('Призыв к действию')
  await expect(ed.blocks.nth(1)).toContainText('Первый экран')
  await expect(ed.blocks.nth(2)).toContainText('Преимущества')
  await expect(ed.preview.getByRole('heading', { level: 2 })).toHaveText([
    demo.ctaTitle,
    demo.featuresTitle,
  ])
  // Предпросмотр рисует блоки по порядку черновика: призыв теперь выше первого экрана
  const ctaTop = await topOf(ed.preview.getByText(demo.ctaTitle))
  const heroTop = await topOf(ed.preview.getByText(demo.heroTitle))
  expect(ctaTop).toBeLessThan(heroTop)
  await expect(ed.status).toHaveText('Есть несохранённые изменения')
  await expect(ed.blockAnnouncement).toHaveText(
    `Блок «${demo.ctaTitle}» поставлен на позицию 1 из 3.`,
  )

  await ed.saveButton.click()
  await expect(ed.status).toHaveText('Черновик сохранён')
  await page.reload()
  await expect(ed.blocks.nth(0)).toContainText('Призыв к действию')
  await expect(ed.blocks.nth(1)).toContainText('Первый экран')
  await expect(ed.blocks.nth(2)).toContainText('Преимущества')
})

test('щелчок по ручке без движения ничего не переставляет', async ({ page }) => {
  const ed = editor(page)
  await ed.open()

  await ed.dragHandle('Преимущества').click()

  await expect(ed.blocks.nth(1)).toContainText('Преимущества')
  await expect(ed.status).toHaveText('Всё сохранено')
  await expect(ed.saveButton).toBeDisabled()
})

test('блок переставляется с клавиатуры, диктор слышит, что происходит', async ({ page }) => {
  const ed = editor(page)
  await ed.open()
  const handle = ed.dragHandle('Первый экран')

  // Подсказка о клавишах связана с ручкой: диктор прочитает её вместе с подписью
  await expect(handle).toHaveAccessibleDescription(/нажмите пробел или Enter/)

  await handle.focus()
  await page.keyboard.press('Space')
  await expect(ed.blockAnnouncement).toHaveText(`Блок «${demo.heroTitle}» поднят. Позиция 1 из 3.`)
  await firstArrow(
    page,
    'ArrowDown',
    ed.blockAnnouncement,
    `Блок «${demo.heroTitle}» на позиции 2 из 3.`,
  )
  await page.keyboard.press('ArrowDown')
  await expect(ed.blockAnnouncement).toHaveText(`Блок «${demo.heroTitle}» на позиции 3 из 3.`)
  // Пока блок не поставлен, черновик не меняется
  await expect(ed.blocks.nth(0)).toContainText('Первый экран')
  await page.keyboard.press('Space')

  await expect(ed.blockAnnouncement).toHaveText(
    `Блок «${demo.heroTitle}» поставлен на позицию 3 из 3.`,
  )
  await expect(ed.blocks.nth(0)).toContainText('Преимущества')
  await expect(ed.blocks.nth(1)).toContainText('Призыв к действию')
  await expect(ed.blocks.nth(2)).toContainText('Первый экран')
  // Фокус остался на ручке того же блока: можно двигать дальше
  await expect(ed.dragHandle('Первый экран')).toBeFocused()
  const heroTop = await topOf(ed.preview.getByText(demo.heroTitle))
  const ctaTop = await topOf(ed.preview.getByText(demo.ctaTitle))
  expect(heroTop).toBeGreaterThan(ctaTop)
  await expect(ed.status).toHaveText('Есть несохранённые изменения')
})

test('Escape отменяет перетаскивание с клавиатуры', async ({ page }) => {
  const ed = editor(page)
  await ed.open()

  await ed.dragHandle('Преимущества').focus()
  await page.keyboard.press('Enter')
  await expect(ed.blockAnnouncement).toContainText('поднят')
  await firstArrow(
    page,
    'ArrowUp',
    ed.blockAnnouncement,
    `Блок «${demo.featuresTitle}» на позиции 1 из 3.`,
  )
  await page.keyboard.press('Escape')

  await expect(ed.blockAnnouncement).toHaveText(
    `Перетаскивание отменено. Блок «${demo.featuresTitle}» остался на позиции 2 из 3.`,
  )
  await expect(ed.blocks.nth(0)).toContainText('Первый экран')
  await expect(ed.blocks.nth(1)).toContainText('Преимущества')
  await expect(ed.status).toHaveText('Всё сохранено')
})

test('пункты списка в форме блока переставляются перетаскиванием', async ({ page }) => {
  const ed = editor(page)
  await ed.open()
  await ed.selectBlock('Преимущества')
  await expect(ed.itemTitles).toHaveCount(4)
  const previewItems = ed.preview.getByRole('heading', { level: 3 })
  await expect(previewItems).toHaveText(features)

  // С клавиатуры: первый пункт — на третье место. Значения полей едут вместе с пунктом
  await ed.itemHandles.nth(0).focus()
  await page.keyboard.press('Space')
  await expect(ed.itemAnnouncement).toHaveText(`Пункт «${features[0]}» поднят. Позиция 1 из 4.`)
  await firstArrow(
    page,
    'ArrowDown',
    ed.itemAnnouncement,
    `Пункт «${features[0]}» на позиции 2 из 4.`,
  )
  await page.keyboard.press('ArrowDown')
  await expect(ed.itemAnnouncement).toContainText('на позиции 3 из 4')
  await page.keyboard.press('Space')

  const afterKeyboard = [features[1], features[2], features[0], features[3]]
  await expect(ed.itemAnnouncement).toHaveText(
    `Пункт «${features[0]}» поставлен на позицию 3 из 4.`,
  )
  for (const [index, title] of afterKeyboard.entries()) {
    await expect(ed.itemTitles.nth(index)).toHaveValue(title)
  }
  await expect(previewItems).toHaveText(afterKeyboard)

  // Мышью: второй пункт — на первое место. Пункты высокие, и дальний сосед не поместился бы
  // на экран вместе с ручкой
  await dragWithMouse(page, ed.itemHandles.nth(1), ed.itemHandles.nth(0))
  const afterMouse = [features[2], features[1], features[0], features[3]]
  for (const [index, title] of afterMouse.entries()) {
    await expect(ed.itemTitles.nth(index)).toHaveValue(title)
  }
  await expect(previewItems).toHaveText(afterMouse)

  // Стрелки пунктов работают как раньше, и правка поля попадает в нужный пункт
  await ed.items.getByRole('button', { name: 'Опустить пункт' }).first().click()
  await ed.itemTitles.nth(0).fill('Работаем по договору')
  await expect(previewItems).toHaveText([
    'Работаем по договору',
    features[2],
    features[0],
    features[3],
  ])
})
