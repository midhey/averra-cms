import { MailLine, MailUrl } from '@averra/schema'
import { z } from 'zod'
import { html } from '../html'
import { button, note, paragraph } from '../layout'
import { defineMailTemplate, formatDays } from './define'

const roles = {
  editor: 'редактор: правите и публикуете страницы',
  client: 'клиент: правите черновики, а публикует редактор',
} as const

/** Приглашение участника на сайт. Ставит в очередь createInvitation (modules/invitations) */
export const invitationTemplate = defineMailTemplate({
  id: 'invitation',
  title: 'Приглашение на сайт',
  description: 'Уходит участнику, которого пригласили на сайт: по ссылке он принимает приглашение',
  schema: z.strictObject({
    inviterName: MailLine(100),
    siteName: MailLine(80),
    role: z.enum(['editor', 'client']),
    url: MailUrl,
    // Сколько живёт приглашение: по плану — 7 дней
    expiresInDays: z.int().min(1).max(30),
  }),
  example: {
    inviterName: 'Анна из Averra',
    siteName: 'Ремонт квартир под ключ',
    role: 'client',
    url: 'https://admin.example.ru/invite#token=example',
    expiresInDays: 7,
  },
  // В ссылке токен: в очереди он живёт до отправки и не дольше, чем само приглашение
  secret: { lifetimeMs: ({ expiresInDays }) => expiresInDays * 24 * 60 * 60 * 1000 },
  render({ inviterName, siteName, role, url, expiresInDays }) {
    const intro = `${inviterName} приглашает вас работать с сайтом «${siteName}» в Averra CMS.`
    const roleLine = `Ваша роль — ${roles[role]}.`
    const action = 'Чтобы принять приглашение, откройте ссылку:'
    // Письмо не знает, есть ли у адреса вход: это скажет экран по ссылке. Поэтому — оба случая
    const howTo =
      'Если входа в админку у вас ещё нет, по ссылке вы зададите имя и пароль. ' +
      'Если вход уже есть, войдите своим паролем и подтвердите доступ.'
    const expires = `Ссылка действует ${formatDays(expiresInDays)} и только один раз.`
    const ignore = 'Если вы не ждали приглашения, просто удалите письмо.'
    return {
      subject: `Приглашение на сайт «${siteName}» в Averra CMS`,
      preheader: `${inviterName} приглашает вас на сайт «${siteName}»`,
      body: html`${paragraph(intro)}${paragraph(roleLine)}${paragraph(action)}${button('Принять приглашение', url)}${note(howTo)}${note(expires)}${note(ignore)}`,
      text: `${intro}\n${roleLine}\n\n${action}\n${url}\n\n${howTo}\n${expires}\n${ignore}`,
    }
  },
})
