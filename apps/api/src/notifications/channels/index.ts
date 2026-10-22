import type { ChannelRegistry } from '../channel'
import type { TelegramApiFactory } from '../telegram/api'
import { emailChannel } from './email'
import { telegramChannel } from './telegram'

/**
 * Все каналы уведомлений. Новый канал — адаптер рядом (интерфейс NotificationChannel в
 * ../channel.ts), строка здесь и вид канала в NotificationChannelKind (@averra/schema). Сетевое
 * (HTTP-клиент) приходит параметром: этот файл видят маршруты, Node API в нём нет
 */
export function createChannels({ telegram }: { telegram: TelegramApiFactory }): ChannelRegistry {
  return {
    email: emailChannel,
    telegram: telegramChannel(telegram),
  }
}
