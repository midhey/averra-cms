import { demo, editor, expect, openSite, test } from './fixtures'

const published = 'Опубликовано. Обнови сайт, чтобы увидеть'

test('сохранённый черновик переживает перезагрузку, но на сайт не попадает', async ({ page }) => {
  const ed = editor(page)
  await ed.open()

  await ed.field('Заголовок').fill('Черновой заголовок')
  await ed.pageTitle.fill('Черновое название')
  await ed.saveButton.click()

  await expect(ed.status).toHaveText('Черновик сохранён')
  await expect(ed.saveButton).toBeDisabled()

  await page.reload()
  await expect(ed.pageTitle).toHaveValue('Черновое название')
  await expect(ed.field('Заголовок')).toHaveValue('Черновой заголовок')
  await expect(ed.status).toHaveText('Всё сохранено')

  const site = await openSite(page)
  await expect(site).toHaveTitle(demo.pageTitle)
  await expect(site.getByRole('heading', { level: 1 })).toHaveText(demo.heroTitle)
})

test('после публикации сайт показывает новый заголовок', async ({ page }) => {
  const ed = editor(page)
  await ed.open()

  await ed.field('Заголовок').fill('Ремонт за 30 дней с гарантией')
  await ed.pageTitle.fill('Ремонт за 30 дней')
  await ed.saveButton.click()
  await expect(ed.status).toHaveText('Черновик сохранён')
  await ed.publishButton.click()

  await expect(ed.status).toHaveText(published)

  const site = await openSite(page)
  await expect(site).toHaveTitle('Ремонт за 30 дней')
  await expect(site.getByRole('heading', { level: 1 })).toHaveText('Ремонт за 30 дней с гарантией')
})

test('«Опубликовать» с несохранёнными правками сохраняет и публикует их', async ({ page }) => {
  const ed = editor(page)
  await ed.open()

  await ed.field('Заголовок').fill('Опубликовано одной кнопкой')
  await ed.publishButton.click()

  await expect(ed.status).toHaveText(published)
  await expect(ed.saveButton).toBeDisabled()

  const site = await openSite(page)
  await expect(site.getByRole('heading', { level: 1 })).toHaveText('Опубликовано одной кнопкой')

  // Черновик тоже сохранился
  await page.reload()
  await expect(ed.field('Заголовок')).toHaveValue('Опубликовано одной кнопкой')
})

test('опубликованный порядок блоков совпадает с редактором', async ({ page }) => {
  const ed = editor(page)
  await ed.open()

  await ed.block('Призыв к действию').getByRole('button', { name: 'Поднять блок' }).click()
  await ed.publishButton.click()
  await expect(ed.status).toHaveText(published)

  const site = await openSite(page)
  await expect(site.getByRole('heading', { level: 2 })).toHaveText([
    demo.ctaTitle,
    demo.featuresTitle,
  ])
})
