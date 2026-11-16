// Отдельный вход без Zod: модуль сайта остаётся маленьким, правила очистки общие с API.
export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const
export const ATTRIBUTION_PREFIX = '_av_'
export const UTM_MAX_LENGTH = 200

export function cleanAttributionValue(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return /[\p{Cc}\p{Zl}\p{Zp}]/u.test(trimmed) ? '' : trimmed.slice(0, max)
}
