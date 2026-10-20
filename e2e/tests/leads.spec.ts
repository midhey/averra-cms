import { randomInt } from 'node:crypto'
import { demoPage, demoPageTitle, form, MAIN_PAGE_SLUG } from '@averra/schema'
import { request } from '@playwright/test'
import { urls } from '../urls'
import { answerDialogs, expect, sites, test } from './fixtures'

// Экран заявок по концепту (Leads.dc.html): вкладки, список и карточка рядом, «Ответить письмом»,
// удаление с подтверждением, на телефоне — по очереди. Приём заявок и CSV — forms.spec.ts

const BLOCK_ID = 'leads-form'

/** Форма на опубликованной главной и заявка в неё — как посетитель без JS, ответом JSON */
async function createLead(siteId: string, fields: Record<string, string>) {
  const param = { siteId, slug: MAIN_PAGE_SLUG }
  const content = {
    blocks: [...demoPage.blocks, { id: BLOCK_ID, type: 'form' as const, props: form.example }],
  }
  const page = sites[':siteId'].pages[':slug']
  expect((await page.$put({ param, json: { title: demoPageTitle, content } })).status).toBe(200)
  expect((await page.publish.$post({ param })).status).toBe(200)

  const visitor = await request.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `10.40.${randomInt(256)}.${randomInt(1, 255)}` },
  })
  try {
    const res = await visitor.post(
      `${urls.api}/api/forms/${siteId}/${MAIN_PAGE_SLUG}/${BLOCK_ID}`,
      {
        headers: { accept: 'application/json', origin: urls.renderer },
        form: { ...fields, consent: 'yes', website: '' },
      },
    )
    expect(res.status(), await res.text()).toBe(200)
  } finally {
    await visitor.dispose()
  }
}

test('список и карточка рядом: вкладки, «Ответить письмом», «обработана», удаление', async ({
  page,
  demoSite,
}) => {
  const name = `Мария ${Date.now()}`
  const email = `maria-${Date.now()}@e2e.test`
  await createLead(demoSite.id, {
    name,
    phone: '+7 912 000-00-00',
    email,
    comment: 'Нужен ремонт ванной, 4 м²',
  })

  await page.goto(`/sites/${demoSite.id}/leads?status=new`)
  await expect(page.getByRole('heading', { level: 1, name: 'Заявки' })).toBeVisible()
  const tabs = page.getByRole('tablist', { name: 'Фильтр заявок' })
  await expect(tabs.getByRole('tab', { name: /^Новые · \d+/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // Заявка ещё не выбрана — рядом со списком подсказка
  await expect(page.getByRole('heading', { name: 'Выберите заявку' })).toBeVisible()

  const list = page.getByRole('list', { name: 'Список заявок' })
  const item = list.getByRole('link').filter({ hasText: name })
  await expect(item).toContainText('Нужен ремонт ванной, 4 м²')
  await item.click()
  const card = page.getByRole('article', { name })
  await expect(card).toBeVisible()
  // Список остаётся рядом, выбранная заявка в нём отмечена
  await expect(list).toBeVisible()
  await expect(item).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(
    new RegExp(`/sites/${demoSite.id}/leads/[0-9a-f-]{36}\\?status=new$`),
  )
  // Телефон и почта — ссылками: позвонить и написать в одно касание
  await expect(card.getByRole('link', { name: '+7 912 000-00-00' })).toHaveAttribute(
    'href',
    'tel:+79120000000',
  )
  await expect(card.getByRole('link', { name: email, exact: true })).toHaveAttribute(
    'href',
    `mailto:${email}`,
  )
  await expect(card).toContainText('Согласие на обработку персональных данных')
  await expect(card.getByRole('link', { name: 'Ответить письмом' })).toHaveAttribute(
    'href',
    `mailto:${email}?subject=${encodeURIComponent(`Ваша заявка на сайте «${demoSite.name}»`)}`,
  )

  await card.getByRole('button', { name: 'Отметить обработанной' }).click()
  await expect(card.getByRole('status')).toHaveText('Заявка обработана')
  await expect(card.getByRole('button', { name: 'Вернуть в новые' })).toBeVisible()
  // Когда обработана — видно глазами, а не только диктору
  await expect(card.getByText(/^Обработана \d/u)).toBeVisible()
  // Во вкладке «Новые» её больше нет, в «Обработанных» — есть. Вкладки — стрелками
  await tabs.getByRole('tab', { selected: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(`/sites/${demoSite.id}/leads?status=processed`)
  await expect(tabs.getByRole('tab', { name: 'Обработанные' })).toBeFocused()
  await expect(list.getByRole('link').filter({ hasText: name })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(`/sites/${demoSite.id}/leads?status=new`)
  await expect(list.getByRole('link').filter({ hasText: name })).toHaveCount(0)
  await page.keyboard.press('End')
  await expect(page).toHaveURL(`/sites/${demoSite.id}/leads`)

  // Удаление: «Отмена» оставляет, «ОК» удаляет и возвращает к списку, фокус — на вкладку
  await list.getByRole('link').filter({ hasText: name }).click()
  const dialogs = answerDialogs(page, [false, true])
  await card.getByRole('button', { name: 'Удалить' }).click()
  await expect.poll(() => dialogs.length).toBe(1)
  expect(dialogs[0]).toContain(`Удалить заявку «${name}»`)
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Удалить' }).click()
  await expect(page).toHaveURL(`/sites/${demoSite.id}/leads`)
  await expect(list.getByRole('link').filter({ hasText: name })).toHaveCount(0)
  await expect(tabs.getByRole('tab', { name: 'Все' })).toBeFocused()
})

test('обзор берёт только последние заявки и только поля карточки, а не весь список', async ({
  page,
  demoSite,
}) => {
  const name = `Ирина ${Date.now()}`
  await createLead(demoSite.id, { name, phone: '+7 900 123-45-67', email: '', comment: '' })
  const requests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith(`/api/sites/${demoSite.id}/leads`)) {
      requests.push(url.pathname + url.search)
    }
  })
  const recent = page.waitForResponse((response) =>
    response.url().includes(`/api/sites/${demoSite.id}/leads/recent`),
  )
  await page.goto(`/sites/${demoSite.id}`)
  const body = (await (await recent).json()) as { items: Record<string, unknown>[] }
  const section = page.getByRole('region', { name: 'Последние заявки' })
  await expect(section.getByRole('link').filter({ hasText: name })).toBeVisible()
  expect(body.items.length).toBeLessThanOrEqual(3)
  expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(
    ['createdAt', 'data', 'formTitle', 'id', 'pageSlug', 'status'].sort(),
  )
  // Загрузчик и экран могут спросить дважды, но только последние, а не весь список
  expect(requests.length).toBeGreaterThan(0)
  for (const url of requests) expect(url).toBe(`/api/sites/${demoSite.id}/leads/recent`)
})

test('пустая вкладка: панель — остановка Tab, фокус не уходит со страницы', async ({
  page,
  demoSite,
}) => {
  // Обработанных заявок нет: ответ API подменён пустым списком
  await page.route(/\/api\/sites\/[^/]+\/leads\?status=processed$/u, async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), items: [] } })
  })
  await page.goto(`/sites/${demoSite.id}/leads?status=processed`)
  await expect(page.getByRole('heading', { name: 'Таких заявок нет' })).toBeVisible()
  const tabs = page.getByRole('tablist', { name: 'Фильтр заявок' })
  await tabs.getByRole('tab', { name: 'Обработанные' }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('tabpanel')).toBeFocused()
})

