import { hero } from '@averra/schema'
import { urls } from '../urls'
import { answerDialogs, demo, editor, expect, openSite, siteScreen, sites, test } from './fixtures'

const uuid = '[0-9a-f-]{36}'
const published = 'Опубликовано. Обнови сайт, чтобы увидеть'

/** Своё название на каждый тест: сайты в базе e2e копятся, а искать надо именно свой */
const uniqueName = (prefix: string) => `${prefix} ${Date.now().toString(36)}`

test('по экранам: сайты → сайт → редактор и назад по хлебным крошкам, F5 не теряет место', async ({
  page,
  demoSite,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сайты')
  // У каждого экрана свой заголовок вкладки: их различают история браузера и диктор
  await expect(page).toHaveTitle('Сайты — Averra CMS')

  await page.getByRole('link', { name: demoSite.name }).click()
  const screen = siteScreen(page)
  await expect(page).toHaveURL(`/sites/${demoSite.id}`)
  await expect(screen.heading).toHaveText(demoSite.name)
  await expect(page).toHaveTitle(`${demoSite.name} — страницы — Averra CMS`)
  await expect(screen.pages.getByRole('row')).toHaveCount(2) // заголовки и главная
  await expect(screen.row(demo.pageTitle)).toContainText('/')
  await expect(screen.row(demo.pageTitle)).toContainText('Опубликована')

  await page.reload()
  await expect(screen.heading).toHaveText(demoSite.name)

  await screen.row(demo.pageTitle).getByRole('link', { name: demo.pageTitle }).click()
  const ed = editor(page)
  await expect(page).toHaveURL(`/sites/${demoSite.id}/pages/index`)
  await expect(ed.pageTitle).toHaveValue(demo.pageTitle)
  await expect(page).toHaveTitle(`${demo.pageTitle} — редактор — Averra CMS`)

  await page.reload()
  await expect(ed.pageTitle).toHaveValue(demo.pageTitle)
  await expect(ed.blocks).toHaveCount(3)

  // Крошки: где я сейчас и ссылки назад
  const crumbs = page.getByRole('navigation', { name: 'Навигация по разделам' })
  await expect(crumbs.getByRole('link')).toHaveText(['Сайты', demoSite.name])
  await crumbs.getByRole('link', { name: demoSite.name }).click()
  await expect(page).toHaveURL(`/sites/${demoSite.id}`)
  await expect(screen.heading).toHaveText(demoSite.name)

  await screen.breadcrumbs.getByRole('link', { name: 'Сайты' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сайты')
})

test('новый сайт → страница с первым экраном → правка → публикация', async ({ page }) => {
  const name = uniqueName('Студия йоги')
  await page.goto('/')
  const newSite = page.getByRole('form', { name: 'Новый сайт' })
  await newSite.getByLabel('Название').fill(name)
  await newSite.getByRole('button', { name: 'Создать сайт' }).click()

  // Сайт сразу открыт, у него одна главная, и она ещё не опубликована
  const screen = siteScreen(page)
  await expect(page).toHaveURL(new RegExp(`/sites/${uuid}$`))
  await expect(screen.heading).toHaveText(name)
  const siteId = page.url().split('/').at(-1) ?? ''
  await expect(screen.pages.getByRole('row')).toHaveCount(2)
  await expect(screen.row('/')).toContainText(name)
  await expect(screen.row('/')).toContainText('Не опубликована')
  await expect(screen.row('/').getByRole('button', { name: /Удалить/ })).toHaveCount(0)

  await screen.newPage.title.fill('Услуги')
  await screen.newPage.slug.fill('uslugi')
  await expect(screen.newPage.template('С первым экраном')).toBeChecked()
  await screen.newPage.submit.click()

  // После создания открыт редактор новой страницы с примером первого экрана
  const ed = editor(page)
  await expect(page).toHaveURL(`/sites/${siteId}/pages/uslugi`)
  await expect(ed.pageTitle).toHaveValue('Услуги')
  await expect(ed.blocks).toHaveCount(1)
  await expect(ed.field('Заголовок')).toHaveValue(hero.example.title)

  await ed.field('Заголовок').fill('Йога для начинающих')
  await ed.publishButton.click()
  await expect(ed.status).toHaveText(published)

  await page
    .getByRole('navigation', { name: 'Навигация по разделам' })
    .getByRole('link', {
      name: name,
    })
    .click()
  await expect(screen.row('/uslugi')).toContainText('Услуги')
  await expect(screen.row('/uslugi')).toContainText('Опубликована')
  await expect(screen.row('/uslugi').locator('time')).toHaveAttribute('datetime', /^2\d{3}-/)
  await expect(screen.row('/uslugi')).not.toContainText('неопубликованные')
  // Главную не трогали — она по-прежнему черновик
  await expect(screen.row(name)).toContainText('Не опубликована')

  // Рендерер собирает один сайт (первый), поэтому новый сайт проверяем по снимку в API —
  // это ровно то, из чего рендерер собирает страницы
  const snapshot = await sites[':siteId'].snapshot.$get({ param: { siteId } })
  expect(snapshot.status).toBe(200)
  if (snapshot.status !== 200) return
  const { pages } = await snapshot.json()
  expect(pages.map((p) => p.slug)).toEqual(['uslugi'])
  expect(pages[0]?.title).toBe('Услуги')
  expect(pages[0]?.content.blocks[0]).toMatchObject({ props: { title: 'Йога для начинающих' } })

  // Новый сайт виден в списке сайтов
  await page
    .getByRole('navigation', { name: 'Навигация по разделам' })
    .getByRole('link', {
      name: 'Сайты',
    })
    .click()
  await expect(page.getByRole('link', { name })).toBeVisible()
})

test('новая страница после публикации открывается в рендерере по своему адресу', async ({
  page,
  demoSite,
}) => {
  await page.goto(`/sites/${demoSite.id}`)
  const screen = siteScreen(page)
  await screen.newPage.title.fill('Акция октября')
  await screen.newPage.slug.fill('akciya')
  await screen.newPage.submit.click()

  const ed = editor(page)
  await expect(ed.pageTitle).toHaveValue('Акция октября')
  await ed.field('Заголовок').fill('Скидка 20% на ремонт ванной')
  await ed.saveButton.click()
  await expect(ed.status).toHaveText('Черновик сохранён')

  // Черновик на сайт не попадает: страницы там ещё нет
  const before = await page.request.get(`${urls.renderer}/akciya`)
  expect(before.status()).toBe(404)

  await ed.publishButton.click()
  await expect(ed.status).toHaveText(published)

  const site = await openSite(page, '/akciya')
  await expect(site).toHaveTitle('Акция октября')
  await expect(site.getByRole('heading', { level: 1 })).toHaveText('Скидка 20% на ремонт ванной')
  // Главная на месте
  await site.goto(urls.renderer)
  await expect(site.getByRole('heading', { level: 1 })).toHaveText(demo.heroTitle)
})

test('пустая страница создаётся без блоков', async ({ page, demoSite }) => {
  await page.goto(`/sites/${demoSite.id}`)
  const screen = siteScreen(page)
  await screen.newPage.title.fill('Контакты')
  await screen.newPage.slug.fill('kontakty')
  await screen.newPage.template('Пустая').check()
  await screen.newPage.submit.click()

  const ed = editor(page)
  await expect(ed.pageTitle).toHaveValue('Контакты')
  await expect(ed.blocks).toHaveCount(0)
})

test('форма новой страницы объясняет, что не так с адресом', async ({ page, demoSite }) => {
  await page.goto(`/sites/${demoSite.id}`)
  const screen = siteScreen(page)
  const { title, slug, submit } = screen.newPage

  // Пустая форма: ошибки у обоих полей, фокус на первом, запрос не уходит
  await submit.click()
  await expect(title).toHaveAccessibleDescription(/Поле не может быть пустым/)
  await expect(slug).toHaveAccessibleDescription(/Поле не может быть пустым/)
  await expect(title).toBeFocused()
  await expect(page).toHaveURL(`/sites/${demoSite.id}`)

  await title.fill('О нас')
  await expect(title).not.toHaveAttribute('aria-invalid')
  await slug.fill('О нас')
  await expect(slug).toHaveAttribute('aria-invalid', 'true')
  await expect(slug).toHaveAccessibleDescription(/Только латиница в нижнем регистре/)
  await submit.click()
  await expect(slug).toBeFocused()
  await expect(screen.pages.getByRole('row')).toHaveCount(2)

  // Правильный по форме, но занятый адрес: ответ API встаёт под полем
  await slug.fill('index')
  await expect(slug).not.toHaveAttribute('aria-invalid')
  await submit.click()
  await expect(slug).toHaveAccessibleDescription(/Такой адрес уже есть/)
  await expect(slug).toBeFocused()
  await expect(page).toHaveURL(`/sites/${demoSite.id}`)

  // Поправил адрес — ошибка от API ушла, страница создаётся
  await slug.fill('o-nas')
  await expect(slug).not.toHaveAccessibleDescription(/Такой адрес уже есть/)
  await submit.click()
  await expect(page).toHaveURL(`/sites/${demoSite.id}/pages/o-nas`)
})

test('форма нового сайта не принимает пустое название', async ({ page }) => {
  await page.goto('/')
  const form = page.getByRole('form', { name: 'Новый сайт' })
  const name = form.getByLabel('Название')
  await name.fill('   ')
  await form.getByRole('button', { name: 'Создать сайт' }).click()
  await expect(name).toHaveAccessibleDescription(/Поле не может быть пустым/)
  await expect(name).toBeFocused()
  await expect(page).toHaveURL('/')
})

test('страница удаляется только после подтверждения, главную удалить нельзя', async ({
  page,
  demoSite,
}) => {
  // Опубликованная страница: после удаления она должна пропасть и с сайта
  const param = { siteId: demoSite.id, slug: 'staraya-akciya' }
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug: param.slug, title: 'Старая акция', template: 'hero' },
  })
  expect(created.status).toBe(201)
  expect((await sites[':siteId'].pages[':slug'].publish.$post({ param })).status).toBe(200)
  expect((await page.request.get(`${urls.renderer}/staraya-akciya`)).status()).toBe(200)

  await page.goto(`/sites/${demoSite.id}`)
  const screen = siteScreen(page)
  await expect(screen.row(demo.pageTitle).getByRole('button')).toHaveCount(0)
  const remove = screen.row('Старая акция').getByRole('button', {
    name: 'Удалить страницу «Старая акция»',
  })

  const dialogs = answerDialogs(page, [false, true])
  await remove.click()
  await expect.poll(() => dialogs.length).toBe(1)
  expect(dialogs[0]).toContain('Старая акция')
  expect(dialogs[0]).toContain('/staraya-akciya')
  await expect(screen.row('Старая акция')).toBeVisible()

  await remove.click()
  await expect(screen.row('Старая акция')).toHaveCount(0)
  expect(dialogs).toHaveLength(2)
  await expect(page.getByRole('status')).toHaveText('Страница «Старая акция» удалена')
  // Кнопки «Удалить» больше нет — фокус на заголовке списка, а не в никуда
  await expect(page.getByRole('heading', { level: 2, name: 'Страницы' })).toBeFocused()

  await page.reload()
  await expect(screen.row(demo.pageTitle)).toBeVisible()
  await expect(screen.row('Старая акция')).toHaveCount(0)
  expect((await page.request.get(`${urls.renderer}/staraya-akciya`)).status()).toBe(404)

  // Кнопки у главной нет, а API на попытку в обход админки отвечает отказом
  const main = await sites[':siteId'].pages[':slug'].$delete({
    param: { siteId: demoSite.id, slug: 'index' },
  })
  expect(main.status).toBe(409)
  expect(await main.json()).toMatchObject({
    error: { code: 'conflict', message: 'Главную страницу удалить нельзя' },
  })
})

