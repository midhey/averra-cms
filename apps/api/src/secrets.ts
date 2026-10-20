// Случайные секреты и их хеши для ссылок и токенов: токены API, приглашения.
// Через Web Crypto, без Node API: модули работают и в API, и в командах терминала

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** 32 случайных байта в hex — секретная часть токена */
export const randomSecret = () => toHex(crypto.getRandomValues(new Uint8Array(32)))

/** SHA-256 в hex: в базе лежит он, а не сам токен */
export async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return toHex(new Uint8Array(digest))
}
