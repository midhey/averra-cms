import { randomUUID } from 'node:crypto'
import { readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MailConfig } from '../config'
import type { FileMail } from './file-mailer'
import { sendTestMail } from './send-test-mail'
import { createTestCa, issueServerCert, startTestSmtpServer, type TestCa } from './testing/smtp'

// pnpm mail:test без запуска процесса: то же, что делает команда, но с явным CA тестового сервера

const common = { maxAttempts: 8, retentionDays: 30 }
const from = { address: 'noreply@averra.test', name: 'Averra CMS' }

let ca: TestCa
let cert: { key: string; cert: string }
const cleanup: (() => Promise<void>)[] = []

beforeAll(async () => {
  ca = await createTestCa()
  cert = await issueServerCert(ca)
})
afterAll(async () => {
  for (const run of cleanup) await run()
})

function printer() {
  const lines: string[] = []
  return { lines, print: (line: string) => lines.push(line) }
}

describe('pnpm mail:test', () => {
  it('почта выключена — объясняет, что задать, и не отправляет', async () => {
    const { lines, print } = printer()
    const mail: MailConfig = {
      ...common,
      transport: 'off',
      reason: 'Почта не настроена: задай SMTP_HOST…',
    }
    expect(await sendTestMail(mail, 'anna@example.ru', print)).toBe(false)
    expect(lines).toEqual(['Почта не настроена: задай SMTP_HOST…'])
  })

  it('файловый ящик — письмо «Проверка почты» в папке и путь к ней', async () => {
    const dir = join(tmpdir(), `cms-test-mail-${randomUUID()}`)
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const { lines, print } = printer()
    expect(
      await sendTestMail({ ...common, transport: 'file', dir, from }, 'anna@example.ru', print),
    ).toBe(true)

    const json = (await readdir(dir)).find((file) => file.endsWith('.json')) as string
    const mail = JSON.parse(await readFile(join(dir, json), 'utf8')) as FileMail
    expect(mail).toMatchObject({ to: 'anna@example.ru', subject: 'Проверка почты Averra CMS' })
    expect(lines.at(-1)).toContain('лежит в файловом ящике')
  })

  it('SMTP — по шагам, пароль не печатается ни на одном', async () => {
    const password = 'smtp-secret-password'
    const smtp = await startTestSmtpServer({ mode: 'tls', cert })
    cleanup.push(smtp.close)
    const { lines, print } = printer()
    const mail: MailConfig = {
      ...common,
      transport: 'smtp',
      host: 'localhost',
      port: smtp.port,
      security: 'tls',
      user: 'noreply@averra.test',
      password,
      from,
    }
    expect(await sendTestMail(mail, 'anna@example.ru', print, { ca: ca.cert })).toBe(true)
    expect(lines.map((line) => line.split(':')[0])).toEqual([
      'Почта',
      '✓ DNS',
      '✓ Соединение',
      '✓ TLS',
      '✓ Вход',
      '✓ Отправка',
      'Готово',
    ])
    expect(lines.join('\n')).not.toContain(password)
    expect(smtp.received[0]?.raw).toContain('Subject: =?UTF-8?')

    // Неверный пароль: шаг «Вход» с крестиком, пароля в выводе нет
    const wrong = printer()
    const badPassword = 'wrong-password-42'
    expect(
      await sendTestMail({ ...mail, password: badPassword }, 'anna@example.ru', wrong.print, {
        ca: ca.cert,
      }),
    ).toBe(false)
    expect(wrong.lines.at(-1)).toMatch(/^✗ Вход: Сервер не принял логин или пароль/)
    expect(wrong.lines.join('\n')).not.toContain(badPassword)
  })
})
