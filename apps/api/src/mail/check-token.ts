// Итог успешной «Проверки подключения» для сохранения: «Сохранить» без «без проверки»
// принимается, только если ровно эти настройки (вместе с паролем) этот же владелец проверил
// недавно. Токен — время проверки и HMAC от владельца, времени и настроек. Ключ HMAC случайный
// и живёт в памяти процесса: перезапуск API делает старые токены недействительными, и это
// не страшно — проверку просто повторяют. Web Crypto, без Node API: модуль подключают маршруты

/** Сколько живёт итог проверки: за это время его надо сохранить */
export const CHECK_TOKEN_TTL_MS = 15 * 60 * 1000

/** Что проверили: настройки после схемы и пароль, которым входили (новый или сохранённый) */
export type CheckedSettings = {
  host: string
  port: number
  security: string
  user: string
  password: string
  fromAddress: string
  fromName: string
}

const encoder = new TextEncoder()

/** Что подписываем: версия формата, владелец, время и настройки — массивом, в одном порядке */
const payload = (userId: string, checkedAt: number, settings: CheckedSettings) =>
  encoder.encode(
    JSON.stringify([
      'averra-cms/smtp-check/v1',
      userId,
      checkedAt,
      settings.host,
      settings.port,
      settings.security,
      settings.user,
      settings.password,
      settings.fromAddress.toLowerCase(),
      settings.fromName,
    ]),
  )

const toBase64Url = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
    char.charCodeAt(0),
  )

const TOKEN_FORMAT = /^(\d{1,16})\.([A-Za-z0-9_-]{43})$/

export function createCheckTokens({
  ttlMs = CHECK_TOKEN_TTL_MS,
  now = () => Date.now(),
}: {
  ttlMs?: number
  now?: () => number
} = {}) {
  const key = crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])

  return {
    /** Токен успешной проверки этих настроек этим владельцем */
    async issue(userId: string, settings: CheckedSettings) {
      const checkedAt = now()
      const signature = await crypto.subtle.sign(
        'HMAC',
        await key,
        payload(userId, checkedAt, settings),
      )
      return `${checkedAt}.${toBase64Url(new Uint8Array(signature))}`
    },

    /**
     * Когда прошла проверка, если токен выдан этому владельцу для ровно этих настроек и ещё
     * не устарел. Иначе undefined: настройки поменяли после проверки, токен чужой или подделан
     */
    async verify(token: string, userId: string, settings: CheckedSettings) {
      const match = TOKEN_FORMAT.exec(token)
      if (!match) return undefined
      const checkedAt = Number(match[1])
      const age = now() - checkedAt
      if (!(age >= 0 && age < ttlMs)) return undefined
      // verify Web Crypto сравнивает подпись сам и за постоянное время
      const valid = await crypto.subtle.verify(
        'HMAC',
        await key,
        fromBase64Url(match[2] ?? ''),
        payload(userId, checkedAt, settings),
      )
      return valid ? new Date(checkedAt) : undefined
    },
  }
}

export type CheckTokens = ReturnType<typeof createCheckTokens>
