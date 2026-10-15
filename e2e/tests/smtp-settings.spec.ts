import { readFile } from 'node:fs/promises'
import { startTestSmtpServer } from '@averra/api/testing/smtp'
import { e2eOwner, smtpTest } from '../urls'
import { answerDialogs, expect, ownerApi, test } from './fixtures'

// SMTP в админке по-настоящему: тестовый SMTP-сервер с сертификатом от CA, которому API e2e
// доверяет (scripts/smtp-certs.ts, NODE_EXTRA_CA_CERTS). В форме — 587, а API e2e подключается
// к порту тестового сервера (smtpTest.port, DEV_SMTP_CONNECT_PORT). Владелец вводит настройки,
// проверяет подключение, сохраняет со своим паролем — и пароль SMTP после этого не виден
// ни на странице, ни в ответах API. Остальные e2e читают файловый ящик, поэтому настройки SMTP
// тест в конце удаляет

/** Учебные данные тестового SMTP-сервера — только для e2e */
const SMTP_USER = 'mailer@e2e.test'
const SMTP_PASSWORD = 'e2e-SMTP-пароль-73'

/** Тема письма из сырого текста: nodemailer кодирует кириллицу как =?UTF-8?B?…?= или ?Q? */
function subjectOf(raw: string) {
  const header = /^Subject: (.*(?:\r?\n[ \t].*)*)/m.exec(raw)?.[1] ?? ''
  return header
    .replace(/\r?\n[ \t]/g, ' ')
    .replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=\s*/gi, (_, kind: string, text: string) =>
      kind.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64').toString('utf8')
        : decodeURIComponent(text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, '%$1')),
    )
    .trim()
}

