import { demo, editor, expect, openSite, test } from './fixtures'

test('редактор открывается с демо-лендингом', async ({ page }) => {
  const ed = editor(page)
  await ed.open()

  await expect(ed.pageTitle).toHaveValue(demo.pageTitle)
  await expect(ed.status).toHaveText('Опубликовано')
  await expect(ed.blocks).toHaveCount(3)
  await expect(ed.blocks.nth(0)).toContainText(`Первый экран${demo.heroTitle}`)
  await expect(ed.blocks.nth(1)).toContainText(`Преимущества${demo.featuresTitle}`)
  await expect(ed.blocks.nth(2)).toContainText(`Призыв к действию${demo.ctaTitle}`)

  // Первый блок сразу открыт в инспекторе
  await expect(ed.inspector.getByRole('heading', { name: 'Первый экран' })).toBeVisible()
  await expect(ed.field('Заголовок')).toHaveValue(demo.heroTitle)

  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText(demo.heroTitle)
  await expect(ed.preview.getByRole('heading', { level: 2 })).toHaveText([
    demo.featuresTitle,
    demo.ctaTitle,
  ])
  // Без правок сохранять нечего, а опубликовать можно
  await expect(ed.saveButton).toBeDisabled()
  await expect(ed.publishButton).toBeEnabled()
})

test('правка заголовка первого экрана сразу видна в предпросмотре', async ({ page }) => {
  const ed = editor(page)
  await ed.open()

  await ed.field('Заголовок').fill('Ремонт за 30 дней')

  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText('Ремонт за 30 дней')
  await expect(ed.block('Первый экран')).toContainText('Ремонт за 30 дней')
  await expect(ed.status).toHaveText('Есть несохранённые правки')
  await expect(ed.saveButton).toBeEnabled()
})

test('пустое обязательное поле показывает ошибку и выключает сохранение', async ({ page }) => {
  const ed = editor(page)
  await ed.open()
  const title = ed.field('Заголовок')

  await title.fill('')

  await expect(ed.inspector.getByText('Поле не может быть пустым')).toBeVisible()
  await expect(title).toHaveAttribute('aria-invalid', 'true')
  await expect(ed.block('Первый экран')).toContainText('Ошибка')
  await expect(ed.saveButton).toBeDisabled()
  await expect(ed.publishButton).toBeDisabled()
  // Пока поле с ошибкой, предпросмотр держит последнюю правильную версию
  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText(demo.heroTitle)

  await title.fill('Новый заголовок')
  await expect(ed.inspector.getByText('Поле не может быть пустым')).toBeHidden()
  await expect(ed.block('Первый экран')).not.toContainText('Ошибка')
  await expect(ed.saveButton).toBeEnabled()
  await expect(ed.publishButton).toBeEnabled()
  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText('Новый заголовок')

  // Пробелы схема обрезает, поэтому это тоже пустое поле. Начинаем с правильного
  // значения, иначе выключенные кнопки ничего бы не доказывали
  await title.fill('   ')
  await expect(ed.inspector.getByText('Поле не может быть пустым')).toBeVisible()
  await expect(ed.saveButton).toBeDisabled()
  await expect(ed.publishButton).toBeDisabled()
})

test('пустой заголовок страницы показывает ошибку и выключает сохранение', async ({ page }) => {
  const ed = editor(page)
  await ed.open()

  await ed.pageTitle.fill('')

  // Текст ошибки виден и связан с полем: экранный диктор прочитает его вместе с подписью
  await expect(ed.pageTitle).toHaveAttribute('aria-invalid', 'true')
  await expect(ed.pageTitle).toHaveAccessibleDescription(
    'Заголовок страницы: Поле не может быть пустым',
  )
  await expect(page.getByText('Заголовок страницы: Поле не может быть пустым')).toBeVisible()
  await expect(ed.saveButton).toBeDisabled()
  await expect(ed.publishButton).toBeDisabled()

  await ed.pageTitle.fill('Лендинг')
  await expect(ed.pageTitle).not.toHaveAttribute('aria-invalid')
  await expect(page.getByText(/Заголовок страницы: /)).toBeHidden()
  await expect(ed.saveButton).toBeEnabled()

  // Одни пробелы — тоже пустой заголовок, как и в API
  await ed.pageTitle.fill('   ')
  await expect(ed.pageTitle).toHaveAccessibleDescription(
    'Заголовок страницы: Поле не может быть пустым',
  )
  await expect(ed.saveButton).toBeDisabled()
  await expect(ed.publishButton).toBeDisabled()
})

