import { MailLine } from '@averra/schema'
import { z } from 'zod'
import { html } from '../html'
import { details, note, paragraph } from '../layout'
import { defineMailTemplate } from './define'

const sentAtFormat = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
})

/** Кто отправил проверочное письмо */
const senders = {
  command: 'команда pnpm mail:test',
  admin: 'кнопка «Проверить подключение» на странице «Почта» в админке',
} as const

/** Проверочное письмо команды pnpm mail:test и кнопки «Проверить подключение» в админке */
export const mailTestTemplate = defineMailTemplate({
  id: 'mail-test',
  title: 'Проверка почты',
  description:
    'Уходит по команде pnpm mail:test и по кнопке «Проверить подключение» в админке, чтобы убедиться, что письма доходят',
  schema: z.strictObject({
    sentAt: z.iso.datetime({ offset: true }),
    // Провайдер без секретов: «SMTP smtp.yandex.ru:465 (TLS)…»
    provider: MailLine(300),
    // По умолчанию — команда: так письмо ставилось до настроек SMTP в админке
    via: z.enum(['command', 'admin']).default('command'),
  }),
  example: {
    sentAt: '2026-10-14T09:30:00.000Z',
    provider: 'SMTP smtp.example.ru:465 (TLS), вход noreply@example.ru',
  },
  render({ sentAt, provider, via }) {
    const when = `${sentAtFormat.format(new Date(sentAt))} по Москве`
    const intro =
      `Почта работает. Это проверочное письмо: его отправила ${senders[via]}, ` +
      'чтобы убедиться, что письма из Averra CMS доходят.'
    const spam =
      'Если письмо попало в спам, проверьте SPF, DKIM и DMARC домена отправителя — ' +
      'инструкция — https://midhey.github.io/averra-cms/install/mail/'
    return {
      subject: 'Проверка почты Averra CMS',
      preheader: 'Почта работает: письма из Averra CMS доходят',
      body: html`${paragraph(intro)}${details([
        ['Отправлено', when],
        ['Через', provider],
      ])}${note(spam)}`,
      text: `${intro}\n\nОтправлено: ${when}\nЧерез: ${provider}\n\n${spam}`,
    }
  },
})
