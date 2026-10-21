import { hero } from '@averra/schema'
import { urls } from '../urls'
import {
  answerDialogs,
  demo,
  editor,
  expect,
  openSite,
  sidebar,
  siteScreen,
  sites,
  test,
} from './fixtures'

const published = 'Опубликовано. Обнови сайт, чтобы увидеть'

test('после входа — сразу обзор сайта: выбирать нечего; редактор и назад, F5 не теряет место', async ({
  page,
  demoSite,
}) => {
  await page.goto('/')
  const screen = siteScreen(page)
  // Одна установка — один сайт: первый экран админки — обзор его, без списка и выбора сайта
  await expect(screen.heading).toHaveText(demoSite.name)
  // У каждого экрана свой заголовок вкладки: их различают история браузера и диктор
  await expect(page).toHaveTitle(`${demoSite.name} — обзор — Averra CMS`)
  await expect(page.getByRole('link', { name: 'Все сайты' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /выбрать другой сайт/ })).toHaveCount(0)
  await expect(page.getByRole('form', { name: 'Новый сайт' })).toHaveCount(0)
  // Заголовок панели — название сайта и домен, домен — ссылка на опубликованный сайт
  const panel = sidebar(page)
  await expect(panel.siteLink.locator('xpath=..')).toContainText(demoSite.name)
  await expect(panel.siteLink).toHaveAttribute('href', urls.renderer)
  await expect(panel.siteLink).toHaveAttribute('target', '_blank')
  await expect(screen.pages.getByRole('row')).toHaveCount(2) // заголовки и главная
  await expect(screen.row(demo.pageTitle)).toContainText('/')
  await expect(screen.row(demo.pageTitle)).toContainText('Опубликована')

  await page.reload()
  await expect(screen.heading).toHaveText(demoSite.name)

  await screen.row(demo.pageTitle).getByRole('link', { name: demo.pageTitle }).click()
  const ed = editor(page)
  await expect(page).toHaveURL('/pages/index')
  await expect(ed.pageTitle).toHaveValue(demo.pageTitle)
  await expect(page).toHaveTitle(`${demo.pageTitle} — редактор — Averra CMS`)

  await page.reload()
  await expect(ed.pageTitle).toHaveValue(demo.pageTitle)
  await expect(ed.blocks).toHaveCount(3)

  // Полоса редактора: какой это сайт и ссылка назад, на его обзор
  await expect(page.getByRole('region', { name: 'Страница' })).toContainText(demoSite.name)
  await ed.backToSite.click()
  await expect(page).toHaveURL('/')
  await expect(screen.heading).toHaveText(demoSite.name)
})

test('новая страница с первым экраном → правка → публикация → на сайте', async ({ page }) => {
  await page.goto('/')
  const screen = siteScreen(page)

  // Страницы создают и удаляют на экране «Страницы»: туда ведёт и панель, и кнопка обзора
  await page.getByRole('link', { name: 'Новая страница' }).click()
  await expect(page).toHaveURL('/pages#new-page')
  await expect(screen.newPage.title).toBeFocused()
  await expect(screen.row('/').getByRole('button', { name: /Удалить/ })).toHaveCount(0)

  await screen.newPage.title.fill('Услуги')
  await screen.newPage.slug.fill('uslugi')
  await expect(screen.newPage.template('С первым экраном')).toBeChecked()
  await screen.newPage.submit.click()

  // После создания открыт редактор новой страницы с примером первого экрана
  const ed = editor(page)
  await expect(page).toHaveURL('/pages/uslugi')
  await expect(ed.pageTitle).toHaveValue('Услуги')
  await expect(ed.blocks).toHaveCount(1)
  await expect(ed.field('Заголовок')).toHaveValue(hero.example.title)

  await ed.field('Заголовок').fill('Йога для начинающих')
  await ed.publishButton.click()
  await expect(ed.status).toHaveText(published)

  await ed.backToSite.click()
  await expect(screen.row('/uslugi')).toContainText('Услуги')
  await expect(screen.row('/uslugi')).toContainText('Опубликована')
  // Когда опубликована — в подсказке плашки и скрытым текстом (колонки «Опубликована» нет)
  const state = screen.row('/uslugi').getByRole('cell').filter({ hasText: 'Опубликована' })
  await expect(state.locator('[title^="Опубликована "]')).toBeVisible()
  await expect(state.locator('time')).toHaveAttribute('datetime', /^2\d{3}-/)
  await expect(state).toContainText(/, опубликована \d/)
  await expect(screen.row('/uslugi')).not.toContainText('Есть правки')
  // Главную не трогали — она опубликована и без правок
  await expect(screen.row(demo.pageTitle)).not.toContainText('Есть правки')

  // Рендерер показывает сайт установки — новая страница там по своему адресу
  const site = await openSite(page, '/uslugi')
  await expect(site).toHaveTitle('Услуги')
  await expect(site.getByRole('heading', { level: 1 })).toHaveText('Йога для начинающих')
})