test('уход из редактора с несохранёнными правками спрашивает подтверждение', async ({
  page,
  demoSite,
}) => {
  const ed = editor(page)
  const backToSite = page
    .getByRole('navigation', { name: 'Навигация по разделам' })
    .getByRole('link', { name: demoSite.name })
  const dialogs = answerDialogs(page, [false, true, false, true])

  // Без правок уходим без вопросов
  await ed.open()
  await backToSite.click()
  await expect(page).toHaveURL(`/sites/${demoSite.id}`)
  expect(dialogs).toHaveLength(0)

  // С правками: «Отмена» оставляет в редакторе вместе с правкой
  await ed.open()
  await ed.field('Заголовок').fill('Несохранённая правка')
  await backToSite.click()
  await expect.poll(() => dialogs.length).toBe(1)
  expect(dialogs[0]).toContain('несохранённые изменения')
  await expect(page).toHaveURL(`/sites/${demoSite.id}/pages/index`)
  await expect(ed.field('Заголовок')).toHaveValue('Несохранённая правка')

  // «ОК» уводит, правка не сохранилась
  await backToSite.click()
  await expect(page).toHaveURL(`/sites/${demoSite.id}`)
  expect(dialogs).toHaveLength(2)
  await expect(siteScreen(page).row(demo.pageTitle)).toContainText('Опубликована')
  await expect(siteScreen(page).row(demo.pageTitle)).not.toContainText('неопубликованные')

  // Кнопка «Назад» браузера тоже спрашивает
  await siteScreen(page).row(demo.pageTitle).getByRole('link').click()
  await expect(ed.pageTitle).toHaveValue(demo.pageTitle)
  await ed.field('Заголовок').fill('Ещё одна правка')
  // Не page.goBack(): он ждёт, пока сменится адрес, а отменённый переход его не меняет
  await page.evaluate('history.back()')
  await expect.poll(() => dialogs.length).toBe(3)
  await expect(page).toHaveURL(`/sites/${demoSite.id}/pages/index`)
  await expect(ed.field('Заголовок')).toHaveValue('Ещё одна правка')
  await page.evaluate('history.back()')
  await expect(page).toHaveURL(`/sites/${demoSite.id}`)
  expect(dialogs).toHaveLength(4)

  // После сохранения уходим без вопроса
  await ed.open()
  await ed.field('Заголовок').fill('Сохранённая правка')
  await ed.saveButton.click()
  await expect(ed.status).toHaveText('Черновик сохранён')
  await backToSite.click()
  await expect(page).toHaveURL(`/sites/${demoSite.id}`)
  expect(dialogs).toHaveLength(4)
  await expect(siteScreen(page).row(demo.pageTitle)).toContainText(
    'Есть неопубликованные изменения',
  )
})

