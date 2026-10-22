import { randomInt } from 'node:crypto'
import { startFakeTelegram } from '@averra/api/testing/telegram'
import { demoPage, demoPageTitle, form, MAIN_PAGE_SLUG } from '@averra/schema'
import { request } from '@playwright/test'
import { e2eOwner, telegramTest, urls } from '../urls'
import { expect, ownerApi, sites, test } from './fixtures'
import { waitForMail } from './mailbox'

// Раздел «Уведомления» целиком: владелец подключает бота Telegram (фейковый Bot API e2e),
// добавляет адрес почты и привязывает чат к заявкам ссылкой с кодом — без chat id руками.
// Посетитель отправляет заявку — уведомление уходит и письмом, и в Telegram

const BLOCK_ID = 'notify-form'
const MANAGER = 'manager-notify@e2e.test'

/** Форма на опубликованной главной и заявка в неё — как посетитель без JS, ответом JSON */
async function sendLead(siteId: string, name: string) {
  const param = { siteId, slug: MAIN_PAGE_SLUG }
  const content = {
    blocks: [...demoPage.blocks, { id: BLOCK_ID, type: 'form' as const, props: form.example }],
  }
  const page = sites[':siteId'].pages[':slug']
  expect((await page.$put({ param, json: { title: demoPageTitle, content } })).status).toBe(200)
  expect((await page.publish.$post({ param })).status).toBe(200)
  const visitor = await request.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `10.50.${randomInt(256)}.${randomInt(1, 255)}` },
  })
  try {
    const res = await visitor.post(
      `${urls.api}/api/forms/${siteId}/${MAIN_PAGE_SLUG}/${BLOCK_ID}`,
      {
        headers: { accept: 'application/json', origin: urls.renderer },
        form: { name, phone: '+7 900 555-00-11', consent: 'yes', website: '' },
      },
    )
    expect(res.status(), await res.text()).toBe(200)
  } finally {
    await visitor.dispose()
  }
}

