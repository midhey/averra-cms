import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// Экран «Почта»: владелец видит, что почта работает и через что, очередь и как выглядят письма.
// API e2e запущен в учебном режиме, поэтому почта — файловый ящик в e2e/.data/mail

// Подвал письма: общий — «отправлено автоматически», у заявки — что «Ответить» напишет посетителю
const AUTO = 'письмо отправлено автоматически'

const templates = [
  { title: 'Проверка почты', text: 'Почта работает', footer: AUTO },
  { title: 'Сброс пароля', text: 'Задать новый пароль', footer: AUTO },
  { title: 'Приглашение на сайт', text: 'Принять приглашение', footer: AUTO },
  {
    title: 'Настройки почты изменены',
    text: 'Настройки почты в админке Averra CMS изменены',
    footer: AUTO,
  },
  {
    title: 'Новая заявка',
    text: 'Открыть заявку в админке',
    footer: '«Ответить» напишет посетителю',
  },
  { title: 'Заявка получена', text: 'Мы получили вашу заявку', footer: AUTO },
  {
    title: 'Адреса уведомлений о заявках изменены',
    text: 'изменили адреса, куда приходят уведомления о новых заявках',
    footer: AUTO,
  },
] as const

test('владелец открывает «Почту» из панели: состояние, очередь и предпросмотр шаблонов', async ({
  page,
}) => {
  await page.goto('/')
  const installation = page.getByRole('navigation', { name: 'Установка' })
  // В панели видно, работает ли почта, ещё до перехода
  await expect(installation.getByRole('link', { name: /^Почта/ })).toContainText('работает')
  await installation.getByRole('link', { name: /^Почта/ }).click()

  await expect(page).toHaveURL(/\/mail$/)
  await expect(page).toHaveTitle('Почта — Averra CMS')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Почта')

  const state = page.getByRole('region', { name: 'Состояние' })
  await expect(state).toContainText('Почта включена')
  await expect(state).toContainText('Файловый ящик: письма не уходят наружу')
  await expect(state).toContainText('Averra CMS <noreply@averra.test>')

  // SMTP в админке не задан (smtp-settings.spec.ts его удаляет за собой): форма пустая, а пароль
  // SMTP не задан. Сохранять и проверять её здесь не нужно — это делает smtp-settings.spec.ts
  const smtp = page.getByRole('region', { name: 'Настройки SMTP' })
  await expect(smtp).toContainText('SMTP не задан')
  await expect(smtp.getByLabel('Пароль SMTP', { exact: true })).toHaveAccessibleDescription(
    /Пароль не задан/,
  )
  await expect(smtp.getByRole('button', { name: 'Проверить подключение' })).toBeVisible()

  await expect(page.getByRole('region', { name: 'Очередь писем' })).toBeVisible()

  const section = page.getByRole('region', { name: 'Шаблоны писем' })
  for (const { title, text, footer } of templates) {
    const article = section.getByRole('article', { name: title })
    await expect(article).toBeVisible()
    // Письмо в iframe без скриптов: его содержимое — HTML шаблона на примерных данных
    const frame = article.frameLocator(`iframe[title="Предпросмотр письма «${title}»"]`)
    await expect(frame.locator('body')).toContainText(text)
    await expect(frame.locator('body')).toContainText('Averra CMS')

    await article.getByText('Текстовая версия').click()
    await expect(article.locator('pre')).toContainText(footer)
  }
  await expect(section.getByRole('article')).toHaveCount(templates.length)
})

/**
 * Подменить в ответе GET /api/mail то, чего в почте e2e не бывает (она всегда файловый ящик):
 * остальное — настоящий ответ API
 */
async function patchMailState(page: Page, patch: Record<string, unknown>) {
  await page.route(/\/api\/mail$/, async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), ...patch } })
  })
}

