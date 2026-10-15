import { isLoopbackHost } from '../loopback'
import type { MailStatus } from './mailer'

// Ссылки из писем (сброс пароля, приглашения) ведут в админку — на ADMIN_URL. Если это адрес
// этого компьютера, а письма уходят по SMTP наружу, адресат ссылку не откроет: почти наверняка
// забыли ADMIN_URL на сервере. Правило одно для команды и API, а поступают они по-разному.
// pnpm member:invite отказывает до записи в базу (cli/common.ts): её запускают ради одного
// письма. API не отказывает, а предупреждает — при старте в лог и на странице «Почта»: в pnpm dev
// SMTP бывает настроен нарочно, чтобы проверить настоящую доставку себе, и сброс пароля
// разработчика ломать незачем. Без Node API: модуль подключают маршруты

/** ADMIN_URL — адрес этого компьютера (localhost, 127.x.x.x, *.localhost, [::1]) */
export const isLocalAdminUrl = (adminUrl: string) => isLoopbackHost(new URL(adminUrl).hostname)

/** Что сказать владельцу, если ссылки из писем по SMTP ведут на localhost. Иначе null */
export function localLinkWarning(adminUrl: string, status: MailStatus): string | null {
  if (!status.enabled || status.provider.kind !== 'smtp' || !isLocalAdminUrl(adminUrl)) return null
  return (
    `Ссылки в письмах (сброс пароля, приглашения) ведут на ${adminUrl} — адрес этого ` +
    'компьютера, а письма уходят по SMTP: адресат на другом компьютере такую ссылку не откроет. ' +
    'На сервере задайте ADMIN_URL — адрес админки снаружи — и перезапустите API'
  )
}
