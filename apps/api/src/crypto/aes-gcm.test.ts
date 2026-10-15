import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { aesGcmSecretBox, KEY_BYTES, keyIdOf } from './aes-gcm'
import { parseSealed, SEALED_FORMAT, SecretBoxError } from './secret-box'

const CONTEXT = 'mail_settings.password:installation'
const PASSWORD = 'smtp-пароль-🙂-42'

const box = () => aesGcmSecretBox(randomBytes(KEY_BYTES))

/** Ошибка расшифровки и её причина */
function problemOf(run: () => unknown) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(SecretBoxError)
    return (error as SecretBoxError).problem
  }
  throw new Error('расшифровка должна была сломаться')
}

/** Меняет один бит в части записи (по байтам, а не по символам base64) */
function flipBit(sealed: string, part: 'iv' | 'tag' | 'ciphertext') {
  const parts = parseSealed(sealed)
  const bytes = Buffer.from(parts[part], 'base64url')
  bytes[0] = (bytes[0] ?? 0) ^ 0x01
  const changed = { ...parts, [part]: bytes.toString('base64url') }
  return ['v1', changed.keyId, changed.iv, changed.tag, changed.ciphertext].join('.')
}

describe('AES-256-GCM', () => {
  it('туда и обратно: строка возвращается как была', () => {
    const secretBox = box()
    for (const text of [PASSWORD, 'a', 'пароль с пробелами ', 'x'.repeat(256)]) {
      expect(secretBox.decrypt(secretBox.encrypt(text, CONTEXT), CONTEXT)).toBe(text)
    }
  })

  it('каждое шифрование — свой IV: одна и та же строка даёт разные записи', () => {
    const secretBox = box()
    const sealed = Array.from({ length: 20 }, () => secretBox.encrypt(PASSWORD, CONTEXT))
    expect(new Set(sealed).size).toBe(20)
    expect(new Set(sealed.map((item) => parseSealed(item).iv)).size).toBe(20)
    expect(new Set(sealed.map((item) => parseSealed(item).ciphertext)).size).toBe(20)
  })

  it('запись — формат под проверку базы, без пароля и его base64', () => {
    const sealed = box().encrypt(PASSWORD, CONTEXT)
    expect(sealed).toMatch(SEALED_FORMAT)
    expect(sealed).not.toContain(PASSWORD)
    expect(sealed).not.toContain(Buffer.from(PASSWORD).toString('base64'))
    expect(sealed).not.toContain(Buffer.from(PASSWORD).toString('base64url'))
  })

  it('другой ключ — ошибка «ключ не тот», а не мусор', () => {
    const sealed = box().encrypt(PASSWORD, CONTEXT)
    expect(problemOf(() => box().decrypt(sealed, CONTEXT))).toBe('wrong_key')
  })

  it('чужая запись с подставленной версией ключа не расшифруется: проверка целостности', () => {
    const other = box()
    const target = box()
    const parts = parseSealed(other.encrypt(PASSWORD, CONTEXT))
    const forged = ['v1', target.keyId, parts.iv, parts.tag, parts.ciphertext].join('.')
    expect(problemOf(() => target.decrypt(forged, CONTEXT))).toBe('corrupted')
  })

  it.each(['ciphertext', 'tag', 'iv'] as const)('подменённый %s — ошибка', (part) => {
    const secretBox = box()
    const sealed = secretBox.encrypt(PASSWORD, CONTEXT)
    expect(problemOf(() => secretBox.decrypt(flipBit(sealed, part), CONTEXT))).toBe('corrupted')
  })

  it('укороченный тег, обрезанная запись и мусор — ошибка формата', () => {
    const secretBox = box()
    const sealed = secretBox.encrypt(PASSWORD, CONTEXT)
    const parts = parseSealed(sealed)
    const shortTag = Buffer.from(parts.tag, 'base64url').subarray(0, 12).toString('base64url')
    for (const broken of [
      ['v1', parts.keyId, parts.iv, shortTag, parts.ciphertext].join('.'),
      sealed.slice(0, sealed.lastIndexOf('.')),
      `v2${sealed.slice(2)}`,
      PASSWORD,
      '',
    ]) {
      expect(
        problemOf(() => secretBox.decrypt(broken, CONTEXT)),
        broken,
      ).toBe('format')
    }
  })

  it('неканоническая запись base64 той же части — ошибка формата, а не второе написание', () => {
    const secretBox = box()
    const parts = parseSealed(secretBox.encrypt(PASSWORD, CONTEXT))
    // 22 символа base64url — это 132 бита, байтов в теге 16: младшие 4 бита последнего
    // символа в байты не входят. Меняем их, и строка другая, а байты те же
    const last = parts.tag.at(-1) ?? 'A'
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const twin = alphabet[alphabet.indexOf(last) ^ 0x01] ?? 'A'
    const sameBytes = `${parts.tag.slice(0, -1)}${twin}`
    expect(Buffer.from(sameBytes, 'base64url').equals(Buffer.from(parts.tag, 'base64url'))).toBe(
      true,
    )
    const sealed = ['v1', parts.keyId, parts.iv, sameBytes, parts.ciphertext].join('.')
    expect(problemOf(() => secretBox.decrypt(sealed, CONTEXT))).toBe('format')
  })

  it('другой контекст (AAD) — ошибка: запись не переставить в другое поле', () => {
    const secretBox = box()
    const sealed = secretBox.encrypt(PASSWORD, CONTEXT)
    expect(problemOf(() => secretBox.decrypt(sealed, 'mail_settings.password:site:1'))).toBe(
      'corrupted',
    )
  })

  it('версия ключа — отпечаток: один ключ — одна версия, ключа по ней не видно', () => {
    const key = randomBytes(KEY_BYTES)
    expect(aesGcmSecretBox(key).keyId).toBe(keyIdOf(key))
    expect(aesGcmSecretBox(key).keyId).toMatch(/^[0-9a-f]{16}$/)
    expect(aesGcmSecretBox(randomBytes(KEY_BYTES)).keyId).not.toBe(keyIdOf(key))
    expect(key.toString('hex')).not.toContain(keyIdOf(key))
  })

  it('ключ — ровно 32 байта; пустой секрет не шифруется', () => {
    expect(() => aesGcmSecretBox(randomBytes(16))).toThrow('32 байта')
    expect(() => aesGcmSecretBox(randomBytes(33))).toThrow('32 байта')
    expect(() => box().encrypt('', CONTEXT)).toThrow()
  })

  it('текст ошибки не содержит ни записи, ни пароля', () => {
    const sealed = box().encrypt(PASSWORD, CONTEXT)
    try {
      box().decrypt(sealed, CONTEXT)
    } catch (error) {
      expect(String(error)).not.toContain(sealed)
      expect(String(error)).not.toContain(PASSWORD)
    }
  })
})
