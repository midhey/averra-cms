import { e2eOwner } from '../urls'
import { answerDialogs, editor, expect, historyPanel, openSite, sites, test } from './fixtures'

// История публикаций в редакторе. Каждый тест работает на своей странице демо-сайта:
// главную демо-сайта публикует фикстура перед каждым тестом, и её история всё время растёт

const slug = 'istoriya'
const published = 'Опубликовано. Обнови сайт, чтобы увидеть'
const restored = 'Версия 1 возвращена в черновик. На сайт она попадёт после публикации'

const version = (n: 1 | 2) => ({ pageTitle: `Страница, версия ${n}`, hero: `Первый экран ${n}` })

async function createPage(siteId: string) {
  const res = await sites[':siteId'].pages.$post({
    param: { siteId },
    json: { slug, title: 'История', template: 'hero' },
  })
  expect(res.status, 'создание страницы для теста').toBe(201)
}

/** Две публикации через API — для тестов, которым важна не публикация, а история после неё */
async function publishTwiceViaApi(siteId: string) {
  const page = sites[':siteId'].pages[':slug']
  const param = { siteId, slug }
  for (const n of [1, 2] as const) {
    const { pageTitle, hero } = version(n)
    const content = { blocks: [{ id: 'hero', type: 'hero' as const, props: { title: hero } }] }
    expect((await page.$put({ param, json: { title: pageTitle, content } })).status).toBe(200)
    expect((await page.publish.$post({ param })).status).toBe(200)
  }
}