test('почта выключена — экран говорит это и почему', async ({ page }) => {
  // Так API отвечает без SMTP вне учебного режима (config.ts): почта выключена с причиной
  const reason =
    'Почта не настроена: задайте SMTP на странице «Почта» в админке или переменными SMTP_HOST, ' +
    'SMTP_USER, SMTP_PASSWORD и MAIL_FROM (см. README, «Почта»). Не работают сброс пароля, ' +
    'приглашения участников и уведомления о заявках'
  await patchMailState(page, { status: { enabled: false, reason } })
  await page.goto('/mail')

  const state = page.getByRole('region', { name: 'Состояние' })
  await expect(state).toContainText('Почта выключена')
  await expect(state).toContainText(reason)
  await expect(state).not.toContainText('Почта включена')
  // Остальной экран на месте: настройки SMTP и очередь
  await expect(page.getByRole('region', { name: 'Настройки SMTP' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Очередь писем' })).toBeVisible()
})

test('письма по SMTP со ссылками на localhost — экран предупреждает про ADMIN_URL', async ({
  page,
}) => {
  const linkWarning =
    'Ссылки в письмах (сброс пароля, приглашения) ведут на http://localhost:5273 — адрес этого ' +
    'компьютера, а письма уходят по SMTP: адресат на другом компьютере такую ссылку не откроет. ' +
    'На сервере задайте ADMIN_URL — адрес админки снаружи — и перезапустите API'
  await patchMailState(page, {
    status: {
      enabled: true,
      provider: {
        kind: 'smtp',
        host: 'smtp.yandex.ru',
        port: 465,
        security: 'tls',
        user: 'noreply@averra.test',
        from: { address: 'noreply@averra.test', name: 'Averra CMS' },
      },
    },
    linkWarning,
  })
  await page.goto('/mail')

  const state = page.getByRole('region', { name: 'Состояние' })
  await expect(state).toContainText('Почта включена')
  await expect(state).toContainText(linkWarning)
})

test('файловый ящик — без предупреждения про localhost: в разработке ссылки на него и нужны', async ({
  page,
}) => {
  await page.goto('/mail')
  const state = page.getByRole('region', { name: 'Состояние' })
  await expect(state).toContainText('Файловый ящик')
  await expect(state).not.toContainText('ADMIN_URL')
})

/** Очередь с неудачным письмом и длинными адресом и ошибкой: в e2e все письма уходят сразу */
const outbox = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    recipient: 'client.with.a.long.address@remont-ivana-kvartir.ru',
    template: 'lead-notification',
    status: 'failed',
    attempts: 5,
    nextAttemptAt: '2026-10-20T08:00:00.000Z',
    lastError: '535 5.7.8 Error: authentication failed: Invalid user or password (smtp.yandex.ru)',
    sentAt: null,
    createdAt: '2026-10-20T07:00:00.000Z',
    canRetry: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    recipient: 'owner@e2e.test',
    template: 'password-reset',
    status: 'pending',
    attempts: 1,
    nextAttemptAt: '2026-10-20T09:15:00.000Z',
    lastError: 'Временный отказ 451: лимит писем отправителя',
    sentAt: null,
    createdAt: '2026-10-20T07:10:00.000Z',
    canRetry: false,
  },
]

test('очередь писем: на 1440 px без прокрутки вбок, на телефоне — карточками', async ({ page }) => {
  await page.route(/\/api\/mail\/outbox$/u, (route) => route.fulfill({ json: outbox }))
  const retry = page.getByRole('button', { name: `Повторить письмо для ${outbox[0]?.recipient}` })
  const error = page.getByText(/^535 5\.7\.8 Error/u)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/mail')
  const table = page.getByRole('group', { name: 'Очередь писем' })
  await expect(table.getByRole('table')).toBeVisible()
  // Таблица целиком в рамке: ошибка и «Повторить» видны без прокрутки вбок
  const overflow = await table.evaluate(
    (el: { scrollWidth: number; clientWidth: number }) => el.scrollWidth - el.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  // Прокручиваем страницу к очереди, но не саму таблицу вбок
  await table.scrollIntoViewIfNeeded()
  for (const target of [retry, error]) {
    await expect(target).toBeInViewport({ ratio: 1 })
  }

  await page.setViewportSize({ width: 375, height: 812 })
  const cards = page.getByRole('list', { name: 'Очередь писем' })
  await expect(cards.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('table', { name: 'Очередь писем' })).toHaveCount(0)
  await retry.scrollIntoViewIfNeeded()
  await expect(retry).toBeInViewport({ ratio: 1 })
  await expect(error).toBeVisible()
  expect(
    Number(
      await page.evaluate(
        'document.documentElement.scrollWidth - document.documentElement.clientWidth',
      ),
    ),
  ).toBeLessThanOrEqual(0)
})

// Как в client.spec.ts, роль подменяется в ответе /api/me,
// а ответ API о почте — тем 403, который API отдаёт не владельцу (права проверяет
// apps/api/src/modules/mail/mail.test.ts). Здесь — что админка слушается роли и честно отказывает
const OWNER_ONLY = 'Почту смотрит и настраивает только владелец админки'

async function actAsMember(page: Page) {
  await page.route(/\/api\/me$/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, user: { ...body.user, role: 'member' } } })
  })
  await page.route(/\/api\/mail(\/.*)?$/, (route) =>
    route.fulfill({ status: 403, json: { error: { code: 'forbidden', message: OWNER_ONLY } } }),
  )
}

test('участнику ссылки на почту нет, а по прямому адресу — понятный отказ', async ({ page }) => {
  await actAsMember(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сайты')
  await expect(page.getByRole('navigation', { name: 'Установка' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Почта/ })).toHaveCount(0)

  await page.goto('/mail')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не получилось открыть')
  await expect(page.getByRole('alert')).toHaveText(OWNER_ONLY)
  await expect(page.getByRole('region', { name: 'Очередь писем' })).toHaveCount(0)
})
