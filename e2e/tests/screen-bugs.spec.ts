import { defaultTheme, MAIN_PAGE_SLUG } from '@averra/schema'
import type { Page } from '@playwright/test'
import { answerDialogs, editor, expect, mediaScreen, sidebar, sites, test } from './fixtures'
import { waitForMail } from './mailbox'

// Мелкие баги экранов админки (шаг 4.8): предпросмотр шапки со своими блоками, «Куда ведёт»,
// h1 в своём блоке, единое поведение несохранённого, отказ по роли, повторное приглашение,
// тема в редакторе и «где стоит картинка» в медиатеке. Каждый тест проверяет действием

const HERO_TITLE = 'Привет, я *Лера*'
const HERO_NAME = 'Привет, я Лера'

/**
 * Главная со своим первым экраном, который сам выводит h1 (как le-hero из набора le-english):
 * блок опубликован, его экземпляр стоит в черновике главной. Опубликованная главная остаётся
 * демо — так же, как после импорта набора без --publish
 */
async function ownHeroOnMain(siteId: string) {
  const blocks = sites[':siteId']['custom-blocks']
  const key = 'le-hero'
  const param = { siteId, key }
  expect(
    (await blocks.$post({ param: { siteId }, json: { key, title: 'Первый экран' } })).status,
  ).toBe(201)
  const saved = await blocks[':key'].$put({
    param,
    json: {
      key,
      title: 'Первый экран',
      description: 'Свой первый экран с заголовком h1',
      category: 'about',
      fields: [{ type: 'text', name: 'title', label: 'Заголовок', required: true }],
      template: '<section class="hero"><h1>{{ title | accent }}</h1></section>',
      css: '.hero { padding: 2rem }',
      example: { title: HERO_TITLE },
    },
  })
  expect(saved.status, 'сохранение своего блока').toBe(200)
  const view = await blocks[':key'].$get({ param })
  if (view.status !== 200) throw new Error(`Блок не прочитан: ${view.status}`)
  const { draft } = await view.json()
  if (!draft) throw new Error('У блока нет черновика')
  expect((await blocks[':key'].publish.$post({ param, json: { draft } })).status).toBe(200)

  const page = await sites[':siteId'].pages[':slug'].$put({
    param: { siteId, slug: MAIN_PAGE_SLUG },
    json: {
      title: 'Главная Леры',
      content: {
        blocks: [{ id: 'le-top', type: 'custom:le-hero', props: { title: HERO_TITLE } }],
      },
    },
  })
  expect(page.status, 'черновик главной со своим блоком').toBe(200)
}

test('«Шапка и подвал»: предпросмотр показывает свои блоки, «Куда ведёт» — только блоки черновика без звёздочек', async ({
  page,
  demoSite,
}) => {
  await ownHeroOnMain(demoSite.id)
  await page.goto('/header')
  await expect(page.getByRole('heading', { level: 1, name: 'Шапка и подвал' })).toBeVisible()

  // Предпросмотр: свой блок нарисован (его h1 виден), а не «Своего блока … нет на сайте»
  const preview = page.frameLocator('iframe[title="Предпросмотр шапки"]')
  await expect(preview.getByRole('heading', { level: 1, name: HERO_NAME })).toBeVisible()
  await expect(preview.locator('body')).not.toContainText('Своего блока')

  // «Куда ведёт»: блок черновика с подписью без *звёздочек*; блоков опубликованной демо-главной
  // («Почему выбирают нас» и других) в списке нет
  await page.getByRole('tab', { name: 'Меню' }).click()
  await page.getByRole('button', { name: 'Пункт меню', exact: true }).click()
  const item = page.getByRole('list', { name: 'Пункты меню' }).getByRole('listitem').first()
  const options = await item
    .getByRole('combobox', { name: 'Куда ведёт' })
    .locator('option')
    .allTextContents()
  expect(options).toContain(`${HERO_NAME} · #le-top`)
  expect(options.filter((text) => text.includes('*'))).toEqual([])
  expect(options.join('\n')).not.toContain('Почему выбирают нас')
  expect(options.join('\n')).not.toContain('#benefits')
})

test('SEO страницы: h1 из своего блока считается, «нет h1» не показывается', async ({
  page,
  demoSite,
}) => {
  await ownHeroOnMain(demoSite.id)
  await editor(page).open()
  await page.getByRole('button', { name: /^SEO/ }).click()
  const checks = page
    .getByRole('complementary', { name: 'SEO страницы' })
    .getByRole('region', { name: 'Проверки' })
  await expect(checks).toContainText(`Главный заголовок (h1) один: «${HERO_NAME}»`)
  await expect(checks).not.toContainText('нет главного заголовка')
})

