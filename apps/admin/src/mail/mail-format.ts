import type { InferResponseType } from 'hono/client'
import type { api } from '../api'

// Подписи экрана «Почта». Типы — из ответа API: поменяется ответ, перестанет компилироваться

/** Почта так, как её отдаёт API: состояние, настройки очереди, шаблоны */
export type MailData = InferResponseType<typeof api.mail.$get, 200>

type EnabledStatus = Extract<MailData['status'], { enabled: true }>

/** Состояние письма в очереди словами */
export const mailStatusLabels: Record<string, string> = {
  pending: 'Ждёт отправки',
  sending: 'Отправляется',
  sent: 'Отправлено',
  failed: 'Не отправлено',
}

export const mailStatusLabel = (status: string) => mailStatusLabels[status] ?? status

type Provider = EnabledStatus['provider']

/** Строки «подпись — значение» о провайдере. Пароля в ответе API нет, и здесь его быть не может */
export function providerDetails(provider: Provider): [string, string][] {
  const from: [string, string] = ['Отправитель', `${provider.from.name} <${provider.from.address}>`]
  switch (provider.kind) {
    case 'smtp':
      return [
        ['Провайдер', 'SMTP'],
        ['Сервер', `${provider.host}:${provider.port}`],
        [
          'Шифрование',
          provider.security === 'tls' ? 'TLS сразу (порт 465)' : 'STARTTLS, обязательный',
        ],
        ['Вход', provider.user],
        from,
      ]
    case 'file':
      return [
        ['Провайдер', 'Файловый ящик: письма не уходят наружу'],
        ['Папка', provider.dir],
        from,
      ]
    case 'memory':
      return [['Провайдер', 'Письма в памяти (тесты)'], from]
  }
}

/** Склонение: 1 попытка, 2 попытки, 5 попыток */
export function attemptsLabel(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} попытка`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} попытки`
  return `${count} попыток`
}

/** Как долго хранятся письма: «30 дней» */
export function daysLabel(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} день`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} дня`
  return `${count} дней`
}