test('новый блок встаёт после выбранного и сразу виден в предпросмотре', async ({ page }) => {
  const ed = editor(page)
  await ed.open()

  // Выбран первый экран: новый блок встанет вторым
  await ed.addBlock('Призыв к действию')

  await expect(ed.blocks).toHaveCount(4)
  await expect(ed.blocks.nth(1)).toContainText('Призыв к действиюГотовы начать?')
  await expect(ed.inspector.getByRole('heading', { name: 'Призыв к действию' })).toBeVisible()
  await expect(ed.inspector.getByText('#cta-1')).toBeVisible()
  await expect(ed.preview.getByRole('heading', { level: 2 })).toHaveText([
    'Готовы начать?',
    demo.featuresTitle,
    demo.ctaTitle,
  ])

  // Поля нового блока правятся как у любого другого
  await ed.field('Заголовок').fill('Звоните прямо сейчас')
  await expect(ed.preview.getByRole('heading', { level: 2 }).first()).toHaveText(
    'Звоните прямо сейчас',
  )

  // Блок попадает в черновик и переживает перезагрузку
  await ed.saveButton.click()
  await expect(ed.status).toHaveText('Сохранено · правки не опубликованы')
  await page.reload()
  await expect(ed.blocks).toHaveCount(4)
  await expect(ed.blocks.nth(1)).toContainText('Звоните прямо сейчас')
})

test('блоки переставляются стрелками, порядок сохраняется', async ({ page }) => {
  const ed = editor(page)
  await ed.open()

  // Стрелки и удаление — только у выбранного блока: у остальных в списке их нет
  await expect(ed.block('Преимущества').getByRole('button', { name: 'Опустить блок' })).toHaveCount(
    0,
  )
  // Крайние блоки дальше края не двигаются
  await expect(ed.blocks.first().getByRole('button', { name: 'Поднять блок' })).toBeDisabled()
  await ed.selectBlock('Призыв к действию')
  await expect(ed.blocks.last().getByRole('button', { name: 'Опустить блок' })).toBeDisabled()

  await ed.selectBlock('Преимущества')
  await ed.block('Преимущества').getByRole('button', { name: 'Опустить блок' }).click()

  await expect(ed.blocks.nth(1)).toContainText('Призыв к действию')
  await expect(ed.blocks.nth(2)).toContainText('Преимущества')
  await expect(ed.preview.getByRole('heading', { level: 2 })).toHaveText([
    demo.ctaTitle,
    demo.featuresTitle,
  ])

  // С клавиатуры: Enter на блоке выбирает его, Tab — на стрелку, Enter
  await ed
    .block('Призыв к действию')
    .getByRole('button', { name: /^Призыв к действию/ })
    .focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  const raise = ed.block('Призыв к действию').getByRole('button', { name: 'Поднять блок' })
  await expect(raise).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(ed.blocks.nth(0)).toContainText('Призыв к действию')
  // Первый экран больше не первый блок, но h1 всё равно у него: он единственный hero
  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText(demo.heroTitle)

  await ed.saveButton.click()
  await expect(ed.status).toHaveText('Сохранено · правки не опубликованы')
  await page.reload()
  await expect(ed.blocks.nth(0)).toContainText('Призыв к действию')
  await expect(ed.blocks.nth(1)).toContainText('Первый экран')
  await expect(ed.blocks.nth(2)).toContainText('Преимущества')
})

test('блок удаляется только после подтверждения', async ({ page }) => {
  const ed = editor(page)
  await ed.open()
  await ed.selectBlock('Призыв к действию')
  const remove = ed.block('Призыв к действию').getByRole('button', { name: 'Удалить блок' })

  // Считаем диалоги: без этого «блоков всё ещё три» было бы верно и без вопроса
  const dialogs: string[] = []
  page.once('dialog', (dialog) => {
    dialogs.push(dialog.message())
    return dialog.dismiss()
  })
  await remove.click()
  await expect.poll(() => dialogs.length).toBe(1)
  expect(dialogs[0]).toContain(demo.ctaTitle)
  await expect(ed.blocks).toHaveCount(3)
  await expect(ed.block('Призыв к действию')).toBeVisible()

  page.once('dialog', (dialog) => {
    dialogs.push(dialog.message())
    return dialog.accept()
  })
  await remove.click()

  await expect(ed.blocks).toHaveCount(2)
  expect(dialogs).toHaveLength(2)
  await expect(ed.preview.getByText(demo.ctaTitle)).toHaveCount(0)
})