test('«Заявки»: правка → уход спрашивает; «Сохранить» выключена без правок и включается с ними', async ({
  page,
  demoSite,
}) => {
  const settings = sites[':siteId'].leads.settings
  const before = await settings.$get({ param: { siteId: demoSite.id } })
  if (before.status !== 200) throw new Error(`Настройки заявок: ${before.status}`)
  const original = await before.json()

  try {
    const dialogs = answerDialogs(page, [false, true])
    await page.goto('/settings')
    const form = page.getByRole('form', { name: 'Настройки заявок' })
    const save = form.getByRole('button', { name: 'Сохранить настройки' })
    const days = form.getByLabel('Хранить заявки, дней')
    await expect(save).toHaveAttribute('aria-disabled', 'true')

    await days.fill('90')
    await expect(save).not.toHaveAttribute('aria-disabled', 'true')
    // «Отмена» — остаёмся с правкой, «ОК» — уходим
    await sidebar(page).section('Обзор').click()
    await expect(page).toHaveURL('/settings')
    await expect(days).toHaveValue('90')
    await expect
      .poll(() => dialogs)
      .toEqual(['Уйти без сохранения? На странице есть несохранённые правки. Они пропадут.'])

    await save.click()
    await expect(form.getByText('Настройки заявок сохранены')).toBeVisible()
    await expect(save).toHaveAttribute('aria-disabled', 'true')
    // Сохранённое — не повод спрашивать: уходим без вопроса
    await sidebar(page).section('Обзор').click()
    await expect(page).toHaveURL('/')
    expect(dialogs).toHaveLength(1)
  } finally {
    await settings.$put({ param: { siteId: demoSite.id }, json: original })
  }
})

test('раздел закрыт для роли: «Нет доступа к разделу» с причиной, а не «Не получилось открыть»', async ({
  page,
}) => {
  await page.route(/\/api\/sites\/[^/]+\/notifications$/, (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: {
          code: 'forbidden',
          message: 'Получателей заявок настраивают владелец и администратор сайта',
        },
      },
    }),
  )
  await page.goto('/notifications')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Нет доступа к разделу «Уведомления»' }),
  ).toBeVisible()
  await expect(
    page.getByText('Уведомления настраивают владелец и администратор сайта'),
  ).toBeVisible()
  await expect(page.getByText('Не получилось открыть')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'К обзору сайта' })).toBeVisible()
})

async function invite(page: Page, email: string, role: 'Администратор сайта' | 'Редактор') {
  const form = page.getByRole('form', { name: 'Пригласить участника' })
  await form.getByLabel('Почта').fill(email)
  await form.getByRole('radio', { name: new RegExp(`^${role}`) }).check()
  return form
}

test('повторное приглашение предупреждает, что заменит прежнее вместе с ролью', async ({
  page,
  demoSite,
}) => {
  const email = `repeat-${Date.now()}@example.test`
  await page.goto('/settings')
  const members = page.getByRole('region', { name: 'Участники' })

  // Первое приглашение — редактором; предупреждения нет
  const form = await invite(page, email, 'Редактор')
  await expect(form.getByText(/уже отправлено/)).toHaveCount(0)
  await form.getByRole('button', { name: 'Пригласить' }).click()
  await expect(members.getByRole('status').filter({ hasText: email })).toHaveText(
    `Приглашение отправлено на ${email}`,
  )
  await waitForMail(email, `Приглашение на сайт «${demoSite.name}» в Averra CMS`)
  // Роль после отправки вернулась к умолчанию, а не «залипла» на «Редактор»
  await expect(form.getByRole('radio', { name: /^Администратор сайта/ })).toBeChecked()

  // Тот же адрес с другой ролью: до отправки видно, что роль сменится и ссылка умрёт
  await invite(page, email, 'Администратор сайта')
  await expect(form.getByText(/с ролью «Редактор»/)).toBeVisible()
  await expect(form.getByText(/роль станет «Администратор сайта»/)).toBeVisible()
  await expect(form.getByText(/ссылка из прежнего письма перестанет работать/)).toBeVisible()
  await expect(form.getByRole('button', { name: 'Заменить приглашение' })).toBeVisible()

  // Другой адрес — предупреждения нет
  await form.getByLabel('Почта').fill(`other-${Date.now()}@example.test`)
  await expect(form.getByText(/уже отправлено/)).toHaveCount(0)
  await expect(form.getByRole('button', { name: 'Пригласить' })).toBeVisible()
})

