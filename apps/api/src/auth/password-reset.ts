import { and, eq, like, lt } from 'drizzle-orm'
import type { Db } from '../db/client'
import { verifications } from '../db/schema'
import { enqueueMail } from '../mail/outbox'
import { toMailLine } from '../mail/templates/line'

// Сброс пароля по ссылке из письма. Эндпоинты — Better Auth (auth.ts), здесь то, чего он
// не делает сам: письмо через очередь, хеш токена в базе и «новый запрос сжигает старую ссылку»

/** Сколько живёт ссылка сброса: по плану — час. То же число уходит в письмо и в очередь */
export const PASSWORD_RESET_TTL_MINUTES = 60

/** Так Better Auth начинает идентификатор записи сброса: reset-password:<токен> */
export const RESET_IDENTIFIER_PREFIX = 'reset-password:'

/**
 * Так начинается идентификатор записи сброса в базе: reset-password#<SHA-256>. Разделитель
 * другой, чем у Better Auth (# вместо :), и это главное, см. hashVerificationIdentifier
 */
export const RESET_STORED_PREFIX = 'reset-password#'

const toBase64Url = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/**
 * Как Better Auth хранит идентификатор записи в verifications (verification.storeIdentifier).
 * По умолчанию он пишет его как есть, а в нём токен из ссылки: reset-password:<токен>.
 * Храним SHA-256 всего идентификатора, а открытым оставляем имя до двоеточия: по нему
 * находятся записи сброса пользователя, когда старые ссылки надо сжечь.
 *
 * Двоеточие в базе заменено на #, и в хеше (base64url) его тоже нет. Better Auth 1.7 со своим
 * хешером ищет и гасит запись дважды: сначала по хешу, а не нашёл — по идентификатору как
 * есть (запасной путь для записей, сохранённых до включения хеширования; см.
 * findVerificationValue и consumeVerificationValue в better-auth/dist/db/internal-adapter.mjs).
 * Будь в базе reset-password:<хеш>, хеш сам работал бы как токен: Better Auth собрал бы из него
 * reset-password:<хеш> и нашёл запись запасным поиском. Идентификаторы Better Auth всегда
 * с двоеточием, а в базе его нет — запасной поиск не находит ничего
 */
export async function hashVerificationIdentifier(identifier: string) {
  const colon = identifier.indexOf(':')
  const name = colon === -1 ? '' : identifier.slice(0, colon)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identifier))
  return `${name}#${toBase64Url(new Uint8Array(digest))}`
}

/**
 * Ссылка из письма: экран админки, токен — во фрагменте (#). Фрагмент браузер не шлёт
 * на сервер, поэтому токен не попадает в логи статики и прокси и в заголовок Referer
 */
export const passwordResetLink = (adminUrl: string, token: string) =>
  `${adminUrl}/reset-password#token=${encodeURIComponent(token)}`

/** Все записи сброса пароля пользователя — для команды смены пароля и тестов */
export const resetTokensOf = (userId: string) =>
  and(eq(verifications.value, userId), like(verifications.identifier, `${RESET_STORED_PREFIX}%`))

type ResetMail = {
  user: { id: string; name: string; email: string }
  /** Токен из Better Auth: в ссылку письма. В базе — только его хеш */
  token: string
  adminUrl: string
}

/**
 * Письмо со ссылкой сброса — в очередь, а прежние ссылки пользователя — в мусор, одной
 * транзакцией. Сжигаются записи, созданные раньше нынешней, а не «все, кроме нынешней»:
 * при двух одновременных запросах выживет последняя ссылка, а не ни одной
 */
export async function queuePasswordResetMail(db: Db, { user, token, adminUrl }: ResetMail) {
  const identifier = await hashVerificationIdentifier(`${RESET_IDENTIFIER_PREFIX}${token}`)
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ createdAt: verifications.createdAt })
      .from(verifications)
      .where(eq(verifications.identifier, identifier))
    if (current) {
      await tx
        .delete(verifications)
        .where(and(resetTokensOf(user.id), lt(verifications.createdAt, current.createdAt)))
    }
    await enqueueMail(tx, {
      template: 'password-reset',
      data: {
        name: toMailLine(user.name, 100, 'коллега'),
        url: passwordResetLink(adminUrl, token),
        expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
      },
      to: user.email,
    })
  })
}