test('плашка в полосе говорит, что с черновиком: правки, сохранено, опубликовано', async ({
  page,
}) => {
  const ed = editor(page)
  await ed.open()
  await expect(ed.status).toHaveText('Опубликовано')

  await ed.field('Заголовок').fill('Ремонт без сюрпризов')
  await expect(ed.status).toHaveText('Есть несохранённые правки')
  await ed.saveButton.click()
  await expect(ed.status).toHaveText('Сохранено · правки не опубликованы')
  // Кнопка недоступна, но фокус с неё не пропал: следующий Tab идёт дальше по полосе
  await expect(ed.saveButton).toBeDisabled()
  await expect(ed.saveButton).toBeFocused()

  await ed.publishButton.click()
  await expect(ed.status).toHaveText('Опубликовано. Обнови сайт, чтобы увидеть')
  await page.reload()
  await expect(ed.status).toHaveText('Опубликовано')
})

test('«Добавить блок» с клавиатуры: окно с каталогом, Esc закрывает, Enter добавляет', async ({
  page,
}) => {
  const ed = editor(page)
  await ed.open()

  await ed.addBlockButton.focus()
  await page.keyboard.press('Enter')
  await expect(ed.addBlockDialog).toBeVisible()
  // У каждого блока каталога — описание; фокус — в поиске (с мышью)
  const hero = ed.addBlockDialog.getByRole('button', { name: /^Первый экран/ })
  await expect(hero).toContainText('первое, что видит посетитель')
  await expect(ed.addBlockDialog.getByRole('searchbox', { name: 'Найти блок' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(ed.addBlockDialog).toBeHidden()
  await expect(ed.addBlockButton).toBeFocused()
  await expect(ed.blocks).toHaveCount(3)

  await page.keyboard.press('Enter')
  await hero.focus()
  await page.keyboard.press('Enter')
  await expect(ed.addBlockDialog).toBeHidden()
  await expect(ed.blocks).toHaveCount(4)
  // Встал после выбранного первого экрана и сам выбран
  await expect(ed.blocks.nth(1)).toContainText('Первый экранГлавная мысль страницы')
  await expect(ed.inspector.getByText('#hero-1')).toBeVisible()
})

test('щелчок по блоку в предпросмотре выбирает его, выбранный блок подсвечен', async ({ page }) => {
  const ed = editor(page)
  await ed.open()
  const sections = ed.preview.locator('main > section')
  const outline = (index: number) =>
    sections
      .nth(index)
      .evaluate((el) => el.ownerDocument.defaultView?.getComputedStyle(el).outlineStyle)
  await expect.poll(() => outline(0)).toBe('solid')

  await ed.preview.getByText(demo.ctaTitle).click()
  await expect(ed.inspector.getByRole('heading', { name: 'Призыв к действию' })).toBeVisible()
  await expect(
    ed.block('Призыв к действию').getByRole('button', { name: /^Призыв к действию/ }),
  ).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => outline(2)).toBe('solid')
  await expect.poll(() => outline(0)).not.toBe('solid')

  // Выбор в списке подсвечивает блок в предпросмотре
  await ed.selectBlock('Преимущества')
  await expect.poll(() => outline(1)).toBe('solid')
  // А на сайте ничего этого нет: подсветка и выбор живут только в предпросмотре админки
  const site = await openSite(page)
  expect(await site.content()).not.toContain('averra-selection')
  const siteSection = site.locator('main > section').first()
  expect(
    await siteSection.evaluate((el) => el.ownerDocument.defaultView?.getComputedStyle(el).cursor),
  ).not.toBe('pointer')
})

test('переключатель ширины меняет ширину рамки предпросмотра', async ({ page }) => {
  const ed = editor(page)
  await ed.open()
  const width = () =>
    ed.previewFrame.evaluate(
      (frame) => frame.ownerDocument.defaultView?.getComputedStyle(frame).width,
    )

  await expect(ed.device('Десктоп')).toBeChecked()
  await expect.poll(width).toBe('1280px')
  await ed.device('Телефон').check()
  await expect.poll(width).toBe('375px')
  // С клавиатуры: стрелка в группе радиокнопок
  await page.keyboard.press('ArrowRight')
  await expect(ed.device('Планшет')).toBeChecked()
  await expect.poll(width).toBe('768px')
})
