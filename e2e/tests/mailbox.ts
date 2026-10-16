import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

// Файловый ящик e2e: API в учебном режиме кладёт каждое письмо в e2e/.data/mail парой файлов,
// .eml и .json (см. apps/api/src/mail/file-mailer.ts). Тесты читают .json — как человек письмо

const mailDir = fileURLToPath(new URL('../.data/mail/', import.meta.url))

export type E2eMail = {
  to: string
  subject: string
  text: string
  html: string
  createdAt: string
  /** Куда ответить: у письма о заявке — посетитель */
  replyTo?: string
}

async function readMails(): Promise<E2eMail[]> {
  const names = await readdir(mailDir).catch(() => [] as string[])
  const mails: E2eMail[] = []
  for (const name of names.filter((file) => file.endsWith('.json'))) {
    // Файл мог появиться, но ещё не дописаться: такой пропускаем до следующего опроса
    const mail = await readFile(join(mailDir, name), 'utf8')
      .then((text) => JSON.parse(text) as E2eMail)
      .catch(() => undefined)
    if (mail) mails.push(mail)
  }
  return mails
}

/**
 * Ждёт письмо этому адресу с такой темой и возвращает самое свежее. Письмо уходит из очереди
 * обработчиком API: после действия он просыпается сразу, но на это нужно время
 */
export async function waitForMail(to: string, subject: string) {
  let found: E2eMail | undefined
  await expect(async () => {
    const mails = (await readMails())
      .filter((mail) => mail.to === to && mail.subject === subject)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    found = mails.at(-1)
    expect(found, `письмо «${subject}» для ${to}`).toBeDefined()
  }).toPass({ timeout: 15_000 })
  if (!found) throw new Error(`Нет письма «${subject}» для ${to}`)
  return found
}

/** Ссылка из текста письма на экран админки: …/invite#token=… или …/reset-password#token=… */
export function linkFrom(mail: E2eMail, screen: 'invite' | 'reset-password') {
  const match = new RegExp(String.raw`https?://\S+/${screen}#token=\S+`).exec(mail.text)
  if (!match) throw new Error(`В письме «${mail.subject}» нет ссылки на /${screen}`)
  return match[0]
}
