// Секреты, которые приходится хранить в базе (пароль SMTP из админки), — только зашифрованными.
// Здесь интерфейс и формат записи без Node API: их видят маршруты, а типы маршрутов читает
// админка. Реализация на node:crypto — aes-gcm.ts, её подключают index.ts и testing.ts

/**
 * Шифрование секретов для базы. Запись самоописывающая: версия формата, версия ключа, IV, тег
 * и шифротекст. Расшифровать её можно только тем же ключом и с тем же контекстом
 */
export type SecretBox = {
  /** Версия ключа (отпечаток): по ней видно, тем ли ключом зашифрована запись */
  readonly keyId: string
  /**
   * Шифрует строку. context — к чему относится секрет (идёт в AAD): запись, переставленная
   * в другое поле или к другому сайту, не расшифруется
   */
  encrypt(plaintext: string, context: string): string
  /** Расшифровывает запись encrypt. Не вышло — SecretBoxError, а не мусор */
  decrypt(sealed: string, context: string): string
}

/**
 * Почему не расшифровалось: format — это не наша запись, wrong_key — зашифровано другим
 * ключом (сменили MAIL_ENCRYPTION_KEY), corrupted — запись подменена или повреждена
 */
export type SecretBoxProblem = 'format' | 'wrong_key' | 'corrupted'

const problemMessages: Record<SecretBoxProblem, string> = {
  format: 'Запись секрета в базе не в том формате',
  wrong_key: 'Секрет зашифрован другим ключом',
  corrupted: 'Секрет в базе повреждён или подменён: проверка целостности не прошла',
}

/** Ошибка расшифровки. В тексте нет ни секрета, ни записи из базы */
export class SecretBoxError extends Error {
  override name = 'SecretBoxError'
  constructor(readonly problem: SecretBoxProblem) {
    super(problemMessages[problem])
  }
}

/**
 * Формат записи: v1.<версия ключа, 16 hex>.<IV, 12 байт>.<тег, 16 байт>.<шифротекст>, части —
 * base64url без «=». Та же проверка стоит в базе (CHECK у mail_settings): открытый пароль
 * база не примет даже по ошибке в коде
 */
export const SEALED_FORMAT =
  /^v1\.([0-9a-f]{16})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]+)$/

/** Части записи. Не наш формат — SecretBoxError('format') */
export function parseSealed(sealed: string) {
  const match = SEALED_FORMAT.exec(sealed)
  if (!match) throw new SecretBoxError('format')
  const [, keyId = '', iv = '', tag = '', ciphertext = ''] = match
  return { keyId, iv, tag, ciphertext }
}