test('новая страница после публикации открывается в рендерере по своему адресу', async ({
  page,
}) => {
  await page.goto('/pages')
  const screen = siteScreen(page)
  await screen.newPage.title.fill('Акция октября')
  await screen.newPage.slug.fill('akciya')
  await screen.newPage.submit.click()

  const ed = editor(page)
  await expect(ed.pageTitle).toHaveValue('Акция октября')
  await ed.field('Заголовок').fill('Скидка 20% на ремонт ванной')
  await ed.saveButton.click()
  await expect(ed.status).toHaveText('Черновик сохранён · не опубликован')

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

test('пустая страница создаётся без блоков', async ({ page }) => {
  await page.goto('/pages')
  const screen = siteScreen(page)
  await screen.newPage.title.fill('Контакты')
  await screen.newPage.slug.fill('kontakty')
  await screen.newPage.template('Пустая').check()
  await screen.newPage.submit.click()

  const ed = editor(page)
  await expect(ed.pageTitle).toHaveValue('Контакты')
  await expect(ed.blocks).toHaveCount(0)
})

test('форма новой страницы объясняет, что не так с адресом', async ({ page }) => {
  await page.goto('/pages')
  const screen = siteScreen(page)
  const { title, slug, submit } = screen.newPage

  // Пустая форма: ошибки у обоих полей, фокус на первом, запрос не уходит
  await submit.click()
  await expect(title).toHaveAccessibleDescription(/Поле не может быть пустым/)
  await expect(slug).toHaveAccessibleDescription(/Поле не может быть пустым/)
  await expect(title).toBeFocused()
  await expect(page).toHaveURL('/pages')

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
  await expect(page).toHaveURL('/pages')

  // Поправил адрес — ошибка от API ушла, страница создаётся
  await slug.fill('o-nas')
  await expect(slug).not.toHaveAccessibleDescription(/Такой адрес уже есть/)
  await submit.click()
  await expect(page).toHaveURL('/pages/o-nas')
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

  await page.goto('/pages')
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
  await expect(page.getByRole('region', { name: 'Все страницы' }).getByRole('status')).toHaveText(
    'Страница «Старая акция» удалена',
  )
  // Кнопки «Удалить» больше нет — фокус на заголовке списка, а не в никуда
  await expect(page.getByRole('heading', { level: 2, name: 'Все страницы' })).toBeFocused()

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

test('уход из редактора с несохранёнными правками спрашивает подтверждение', async ({ page }) => {
  const ed = editor(page)
  const { backToSite } = ed
  const dialogs = answerDialogs(page, [false, true, false, true])

  // Без правок уходим без вопросов
  await ed.open()
  await backToSite.click()
  await expect(page).toHaveURL('/')
  expect(dialogs).toHaveLength(0)

  // С правками: «Отмена» оставляет в редакторе вместе с правкой
  await ed.open()
  await ed.field('Заголовок').fill('Несохранённая правка')
  await backToSite.click()
  await expect.poll(() => dialogs.length).toBe(1)
  expect(dialogs[0]).toContain('несохранённые изменения')
  await expect(page).toHaveURL('/pages/index')
  await expect(ed.field('Заголовок')).toHaveValue('Несохранённая правка')

  // «ОК» уводит, правка не сохранилась
  await backToSite.click()
  await expect(page).toHaveURL('/')
  expect(dialogs).toHaveLength(2)
  await expect(siteScreen(page).row(demo.pageTitle)).toContainText('Опубликована')
  await expect(siteScreen(page).row(demo.pageTitle)).not.toContainText('Есть правки')

  // Кнопка «Назад» браузера тоже спрашивает
  await siteScreen(page).row(demo.pageTitle).getByRole('link').click()
  await expect(ed.pageTitle).toHaveValue(demo.pageTitle)
  await ed.field('Заголовок').fill('Ещё одна правка')
  // Не page.goBack(): он ждёт, пока сменится адрес, а отменённый переход его не меняет
  await page.evaluate('history.back()')
  await expect.poll(() => dialogs.length).toBe(3)
  await expect(page).toHaveURL('/pages/index')
  await expect(ed.field('Заголовок')).toHaveValue('Ещё одна правка')
  await page.evaluate('history.back()')
  await expect(page).toHaveURL('/')
  expect(dialogs).toHaveLength(4)

  // После сохранения уходим без вопроса
  await ed.open()
  await ed.field('Заголовок').fill('Сохранённая правка')
  await ed.saveButton.click()
  await expect(ed.status).toHaveText('Сохранено · правки не опубликованы')
  await backToSite.click()
  await expect(page).toHaveURL('/')
  expect(dialogs).toHaveLength(4)
  await expect(siteScreen(page).row(demo.pageTitle)).toContainText('Есть правки')
})

test('несуществующая страница или адрес админки — понятный экран и путь назад', async ({
  page,
}) => {
  await page.goto('/pages/net-takoy')
  await expect(page.getByRole('alert')).toHaveText('Страница не найдена')
  await page.getByRole('link', { name: 'К обзору сайта' }).click()
  await expect(page).toHaveURL('/')
  await expect(siteScreen(page).pages).toBeVisible()

  await page.goto('/kakoy-to/adres')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Такой страницы в админке нет')
  await expect(page.getByRole('link', { name: 'К обзору сайта' })).toBeVisible()

  // Кривой адрес страницы в ссылке — тоже «не найдено», а не «данные не прошли проверку»
  await page.goto('/pages/O_NAS')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Страница не найдена')
  await expect(page).toHaveTitle('Страница не найдена — Averra CMS')
})

test('старые адреса /sites/<id>/… ведут на те же экраны без id: закладки не ломаются', async ({
  page,
  demoSite,
}) => {
  // Адрес обзора, страниц и редактора — с id демо-сайта, как было до «один сайт — одна установка»
  await page.goto(`/sites/${demoSite.id}`)
  await expect(page).toHaveURL('/')
  await expect(siteScreen(page).heading).toHaveText(demoSite.name)

  await page.goto(`/sites/${demoSite.id}/pages/index`)
  await expect(page).toHaveURL('/pages/index')
  await expect(editor(page).pageTitle).toHaveValue(demo.pageTitle)

  // Поиск и якорь сохраняются: вкладка заявок и раздел настроек — те же
  await page.goto(`/sites/${demoSite.id}/leads?status=new`)
  await expect(page).toHaveURL('/leads?status=new')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Заявки')
  await page.goto(`/sites/${demoSite.id}/settings#leads`)
  await expect(page).toHaveURL('/settings#leads')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Настройки сайта')

  // id не важен: сайт у установки один, старая закладка на другой сайт ведёт сюда же
  await page.goto('/sites/00000000-0000-4000-8000-000000000000/media')
  await expect(page).toHaveURL('/media')
  await expect(page.getByRole('heading', { level: 1, name: 'Медиатека' })).toBeVisible()
  await page.goto('/sites')
  await expect(page).toHaveURL('/')
  // «Назад» не возвращает на старый адрес: перенаправление заменяет его в истории
  await page.goto('/pages')
  await page.goto(`/sites/${demoSite.id}/media`)
  await expect(page).toHaveURL('/media')
  await page.goBack()
  await expect(page).toHaveURL('/pages')
})

test('длинный заголовок и адрес без пробелов не растягивают экран', async ({ page, demoSite }) => {
  const slug = 'a'.repeat(64)
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug, title: 'Б'.repeat(120) },
  })
  expect(created.status).toBe(201)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/pages')
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
