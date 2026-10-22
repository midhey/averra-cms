import type { NotificationChannelKind } from '@averra/schema'
import type { MailDeps } from '../modules/mail/routes'
import type { ChannelRegistry } from './channel'
import type { NotifyDeps } from './notify'
import type { TelegramApiFactory } from './telegram/api'

/**
 * Уведомления в зависимостях API: каналы, HTTP-клиент Telegram (для проверки токена и «Проверить»)
 * и как разбудить обработчики. Создаёт index.ts (testing.ts — свои)
 */
export type NotificationDeps = {
  channels: ChannelRegistry
  telegram: TelegramApiFactory
  /**
   * Разбудить обработчик очереди уведомлений. resetPauses: true — поменяли настройки каналов
   * (паузы всех не в счёт), вид канала — он прошёл «Проверить» (снять его паузу)
   */
  wake: (resetPauses?: boolean | NotificationChannelKind) => void
  /** Выдан код привязки чата: начать опрос Telegram */
  bind: () => void
  /** Почему привязка чатов сейчас не работает (опрос Telegram не удался) или null */
  bindProblem: () => string | null
}

/** Что нужно ядру сейчас: каналы, ключ секретов (общий с паролем SMTP) и состояние почты */
export function notifyDepsOf(mail: MailDeps, notifications: NotificationDeps): NotifyDeps {
  const status = mail.runtime.status()
  return {
    channels: notifications.channels,
    secretBox: mail.runtime.secretBox,
    readiness: {
      mailEnabled: status.enabled,
      mailReason: status.enabled ? null : status.reason,
    },
  }
}
