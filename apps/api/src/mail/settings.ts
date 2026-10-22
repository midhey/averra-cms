import { isNull } from 'drizzle-orm'
import type { Db } from '../db/client'
import { mailSettings } from '../db/schema'
import type { DbOrTx } from './outbox'

// Настройки SMTP из админки: одна строка на всю установку (site_id IS NULL). Без Node API:
// репозиторий нужен и маршрутам, и почте процесса (runtime.ts). Пароль лежит только
// зашифрованным и наружу не отдаётся никогда: маршруты отдают view без него (smtp-service.ts)

/**
 * Контекст шифрования пароля (AAD): к чему он относится. Запись, переставленная в строку сайта
 * (потом, с формами), не расшифруется. У сайта контекст будет свой:
 * mail_settings.password:site:<id>
 */
export const MAIL_PASSWORD_CONTEXT = 'mail_settings.password:installation'

/** Строка настроек как она лежит в базе — с зашифрованным паролем. Только для сервера */
export type StoredMailSettings = typeof mailSettings.$inferSelect

/** Настройки, которые сохраняет владелец: пароль уже зашифрован */
export type MailSettingsValues = {
  host: string
  port: number
  security: 'tls' | 'starttls'
  user: string
  passwordEncrypted: string
  fromAddress: string
  fromName: string
  verifiedAt: Date | null
  /** Кто сохранил. null — не пользователь (тест, будущая команда) */
  updatedBy: string | null
}

const installation = isNull(mailSettings.siteId)

export function mailSettingsRepo(db: Db) {
  return {
    /** Настройки всей установки или undefined, если в админке SMTP не задан */
    async get(): Promise<StoredMailSettings | undefined> {
      const [row] = await db.select().from(mailSettings).where(installation)
      return row
    },

    /**
     * Сохраняет настройки установки тем объектом базы или транзакции, что передали: вместе
     * с ними в очередь ложится письмо владельцам. Строка одна (уникальность site_id с NULLS NOT
     * DISTINCT), поэтому повторное сохранение её обновляет
     */
    async save(tx: DbOrTx, values: MailSettingsValues, now: Date) {
      const row = {
        host: values.host,
        port: values.port,
        security: values.security,
        username: values.user,
        passwordEncrypted: values.passwordEncrypted,
        fromAddress: values.fromAddress,
        fromName: values.fromName,
        verifiedAt: values.verifiedAt,
        updatedBy: values.updatedBy,
        updatedAt: now,
      }
      await tx
        .insert(mailSettings)
        .values({ ...row, siteId: null, createdAt: now })
        .onConflictDoUpdate({ target: mailSettings.siteId, set: row })
    },

    /** Удаляет настройки установки. false — их и не было */
    async remove(tx: DbOrTx) {
      const deleted = await tx
        .delete(mailSettings)
        .where(installation)
        .returning({ id: mailSettings.id })
      return deleted.length > 0
    },
  }
}

/** Поля настроек словами: для лога и письма «Настройки почты изменены». Значений в них нет */
export const mailSettingsFieldLabels = {
  host: 'сервер',
  mode: 'порт и шифрование',
  user: 'логин',
  password: 'пароль',
  fromAddress: 'адрес отправителя',
  fromName: 'имя отправителя',
} as const

export type MailSettingsField = keyof typeof mailSettingsFieldLabels

/** Что задано в настройках, кроме пароля: так их сравнивают до и после сохранения */
export type MailSettingsShape = {
  host: string
  port: number
  security: 'tls' | 'starttls'
  user: string
  fromAddress: string
  fromName: string
}

/**
 * Какие поля поменялись. Нет прежних настроек — заданы все. Пароль сравнивает вызывающий
 * (у него есть и новый, и расшифрованный прежний): passwordChanged
 */
export function changedFields(
  previous: MailSettingsShape | undefined,
  next: MailSettingsShape,
  passwordChanged: boolean,
): MailSettingsField[] {
  if (!previous) return Object.keys(mailSettingsFieldLabels) as MailSettingsField[]
  const changed: MailSettingsField[] = []
  if (previous.host !== next.host) changed.push('host')
  if (previous.port !== next.port || previous.security !== next.security) changed.push('mode')
  if (previous.user !== next.user) changed.push('user')
  if (passwordChanged) changed.push('password')
  if (previous.fromAddress.toLowerCase() !== next.fromAddress.toLowerCase()) {
    changed.push('fromAddress')
  }
  if (previous.fromName !== next.fromName) changed.push('fromName')
  return changed
}

/** Строка в базе → те же поля, что в форме (username в базе — user в API) */
export const shapeOf = (row: StoredMailSettings): MailSettingsShape => ({
  host: row.host,
  port: row.port,
  security: row.security,
  user: row.username,
  fromAddress: row.fromAddress,
  fromName: row.fromName,
})
