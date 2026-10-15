import { MailLine, MailUrl } from '@averra/schema'
import { z } from 'zod'
import { html } from '../html'
import { button, note, paragraph } from '../layout'
import { defineMailTemplate, formatMinutes } from './define'

/** Сброс пароля админки. Ставит в очередь sendResetPassword (auth/password-reset.ts) */
export const passwordResetTemplate = defineMailTemplate({
  id: 'password-reset',
  title: 'Сброс пароля',
  description: 'Уходит пользователю админки, который нажал «Забыли пароль?»',
  schema: z.strictObject({
    name: MailLine(100),
    url: MailUrl,
    // Сколько живёт ссылка: по плану — час
    expiresInMinutes: z
      .int()
      .min(1)
      .max(24 * 60),
  }),
  example: {
    name: 'Анна',
    url: 'https://admin.example.ru/reset-password#token=example',
    expiresInMinutes: 60,
  },
  // В ссылке токен: в очереди он живёт до отправки и не дольше, чем сама ссылка
  secret: { lifetimeMs: ({ expiresInMinutes }) => expiresInMinutes * 60 * 1000 },
  render({ name, url, expiresInMinutes }) {
    const greeting = `Здравствуйте, ${name}!`
    const intro =
      'Кто-то (надеемся, вы) попросил сбросить пароль от админки Averra CMS. ' +
      'Чтобы задать новый пароль, откройте ссылку:'
    const expires = `Ссылка работает ${formatMinutes(expiresInMinutes)} и только один раз.`
    const ignore = 'Если вы не просили сброс, просто удалите письмо: пароль останется прежним.'
    return {
      subject: 'Сброс пароля в Averra CMS',
      preheader: 'Ссылка, чтобы задать новый пароль',
      body: html`${paragraph(greeting)}${paragraph(intro)}${button('Задать новый пароль', url)}${note(expires)}${note(ignore)}`,
      text: `${greeting}\n\n${intro}\n${url}\n\n${expires}\n${ignore}`,
    }
  },
})