test('несуществующий сайт, страница или адрес админки — понятный экран и путь назад', async ({
  page,
  demoSite,
}) => {
  await page.goto('/sites/00000000-0000-4000-8000-000000000000')
  await expect(page.getByRole('alert')).toHaveText('Сайт не найден')
  await page.getByRole('link', { name: 'К списку сайтов' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сайты')

  await page.goto(`/sites/${demoSite.id}/pages/net-takoy`)
  await expect(page.getByRole('alert')).toHaveText('Страница не найдена')

  await page.goto('/kakoy-to/adres')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Такой страницы в админке нет')
  await expect(page.getByRole('link', { name: 'К списку сайтов' })).toBeVisible()

  // Кривой id сайта или адрес страницы в ссылке — тоже «не найдено», а не «данные не прошли проверку»
  await page.goto('/sites/not-a-uuid')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сайт не найден')
  await expect(page).toHaveTitle('Сайт не найден — Averra CMS')
  await page.goto(`/sites/${demoSite.id}/pages/O_NAS`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Страница не найдена')
  await page.goto('/sites/not-a-uuid/media')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сайт не найден')
})

test('форма и сообщения одного сайта не переезжают на другой по «Назад»', async ({
  page,
  demoSite,
}) => {
  const other = await sites.$post({ json: { name: uniqueName('Второй сайт') } })
  if (other.status !== 201) throw new Error(`Второй сайт: ${other.status}`)
  const { id: otherId } = await other.json()
  const screen = siteScreen(page)

  await page.goto(`/sites/${demoSite.id}`)
  await page.goto(`/sites/${otherId}`)
  await screen.newPage.title.fill('Набрано на втором сайте')
  await page.goBack()
  await expect(page).toHaveURL(`/sites/${demoSite.id}`)
  await expect(screen.heading).toHaveText(demoSite.name)
  await expect(screen.newPage.title).toHaveValue('')
})

test('длинный заголовок и адрес без пробелов не растягивают экран', async ({ page, demoSite }) => {
  const slug = 'a'.repeat(64)
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug, title: 'Б'.repeat(120) },
  })
  expect(created.status).toBe(201)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/sites/${demoSite.id}`)
  const screen = siteScreen(page)
  await expect(screen.row(slug)).toBeVisible()

  // Страница не прокручивается вбок, кнопка «Удалить» видна в окне
  const overflow = await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )
  expect(Number(overflow)).toBeLessThanOrEqual(0)
  const remove = screen.row(slug).getByRole('button', { name: /^Удалить страницу/ })
  const box = await remove.boundingBox()
  if (!box) throw new Error('Кнопки «Удалить» не видно')
  expect(box.x + box.width).toBeLessThanOrEqual(1280)
})
