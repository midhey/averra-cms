import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// Экран «Почта»: владелец видит, что почта работает и через что, очередь и как выглядят письма.
// API e2e запущен в учебном режиме, поэтому почта — файловый ящик в e2e/.data/mail

const templates = [
  { title: 'Проверка почты', text: 'Почта работает' },
  { title: 'Сброс пароля', text: 'Задать новый пароль' },
  { title: 'Приглашение на сайт', text: 'Принять приглашение' },
] as const

test('владелец открывает «Почту» из шапки: состояние, очередь и предпросмотр шаблонов', async ({
  page,
}) => {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Разделы админки' })
    .getByRole('link', { name: 'Почта' })
    .click()

  await expect(page).toHaveURL(/\/mail$/)
  await expect(page).toHaveTitle('Почта — Averra CMS')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Почта')

  const state = page.getByRole('region', { name: 'Состояние' })
  await expect(state).toContainText('Почта включена')
  await expect(state).toContainText('Файловый ящик: письма не уходят наружу')
  await expect(state).toContainText('Averra CMS <noreply@averra.test>')

  await expect(page.getByRole('region', { name: 'Очередь писем' })).toBeVisible()

  const section = page.getByRole('region', { name: 'Шаблоны писем' })
  for (const { title, text } of templates) {
    const article = section.getByRole('article', { name: title })
    await expect(article).toBeVisible()
    // Письмо в iframe без скриптов: его содержимое — HTML шаблона на примерных данных
    const frame = article.frameLocator(`iframe[title="Предпросмотр письма «${title}»"]`)
    await expect(frame.locator('body')).toContainText(text)
    await expect(frame.locator('body')).toContainText('Averra CMS')

    await article.getByText('Текстовая версия').click()
    await expect(article.locator('pre')).toContainText('письмо отправлено автоматически')
  }
  await expect(section.getByRole('article')).toHaveCount(templates.length)
})

// Участника в базе e2e не завести (см. client.spec.ts): команды не открывают базу, пока запущен
// API e2e, а приглашений ещё нет (шаг 3.2). Поэтому роль подменяется в ответе /api/me,
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
  await expect(page.getByRole('navigation', { name: 'Разделы админки' })).toHaveCount(0)

  await page.goto('/mail')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не получилось открыть')
  await expect(page.getByRole('alert')).toHaveText(OWNER_ONLY)
  await expect(page.getByRole('region', { name: 'Очередь писем' })).toHaveCount(0)
})