test('две публикации → две версии → первая в черновик, на сайте вторая', async ({
  page,
  demoSite,
}) => {
  await createPage(demoSite.id)
  const dialogs = answerDialogs(page, [])
  const ed = editor(page)
  const history = historyPanel(page)
  await ed.open(slug)

  for (const n of [1, 2] as const) {
    await ed.pageTitle.fill(version(n).pageTitle)
    await ed.field('Заголовок').fill(version(n).hero)
    await ed.publishButton.click()
    await expect(ed.status).toHaveText(published)
  }

  await history.toggle.click()
  await expect(history.toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(history.versions).toHaveCount(2)
  await expect(history.versions.first()).toContainText('Версия 2')
  await expect(history.versions.first()).toContainText('сейчас на сайте')
  await expect(history.versions.first()).toContainText(version(2).pageTitle)
  await expect(history.versions.first()).toContainText(e2eOwner.name)
  await expect(history.versions.last()).toContainText(version(1).pageTitle)
  // Поля блока на месте панели истории не видны
  await expect(ed.inspector).toBeHidden()

  // Выбор версии меняет только предпросмотр
  await history.version(1).click()
  await expect(history.version(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText(version(1).hero)
  await expect(page.getByText(/^Версия 1 от .* так страница выглядела на сайте/)).toBeVisible()
  await expect(ed.pageTitle).toHaveValue(version(2).pageTitle)
  await expect(ed.status).toHaveText(published)

  // «Показать черновик» возвращает предпросмотр к черновику
  await history.showDraftButton.click()
  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText(version(2).hero)
  await history.version(1).click()
  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText(version(1).hero)

  // Несохранённых правок нет — вопроса тоже нет
  await history.restoreButton.click()
  await expect(ed.status).toHaveText(restored)
  expect(dialogs).toEqual([])
  await expect(ed.pageTitle).toHaveValue(version(1).pageTitle)
  await expect(ed.saveButton).toBeDisabled()
  await expect(history.version(1)).toHaveAttribute('aria-pressed', 'false')
  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText(version(1).hero)
  // Возврат — не публикация: версий по-прежнему две
  await expect(history.versions).toHaveCount(2)

  // Выбор блока закрывает историю и показывает поля возвращённой версии
  await ed.selectBlock('Первый экран')
  await expect(history.panel).toBeHidden()
  await expect(ed.field('Заголовок')).toHaveValue(version(1).hero)

  // Черновик возвращён в базе, а не только на экране
  await page.reload()
  await expect(ed.pageTitle).toHaveValue(version(1).pageTitle)
  await expect(ed.field('Заголовок')).toHaveValue(version(1).hero)
  await expect(ed.status).toHaveText('Сохранено · правки не опубликованы')

  // А на сайте — вторая
  const site = await openSite(page, `/${slug}`)
  await expect(site).toHaveTitle(version(2).pageTitle)
  await expect(site.getByRole('heading', { level: 1 })).toHaveText(version(2).hero)
})

test('с несохранёнными правками возврат спрашивает: «Отмена» оставляет правку', async ({
  page,
  demoSite,
}) => {
  await createPage(demoSite.id)
  await publishTwiceViaApi(demoSite.id)
  const dialogs = answerDialogs(page, [false, true])
  const ed = editor(page)
  const history = historyPanel(page)
  await ed.open(slug)

  await ed.pageTitle.fill('Несохранённое название')
  await history.toggle.click()
  await history.version(1).click()

  await history.restoreButton.click()
  expect(dialogs).toHaveLength(1)
  expect(dialogs[0]).toContain('несохранённые правки')
  expect(dialogs[0]).toContain('версией 1')
  await expect(ed.pageTitle).toHaveValue('Несохранённое название')
  await expect(ed.status).toHaveText('Есть несохранённые правки')

  await history.restoreButton.click()
  await expect(ed.status).toHaveText(restored)
  expect(dialogs).toHaveLength(2)
  await expect(ed.pageTitle).toHaveValue(version(1).pageTitle)
  await expect(ed.saveButton).toBeDisabled()
})

test('история и возврат работают с клавиатуры', async ({ page, demoSite }) => {
  await createPage(demoSite.id)
  await publishTwiceViaApi(demoSite.id)
  const ed = editor(page)
  const history = historyPanel(page)
  await ed.open(slug)

  await history.toggle.focus()
  await page.keyboard.press('Enter')
  await expect(history.panel).toBeVisible()

  await history.version(2).focus()
  await page.keyboard.press('Tab')
  await expect(history.version(1)).toBeFocused()
  await page.keyboard.press('Space')
  await expect(history.version(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText(version(1).hero)

  // «Показать черновик» пропадает вместе с выбором: фокус возвращается на версию, а не в никуда
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(history.showDraftButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(history.version(1)).toHaveAttribute('aria-pressed', 'false')
  await expect(history.version(1)).toBeFocused()
  await page.keyboard.press('Space')

  await page.keyboard.press('Tab')
  await expect(history.restoreButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(ed.status).toHaveText(restored)
  await expect(ed.pageTitle).toHaveValue(version(1).pageTitle)
  // Кнопка возврата пропала — фокус на той же версии, следующий Tab идёт дальше по панели
  await expect(history.version(1)).toBeFocused()

  // Повторное нажатие «История» закрывает панель
  await history.toggle.focus()
  await page.keyboard.press('Enter')
  await expect(history.panel).toBeHidden()
  await expect(history.toggle).toHaveAttribute('aria-expanded', 'false')
})

test('правка блоков при открытой истории возвращает предпросмотр к черновику', async ({
  page,
  demoSite,
}) => {
  await createPage(demoSite.id)
  await publishTwiceViaApi(demoSite.id)
  answerDialogs(page, [true])
  const ed = editor(page)
  const history = historyPanel(page)
  await ed.open(slug)

  await history.toggle.click()
  await history.version(1).click()
  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveText(version(1).hero)
  const note = page.getByText(/так страница выглядела на сайте/)
  await expect(note).toBeVisible()

  await ed.block('Первый экран').getByRole('button', { name: 'Удалить блок' }).click()
  await expect(ed.blocks).toHaveCount(0)
  // Черновик изменился: подписи «Черновик не изменился» и старой версии больше нет
  await expect(note).toBeHidden()
  await expect(ed.preview.getByRole('heading', { level: 1 })).toHaveCount(0)
  await expect(history.version(1)).toHaveAttribute('aria-pressed', 'false')
})