test('владелец подключает Telegram и адрес — заявка уходит в оба канала', async ({
  page,
  demoSite,
}) => {
  const telegram = await startFakeTelegram({ token: telegramTest.token, port: telegramTest.port })
  try {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Разделы сайта' })
      .getByRole('link', { name: 'Уведомления' })
      .click()
    await expect(page).toHaveURL(/\/notifications$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Уведомления')

    // Бот: токен и пароль владельца. Токен после сохранения не виден, рядом — «задан»
    const channels = page.getByRole('region', { name: 'Каналы' })
    const bot = channels.getByRole('region', { name: 'Telegram' })
    await expect(bot).toContainText('не работает')
    await bot.getByLabel('Токен бота', { exact: true }).fill(telegramTest.token)
    await bot.getByLabel('Ваш пароль от админки').fill(e2eOwner.password)
    await bot.getByRole('button', { name: 'Подключить бота' }).click()
    await expect(bot.getByText('Бот сохранён')).toBeVisible()
    await expect(bot.getByRole('definition').first()).toContainText('@averra_test_bot')
    await expect(bot).toContainText('работает')
    await expect(bot.getByLabel('Токен бота', { exact: true })).toHaveValue('')
    await expect(page.locator('body')).not.toContainText(telegramTest.token)

    // «Проверить» у каждого канала — его адаптер в API: Telegram отвечает сразу по шагам,
    // почта ставит письмо себе в очередь
    await bot.getByRole('button', { name: 'Проверить' }).click()
    await expect(bot.getByRole('list', { name: 'Шаги проверки: Telegram' })).toContainText(
      'Telegram отвечает, бот @averra_test_bot',
    )
    const email = channels.getByRole('region', { name: 'Почта' })
    await email.getByRole('button', { name: 'Проверить' }).click()
    await expect(email.getByRole('list', { name: 'Шаги проверки: Почта' })).toContainText(
      `Проверочное письмо поставлено в очередь на ${e2eOwner.email}`,
    )

    // Адрес почты для заявок
    const leads = page.getByRole('region', { name: 'Новые заявки' })
    await leads.getByLabel('Адреса почты', { exact: true }).fill(MANAGER)
    await leads.getByRole('button', { name: 'Сохранить адреса' }).click()
    await expect(leads.getByText('Адреса сохранены')).toBeVisible()

    // Чат — по ссылке с одноразовым кодом: человек жмёт «Старт», бот узнаёт чат сам
    await leads.getByRole('button', { name: 'Привязать чат Telegram' }).click()
    const link = leads.getByRole('link', { name: 'Открыть чат с ботом' })
    const href = (await link.getAttribute('href')) ?? ''
    const code = new URL(href).searchParams.get('start') ?? ''
    expect(href).toMatch(/^https:\/\/t\.me\/averra_test_bot\?start=[A-Za-z0-9_-]{22}$/)
    telegram.pushStart(code, { id: 6060, type: 'group', title: 'Отдел продаж e2e' })
    await expect(leads.getByText('Чат «Отдел продаж e2e» привязан')).toBeVisible({
      timeout: 15_000,
    })
    await expect(leads.getByRole('list', { name: 'Чаты Telegram для заявок' })).toContainText(
      'Отдел продаж e2e',
    )
    await expect(leads).toContainText('Сейчас уведомления уходят: manager-notify@e2e.test')

    // Посетитель отправляет заявку: письмо менеджеру и сообщение в чат
    const name = `Ольга ${Date.now()}`
    await sendLead(demoSite.id, name)
    const mail = await waitForMail(MANAGER, `Новая заявка с сайта «${demoSite.name}»`)
    expect(mail.text).toContain(`Имя: ${name}`)
    await expect
      .poll(() => telegram.messagesTo('6060').some((message) => message.text.includes(name)), {
        timeout: 15_000,
      })
      .toBe(true)
    const message = telegram.messagesTo('6060').find((item) => item.text.includes(name))
    expect(message?.parseMode).toBe('HTML')
    expect(message?.text).toContain(`<b>Новая заявка с сайта «${demoSite.name}»</b>`)

    // На экране заявок видно, куда уходят уведомления
    await page.goto('/leads')
    await expect(
      page.getByText(/Уведомления уходят: manager-notify@e2e\.test, Telegram «Отдел продаж e2e»/),
    ).toBeVisible()
  } finally {
    // Остальные e2e ждут уведомлений владельцу по умолчанию: адреса и бот — как были
    await ownerApi.sites[':siteId'].notifications.email.$put({
      param: { siteId: demoSite.id },
      json: { addresses: [] },
    })
    await ownerApi.notifications.telegram.$delete({
      json: { currentPassword: e2eOwner.password },
    })
    await telegram.close()
  }
})

test('редактор по прямому адресу /notifications — понятный отказ, а не пустой экран', async ({
  page,
}) => {
  const message = 'Заявки видят владелец и клиент сайта'
  await page.route(/\/api\/me$/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, user: { ...body.user, role: 'member' } } })
  })
  await page.route(/\/api\/sites\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), access: 'editor' } })
  })
  // Ответ API редактору — как настоящий (requireSite, leads.read): права решает API
  await page.route(/\/api\/sites\/[^/]+\/notifications$/, (route) =>
    route.fulfill({ status: 403, json: { error: { code: 'forbidden', message } } }),
  )
  await page.goto('/notifications')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не получилось открыть')
  await expect(page.getByRole('alert')).toHaveText(message)
  await expect(page.getByRole('region', { name: 'Новые заявки' })).toHaveCount(0)
})

test('клиенту — только получатели заявок, без каналов и служебных', async ({ page }) => {
  await page.goto('/notifications')
  for (const name of ['Каналы', 'Новые заявки', 'Служебные события']) {
    await expect(page.getByRole('region', { name })).toBeVisible()
  }

  // Роль подменяется в ответах API о пользователе и сайте, как в client.spec.ts: права решает
  // API (его тесты), а здесь — что экран слушается роли
  await page.route(/\/api\/me$/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, user: { ...body.user, role: 'member' } } })
  })
  await page.route(/\/api\/sites\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), access: 'client' } })
  })
  await page.goto('/notifications')
  const leads = page.getByRole('region', { name: 'Новые заявки' })
  await expect(leads).toBeVisible()
  await expect(page.getByRole('region', { name: 'Каналы' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Служебные события' })).toHaveCount(0)
  // Без бота привязать чат нельзя — и сказано, кто его подключает
  await expect(leads).toContainText('Бота подключает владелец админки')
})