test('без почты посетителя «Ответить письмом» нет', async ({ page, demoSite }) => {
  const name = `Анна ${Date.now()}`
  await createLead(demoSite.id, { name, phone: '+7 900 555-44-33', email: '', comment: '' })
  await page.goto(`/sites/${demoSite.id}/leads`)
  await page
    .getByRole('list', { name: 'Список заявок' })
    .getByRole('link')
    .filter({ hasText: name })
    .click()
  const card = page.getByRole('article', { name })
  await expect(card.getByRole('button', { name: 'Отметить обработанной' })).toBeVisible()
  await expect(card.getByRole('link', { name: 'Ответить письмом' })).toHaveCount(0)
})

test('на телефоне — по очереди: список, потом карточка со ссылкой «Все заявки»', async ({
  page,
  demoSite,
}) => {
  const name = `Олег ${Date.now()}`
  await createLead(demoSite.id, { name, phone: '+7 921 111-22-33', email: '', comment: '' })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`/sites/${demoSite.id}/leads`)
  const list = page.getByRole('list', { name: 'Список заявок' })
  await expect(list).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Выберите заявку' })).toBeHidden()

  await list.getByRole('link').filter({ hasText: name }).click()
  const card = page.getByRole('article', { name })
  await expect(card).toBeVisible()
  await expect(list).toBeHidden()
  await expect(page.getByRole('tablist', { name: 'Фильтр заявок' })).toBeHidden()
  const overflow = await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )
  expect(Number(overflow)).toBeLessThanOrEqual(0)

  await card.getByRole('link', { name: 'Все заявки' }).click()
  await expect(page).toHaveURL(`/sites/${demoSite.id}/leads`)
  await expect(list).toBeVisible()
})

test('заявки с таким id нет — сообщение в колонке карточки, список и заголовок экрана на месте', async ({
  page,
  demoSite,
}) => {
  await page.goto(`/sites/${demoSite.id}/leads`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const title = await page.title()

  await page.goto(`/sites/${demoSite.id}/leads/00000000-0000-4000-8000-000000000000?status=new`)
  const back = page.getByRole('link', { name: 'Все заявки' })
  await expect(back).toBeVisible()
  // Один main и один h1: ошибка не рисует второй экран внутри экрана заявок
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Не получилось открыть' })).toHaveCount(0)
  await expect(page.getByRole('tablist', { name: 'Фильтр заявок' })).toBeVisible()
  await expect(page).toHaveTitle(title)

  await back.click()
  await expect(page).toHaveURL(`/sites/${demoSite.id}/leads?status=new`)

  // Кривой id в адресе — «не найдена», в той же колонке
  await page.goto(`/sites/${demoSite.id}/leads/not-a-uuid`)
  await expect(page.getByRole('heading', { name: 'Заявка не найдена' })).toBeVisible()
  await expect(page.getByRole('main')).toHaveCount(1)
})
