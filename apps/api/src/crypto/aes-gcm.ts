import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { parseSealed, type SecretBox, SecretBoxError } from './secret-box'

// AES-256-GCM на node:crypto: шифрование с проверкой целостности. Подмена шифротекста, тега
// или IV ломает расшифровку, а не даёт мусор. IV — случайный на каждое шифрование: повтор IV
// с тем же ключом в GCM раскрывает данные

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

/** Длина ключа AES-256: 32 байта */
export const KEY_BYTES = 32

/**
 * Версия ключа — отпечаток, а не сам ключ: HMAC от постоянной строки, первые 8 байт в hex.
 * По нему при ротации выбирают ключ из связки, а пока — отличают «ключ не тот» от повреждённой
 * записи. Узнать ключ по отпечатку нельзя
 */
export function keyIdOf(key: Uint8Array) {
  return createHmac('sha256', key)
    .update('averra-cms/mail-encryption-key-id')
    .digest('hex')
    .slice(0, 16)
}

/**
 * Часть записи из base64url — только в каноническом виде. Иначе у одной записи было бы
 * несколько написаний (младшие биты последнего символа base64 не входят в байты)
 */
function decodePart(part: string, bytes?: number) {
  const decoded = Buffer.from(part, 'base64url')
  if (decoded.toString('base64url') !== part) throw new SecretBoxError('format')
  if (bytes !== undefined && decoded.length !== bytes) throw new SecretBoxError('format')
  return decoded
}

/** Шифрование секретов ключом из MAIL_ENCRYPTION_KEY (32 байта) */
export function aesGcmSecretBox(key: Uint8Array): SecretBox {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Ключ AES-256-GCM — ${KEY_BYTES} байта, а не ${key.length}`)
  }
  const secret = Buffer.from(key)
  const keyId = keyIdOf(secret)

  return {
    keyId,
    encrypt(plaintext, context) {
      if (plaintext.length === 0) throw new Error('Пустой секрет не шифруем')
      const iv = randomBytes(IV_BYTES)
      // authTagLength задан явно и при расшифровке: иначе Node принял бы укороченный тег
      const cipher = createCipheriv(ALGORITHM, secret, iv, { authTagLength: TAG_BYTES })
      cipher.setAAD(Buffer.from(context, 'utf8'))
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return [
        'v1',
        keyId,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.')
    },
    decrypt(sealed, context) {
      const parts = parseSealed(sealed)
      if (parts.keyId !== keyId) throw new SecretBoxError('wrong_key')
      const iv = decodePart(parts.iv, IV_BYTES)
      const tag = decodePart(parts.tag, TAG_BYTES)
      const ciphertext = decodePart(parts.ciphertext)
      try {
        const decipher = createDecipheriv(ALGORITHM, secret, iv, { authTagLength: TAG_BYTES })
        decipher.setAAD(Buffer.from(context, 'utf8'))
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
      } catch {
        // Текст ошибки OpenSSL ничего полезного не добавит, а запись в лог не нужна
        throw new SecretBoxError('corrupted')
      }
    },
  }
}