test('владелец задаёт SMTP: проверка, сохранение с паролем, пароль «задан» и нигде не виден', async ({
  page,
}) => {
  const cert = {
    key: await readFile(smtpTest.files.key, 'utf8'),
    cert: await readFile(smtpTest.files.cert, 'utf8'),
  }
  const smtp = await startTestSmtpServer({
    mode: 'starttls',
    cert,
    users: { [SMTP_USER]: SMTP_PASSWORD },
    port: smtpTest.port,
  })
  // Все ответы API за тест: пароля SMTP не должно быть ни в одном
  const bodies: Promise<string>[] = []
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/')) {
      bodies.push(response.text().catch(() => ''))
    }
  })

  try {
    await page.goto('/mail')
    const section = page.getByRole('region', { name: 'Настройки SMTP' })
    await expect(section).toContainText('SMTP не задан')
    // API e2e — в учебном режиме: ключ шифрования учебный, и экран об этом предупреждает
    await expect(section).toContainText('Ключ шифрования учебный')

    await section.getByLabel('Сервер SMTP', { exact: true }).fill('localhost')
    await section.getByRole('radio', { name: '587 — STARTTLS' }).check()
    await section.getByLabel('Логин', { exact: true }).fill(SMTP_USER)
    await section.getByLabel('Пароль SMTP', { exact: true }).fill(SMTP_PASSWORD)
    await section.getByLabel('Адрес отправителя', { exact: true }).fill('noreply@e2e.test')
    await section.getByLabel('Имя отправителя', { exact: true }).fill('Averra e2e')
    // Проверочное письмо — по умолчанию на почту владельца
    await expect(section.getByLabel('Куда отправить проверочное письмо')).toHaveValue(
      e2eOwner.email,
    )

    // Без проверки «Сохранить» не сохраняет: сначала проверка или явное «без проверки»
    const save = section.getByRole('button', { name: 'Сохранить', exact: true })
    await save.click()
    await expect(section.getByRole('alert')).toContainText('Сначала проверьте подключение')

    await section.getByRole('button', { name: 'Проверить подключение' }).click()
    await expect(section.getByText('Подключение работает')).toBeVisible({ timeout: 20_000 })
    const steps = section.getByRole('list', { name: 'Шаги проверки' }).getByRole('listitem')
    await expect(steps).toHaveCount(5)
    await expect(steps.last()).toContainText(`Письмо для ${e2eOwner.email} принято сервером`)
    expect(smtp.received.map((mail) => subjectOf(mail.raw))).toEqual(['Проверка почты Averra CMS'])

    // Неверный пароль владельца — отказ у поля, настройки не сохранены
    const ownPassword = section.getByLabel('Ваш пароль от админки')
    await ownPassword.fill('не тот пароль')
    await save.click()
    await expect(ownPassword).toHaveAccessibleDescription(/Неверный пароль/)
    await expect(section).toContainText('SMTP не задан')

    await ownPassword.fill(e2eOwner.password)
    await save.click()
    await expect(
      section.getByRole('status').filter({ hasText: 'Настройки SMTP сохранены' }),
    ).toBeVisible()
    // Форма собралась заново: поля паролей пустые, пароль SMTP «задан»
    await expect(section.getByLabel('Пароль SMTP', { exact: true })).toHaveValue('')
    await expect(section.getByLabel('Ваш пароль от админки')).toHaveValue('')
    await expect(page.getByRole('region', { name: 'Состояние' })).toContainText('localhost:587')

    // Письмо «Настройки почты изменены» ушло владельцу через очередь — уже по новым настройкам
    await expect
      .poll(() => smtp.received.map((mail) => subjectOf(mail.raw)), { timeout: 15_000 })
      .toContain('Настройки почты Averra CMS изменены')
    expect(smtp.logins.every((login) => login.secure)).toBe(true)

    await page.reload()
    const saved = page.getByRole('region', { name: 'Настройки SMTP' })
    await expect(saved).toContainText('Настройки SMTP заданы здесь, в админке')
    await expect(saved.locator('dt:text-is("Пароль") + dd')).toHaveText('задан')
    await expect(saved.locator('dt:text-is("Проверка подключения") + dd')).toContainText('пройдена')
    const passwordField = saved.getByLabel('Пароль SMTP', { exact: true })
    await expect(passwordField).toHaveValue('')
    await expect(passwordField).toHaveAccessibleDescription(/Пароль задан/)
    expect(await page.content()).not.toContain(SMTP_PASSWORD)

    // Проверка с сохранённым паролем (поле пустое): только по сохранённым настройкам и только
    // на свою почту — пароля владельца она не просит
    const checks = () =>
      smtp.received.filter((mail) => subjectOf(mail.raw) === 'Проверка почты Averra CMS').length
    const check = saved.getByRole('button', { name: 'Проверить подключение' })
    await check.click()
    await expect(saved.getByText('Подключение работает')).toBeVisible({ timeout: 20_000 })
    expect(checks()).toBe(2)
    const toField = saved.getByLabel('Куда отправить проверочное письмо')
    await toField.fill('someone@e2e.test')
    await check.click()
    await expect(toField).toHaveAccessibleDescription(
      /Чтобы проверить другой адрес, введите пароль SMTP/,
    )
    await expect(toField).toHaveAttribute('aria-invalid', 'true')
    expect(checks()).toBe(2)

    // «Удалить настройки» — тоже с паролем владельца и после подтверждения: почта снова
    // файловый ящик e2e
    const dialogs = answerDialogs(page, [true])
    await saved.getByLabel('Ваш пароль от админки').fill(e2eOwner.password)
    await saved.getByRole('button', { name: 'Удалить настройки' }).click()
    await expect(
      saved.getByRole('status').filter({ hasText: 'Настройки SMTP удалены из админки' }),
    ).toBeVisible()
    expect(dialogs).toEqual([expect.stringContaining('Удалить настройки SMTP из админки?')])
    await expect(saved).toContainText('SMTP не задан')
    await expect(page.getByRole('region', { name: 'Состояние' })).toContainText('Файловый ящик')
  } finally {
    // Остальные e2e читают файловый ящик: SMTP из админки убираем, даже если тест упал.
    // Удалили уже на экране — 404
    const removed = await ownerApi.mail.smtp.$delete({
      json: { currentPassword: e2eOwner.password },
    })
    expect([200, 404], 'удаление настроек SMTP после теста').toContain(removed.status)
    await smtp.close()
  }

  const texts = await Promise.all(bodies)
  expect(texts.length).toBeGreaterThan(5)
  for (const text of texts) {
    expect(text).not.toContain(SMTP_PASSWORD)
    expect(text).not.toContain(Buffer.from(SMTP_PASSWORD).toString('base64'))
  }
})
