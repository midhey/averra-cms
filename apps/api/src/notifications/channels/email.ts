import { MailAddress } from '@averra/schema'
import { z } from 'zod'
import { enqueueMail } from '../../mail/outbox'
import type { ChannelConfig, NotificationChannel, ReadinessContext } from '../channel'
import { mailOverrideOf, renderNotification } from '../events'

// Почта как канал уведомлений — поверх существующей почты: письмо ставится в её очередь
// (mail_outbox) в той же транзакции, а уходит обработчиком писем с его повторами, выжиданием
// и «Повторить» на странице «Почта». Своей отправки у канала нет

function ready(config: ChannelConfig, { mailEnabled, mailReason }: ReadinessContext) {
  if (!config.enabled) {
    return { ok: false as const, reason: 'Почта выключена в разделе «Уведомления»' }
  }
  if (!mailEnabled) return { ok: false as const, reason: mailReason ?? 'Почта установки выключена' }
  return { ok: true as const }
}

export const emailChannel: NotificationChannel = {
  kind: 'email',
  title: 'Почта',
  address: MailAddress.transform((address) => address.toLowerCase()),
  // Своих настроек и секрета нет: сервер, пароль и отправитель — у почты установки
  settings: z.object({}),
  label: ({ address }) => address,
  describe: () => null,
  defaultEnabled: true,
  // Письмо «почта не работает» не дойдёт тем же путём, который сломан
  skips: ['mail.down'],
  ready,
  async check(config, { readiness, user, queueTest }) {
    const state = ready(config, readiness)
    if (!state.ok)
      return { ok: false, steps: [{ step: 'Почта', ok: false, message: state.reason }] }
    // Письмо себе через очередь писем: дошло ли — видно в ящике и в разделе «Почта»
    const queued = await queueTest([user.email])
    return {
      ok: queued > 0,
      steps: [
        queued > 0
          ? {
              step: 'Письмо',
              ok: true,
              message: `Проверочное письмо поставлено в очередь на ${user.email}: дошло ли — видно в ящике и в разделе «Почта»`,
            }
          : {
              step: 'Письмо',
              ok: false,
              message: 'Письмо не поставлено: канал сейчас не работает',
            },
      ],
    }
  },
  async enqueue({ tx, now, siteId, leadId }, { event, data }, targets) {
    // У события может быть своё письмо (заявка — с Reply-To посетителя), иначе — общее «Уведомление»
    const mail = mailOverrideOf(event, data) ?? {
      template: 'notification' as const,
      data: renderNotification(event, data),
    }
    for (const target of targets) {
      await enqueueMail(
        tx,
        // Шаблон и данные проверит схема шаблона в enqueueMail: событие и письмо не разойдутся
        { template: mail.template, data: mail.data as never, to: target.address, siteId, leadId },
        now,
      )
    }
  },
}
