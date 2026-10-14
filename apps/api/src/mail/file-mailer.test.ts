import { randomUUID } from 'node:crypto'
import { readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type FileMail, fileMailer } from './file-mailer'
import { MailSendError } from './mailer'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function mailbox() {
  const dir = join(tmpdir(), `cms-test-mail-${randomUUID()}`)
  dirs.push(dir)
  return {
    dir,
    mailer: fileMailer({ dir, from: { address: 'noreply@averra.test', name: 'Averra CMS' } }),
  }
}

describe('файловый ящик', () => {
  it('кладёт письмо парой .eml и .json, папка создаётся сама', async () => {
    const { dir, mailer } = mailbox()
    const { messageId } = await mailer.send({
      to: 'anna@example.ru',
      subject: 'Проверка почты',
      html: '<p>Привет</p>',
      text: 'Привет',
      replyTo: 'visitor@example.ru',
    })
    const files = (await readdir(dir)).sort()
    expect(files).toHaveLength(2)
    const json = files.find((file) => file.endsWith('.json')) as string
    const mail = JSON.parse(await readFile(join(dir, json), 'utf8')) as FileMail
    expect(mail).toMatchObject({
      messageId,
      to: 'anna@example.ru',
      replyTo: 'visitor@example.ru',
      subject: 'Проверка почты',
      text: 'Привет',
      from: { address: 'noreply@averra.test', name: 'Averra CMS' },
    })
    const eml = await readFile(join(dir, mail.eml), 'utf8')
    expect(eml).toContain('From: Averra CMS <noreply@averra.test>')
    expect(eml).toContain('To: anna@example.ru')
    expect(eml).toContain('Reply-To: visitor@example.ru')
    expect(eml).toContain(`Message-ID: ${messageId}`)
  })

  it('перевод строки в теме — ошибка, файлов нет', async () => {
    const { dir, mailer } = mailbox()
    await expect(
      mailer.send({ to: 'anna@example.ru', subject: 'a\nBcc: x@y.ru', html: 'x', text: 'x' }),
    ).rejects.toBeInstanceOf(MailSendError)
    await expect(readdir(dir)).rejects.toThrow()
  })
})