test('редактор страницы подписывает тему: опубликованная, а правки темы — в разделе «Тема»', async ({
  page,
  demoSite,
}) => {
  const ed = editor(page)
  await ed.open()
  await expect(page.getByText('Страница показана в опубликованной теме')).toHaveCount(0)

  // Черновик темы отличается от опубликованной
  expect(
    (
      await sites[':siteId'].theme.$put({
        param: { siteId: demoSite.id },
        json: { ...defaultTheme, radius: 'large' },
      })
    ).status,
  ).toBe(200)
  await ed.open()
  const note = page.getByText('Страница показана в опубликованной теме')
  await expect(note).toBeVisible()
  await page.getByRole('link', { name: '«Тема»' }).click()
  await expect(page).toHaveURL('/theme')
  await expect(page.getByText(/редактор страницы показывает опубликованную тему/)).toBeVisible()
})

test('медиатека: у картинки видно, где она стоит; используемую удалить нельзя, ненужную — можно', async ({
  page,
  demoSite,
}) => {
  const media = mediaScreen(page)
  const used = await photo('used')
  const free = await photo('free')
  await media.open()
  for (const file of [used, free]) {
    await media.fileInput.setInputFiles(file)
    await expect(media.item(file.name)).toBeVisible()
  }
  const list = await sites[':siteId'].media.$get({ param: { siteId: demoSite.id } })
  if (list.status !== 200) throw new Error(`Медиатека: ${list.status}`)
  const mediaId = (await list.json()).items.find((item) => item.originalName === used.name)?.id
  if (!mediaId) throw new Error('Картинки нет в медиатеке')
  const saved = await sites[':siteId'].pages[':slug'].$put({
    param: { siteId: demoSite.id, slug: MAIN_PAGE_SLUG },
    json: {
      title: 'Главная',
      content: {
        blocks: [
          {
            id: 'hero',
            type: 'hero',
            props: { variant: 'split', title: 'Фото', image: { mediaId, alt: 'Кухня' } },
          },
        ],
      },
    },
  })
  expect(saved.status).toBe(200)

  // Экран берёт свежий список: открываем заново
  await media.open()
  const usedCard = media.item(used.name)
  await expect(usedCard.getByRole('list', { name: 'Где стоит картинка' })).toContainText(
    'Страница «Главная» — черновик',
  )
  await expect(usedCard.getByRole('link', { name: /Страница «Главная»/ })).toHaveAttribute(
    'href',
    '/pages/index',
  )
  await expect(usedCard).toContainText('Удалить нельзя')
  const remove = usedCard.getByRole('button', { name: /^Удалить/ })
  await expect(remove).toHaveAttribute('aria-disabled', 'true')
  const dialogs = answerDialogs(page, [true])
  await remove.click({ force: true })
  expect(dialogs, 'у используемой нет вопроса: удалять нечего').toEqual([])
  await expect(usedCard).toBeVisible()

  // Ненужная: сказано прямо, и удаляется
  const freeCard = media.item(free.name)
  await expect(freeCard).toContainText('Нигде не стоит')
  await expect(freeCard.getByRole('button', { name: /^Удалить/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

/** PNG-картинка с уникальным именем: медиатека демо-сайта общая у всех тестов */
async function photo(prefix: string) {
  const sharp = (await import('sharp')).default
  const buffer = await sharp({
    create: { width: 640, height: 400, channels: 3, background: '#3b6ea8' },
  })
    .png()
    .toBuffer()
  const name = `${prefix}-${Date.now()}.png`
  return { name, mimeType: 'image/png', buffer }
}

const aria = 'aria-disabled'

test('«Cookie и согласие»: правка → уход спрашивает; «Сохранить» выключена без правок', async ({
  page,
}) => {
  const dialogs = answerDialogs(page, [false])
  await page.goto('/seo/cookies')
  const form = page.getByRole('form', { name: 'Cookie и согласие' })
  const save = form.getByRole('button', { name: 'Сохранить', exact: true })
  await expect(save).toHaveAttribute(aria, 'true')

  await form.getByRole('radio', { name: /^Только уведомление/ }).check()
  await expect(save).not.toHaveAttribute(aria, 'true')
  // «Отмена» — остаёмся на экране с правкой (раньше экран уводил молча)
  await sidebar(page).section('Обзор').click()
  await expect(page).toHaveURL('/seo/cookies')
  await expect
    .poll(() => dialogs)
    .toEqual(['Уйти без сохранения? На странице есть несохранённые правки. Они пропадут.'])
})

test('SEO: Enter в поле сохраняет всё, а закрытие вкладки с правкой предупреждает', async ({
  page,
  demoSite,
}) => {
  const param = { siteId: demoSite.id }
  const before = await sites[':siteId'].settings.$get({ param })
  if (before.status !== 200) throw new Error(`Настройки: ${before.status}`)
  const original = (await before.json()).settings.name
  const beforeUnloadAsked = () =>
    page.evaluate<boolean>(
      `(() => {
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        return event.defaultPrevented
      })()`,
    )

  try {
    await page.goto('/seo')
    const save = page.getByRole('button', { name: 'Сохранить', exact: true })
    await expect(save).toHaveAttribute(aria, 'true')
    expect(await beforeUnloadAsked()).toBe(false)

    const name = page.getByLabel('Название сайта', { exact: true })
    await name.fill(`${original} (Enter)`)
    await expect(save).not.toHaveAttribute(aria, 'true')
    expect(await beforeUnloadAsked()).toBe(true)

    await name.press('Enter')
    await expect(page.getByText('Всё сохранено')).toBeVisible()
    await expect(save).toHaveAttribute(aria, 'true')
    expect(await beforeUnloadAsked()).toBe(false)
  } finally {
    await sites[':siteId'].settings.$patch({ param, json: { name: original } })
  }
})

test('SMTP: «Сохранить» выключена без правок, с правкой — включена и уход спрашивает', async ({
  page,
}) => {
  const dialogs = answerDialogs(page, [false])
  await page.goto('/mail')
  const section = page.getByRole('region', { name: 'Настройки SMTP' })
  const save = section.getByRole('button', { name: 'Сохранить', exact: true })
  await expect(save).toHaveAttribute(aria, 'true')

  await section.getByLabel('Сервер SMTP', { exact: true }).fill('smtp.example.test')
  await expect(save).not.toHaveAttribute(aria, 'true')
  await sidebar(page).section('Обзор').click()
  await expect(page).toHaveURL('/mail')
  await expect
    .poll(() => dialogs)
    .toEqual(['Уйти без сохранения? На странице есть несохранённые правки. Они пропадут.'])
})

test('«Тема», «Шапка» и «Подвал»: «Сохранить» выключена, пока правок нет', async ({ page }) => {
  await page.goto('/theme')
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveAttribute(
    aria,
    'true',
  )
  await page.goto('/header')
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveAttribute(
    aria,
    'true',
  )
  await page.getByRole('tab', { name: 'Подвал' }).click()
  await expect(page.getByRole('button', { name: 'Сохранить подвал' })).toHaveAttribute(aria, 'true')
})

test('«Уведомления»: адреса — правка → уход спрашивает; без каналов тест выключен с причиной', async ({
  page,
}) => {
  const dialogs = answerDialogs(page, [false])
  // В e2e почта — файловый ящик, и канал «работает»: ответ подменён на «ни один канал не работает»
  await page.route(/\/api\/sites\/[^/]+\/notifications$/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({
      response,
      json: { ...body, summary: { ...body.summary, enabled: false, reason: 'Каналов нет.' } },
    })
  })
  await page.goto('/notifications')
  const emails = page.getByRole('form', { name: 'Адреса почты для заявок' })
  const save = emails.getByRole('button', { name: 'Сохранить адреса' })
  await expect(save).toHaveAttribute(aria, 'true')

  const test = page.getByRole('button', { name: 'Отправить тестовое уведомление' }).first()
  await expect(test).toHaveAttribute(aria, 'true')
  await expect(page.getByText('Сначала подключите хотя бы один канал')).toBeVisible()

  await emails.getByLabel('Адреса почты').fill('novyj@example.test')
  await expect(save).not.toHaveAttribute(aria, 'true')
  await sidebar(page).section('Обзор').click()
  await expect(page).toHaveURL('/notifications')
  await expect
    .poll(() => dialogs)
    .toEqual(['Уйти без сохранения? На странице есть несохранённые правки. Они пропадут.'])
})

test('редактор страницы: h1 с названием, а не со слэшем; предпросмотр — «Десктоп»', async ({
  page,
}) => {
  await page.goto(`/pages/${MAIN_PAGE_SLUG}`)
  const h1 = page.getByRole('heading', { level: 1 })
  await expect(h1).toContainText('Редактор страницы «')
  await expect(h1).not.toHaveText('Редактор страницы «/»')
  // Умолчание предпросмотра в редакторе — «Десктоп», как в теме, шапке и своём блоке
  await expect(page.getByRole('radio', { name: 'Десктоп' })).toBeChecked()
})

test('экран своего блока: предпросмотр — «Десктоп» на 1440 и «Телефон» на 375', async ({
  page,
  demoSite,
}) => {
  await ownHeroOnMain(demoSite.id)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/blocks/le-hero')
  await expect(page.getByRole('radio', { name: 'Десктоп' })).toBeChecked()

  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/blocks/le-hero')
  await expect(page.getByRole('radio', { name: 'Телефон' })).toBeChecked()
})

test('SEO: Tab по полям не уводит фокус под липкую «Сохранить» (1440 и 375)', async ({ page }) => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(size)
    await page.goto('/seo')
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible()
    await page.getByLabel('Название сайта').focus()
    const covered: string[] = []
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      // Строкой: у e2e нет DOM-типов, а код выполняется в странице. Меряем, когда прокрутка к
      // полю закончилась (три кадра подряд без сдвига): плавная прокрутка под нагрузкой полного
      // прогона ещё шла, и поле ловилось на полпути под полосой
      const state = await page.evaluate<string | null>(`(async () => {
        const frame = () => new Promise((done) => requestAnimationFrame(done))
        const scrollers = () => [...document.querySelectorAll('*')]
          .filter((el) => el.scrollHeight > el.clientHeight)
          .map((el) => el.scrollTop)
          .join(',') + ',' + window.scrollY
        let last = scrollers()
        for (let still = 0, guard = 0; still < 3 && guard < 120; guard++) {
          await frame()
          const now = scrollers()
          still = now === last ? still + 1 : 0
          last = now
        }
        const active = document.activeElement
        const bar = [...document.querySelectorAll('div')].find((el) => /_bar_/.test(el.className))
        if (!active || !bar || bar.contains(active) || active === document.body) return null
        // Закрыто полосой — только если прямоугольники пересекаются: в конце страницы полоса
        // стоит на своём месте и кнопки под ней видны, а ссылки панели слева её не касаются
        const box = active.getBoundingClientRect()
        const cover = bar.getBoundingClientRect()
        const overlaps =
          box.bottom > cover.top && box.top < cover.bottom &&
          box.right > cover.left && box.left < cover.right
        return overlaps ? active.tagName + '#' + active.id : null
      })()`)
      if (state) covered.push(state)
    }
    expect(covered, `под полосой на ${size.width} px`).toEqual([])
  }
})

test('поле пароля: у кнопки-глаза кольцо фокуса только после Tab, а не всегда', async ({
  browser,
  baseURL,
}) => {
  // Вход — без сессии: чистый контекст
  const context = await browser.newContext({ baseURL, storageState: undefined })
  try {
    const page = await context.newPage()
    for (const size of [
      { width: 1440, height: 900 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(size)
      await page.goto('/login')
      const eye = page.getByRole('button', { name: 'Показать символы' })
      await expect(eye).toBeVisible()
      // Без фокуса — никакой обводки
      await expect(eye).toHaveCSS('outline-style', 'none')
      // Tab: почта → пароль → глаз; на глазу кольцо появляется
      await page.getByLabel('Почта').focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await expect(eye).toBeFocused()
      await expect(eye).not.toHaveCSS('outline-style', 'none')
    }
  } finally {
    await context.close()
  }
})

test('узкий редактор: aria-controls каждой вкладки ведёт на существующую панель', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`/pages/${MAIN_PAGE_SLUG}`)
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(4)
  const dangling = async () => {
    const ids = await tabs.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-controls') ?? ''),
    )
    const missing: string[] = []
    for (const id of ids) {
      if ((await page.locator(`[id="${id}"]`).count()) === 0) missing.push(id)
    }
    return missing
  }
  expect(await dangling()).toEqual([])
  await page.getByRole('tab', { name: /^SEO/ }).click()
  expect(await dangling()).toEqual([])
})

test('«Уведомления»: набранный токен бота — несохранённое, уход спрашивает', async ({ page }) => {
  const dialogs = answerDialogs(page, [false])
  await page.goto('/notifications')
  await page.getByLabel('Токен бота').fill('123456:abc')
  await sidebar(page).section('Обзор').click()
  await expect(page).toHaveURL('/notifications')
  await expect
    .poll(() => dialogs)
    .toEqual(['Уйти без сохранения? На странице есть несохранённые правки. Они пропадут.'])
})
