import { ATTRIBUTION_PREFIX, LeadAttribution, UTM_KEYS } from '@averra/schema'

function httpUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? '')
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url
  } catch {
    // Отсутствующий или некорректный адрес не мешает приёму заявки.
  }
  return undefined
}

export function leadAttribution(input: {
  raw: Record<string, string>
  origin: string | undefined
  referer: string | undefined
  requestUrl: string
  pagePath: string
}) {
  const { raw } = input
  const referer = httpUrl(input.referer)
  const origin = httpUrl(input.origin)?.origin ?? new URL(input.requestUrl).origin
  const sameSite = referer?.origin === origin ? referer : undefined
  const page = httpUrl(raw[`${ATTRIBUTION_PREFIX}page_url`])
  // Страница известна из маршрута формы; чужой адрес из скрытого поля не сохраняем.
  const pageUrl =
    page?.origin === origin ? `${page.origin}${page.pathname}` : `${origin}${input.pagePath}`
  const referrer = Object.hasOwn(raw, `${ATTRIBUTION_PREFIX}referrer`)
    ? httpUrl(raw[`${ATTRIBUTION_PREFIX}referrer`])
    : referer
  return LeadAttribution.parse({
    ...Object.fromEntries(
      UTM_KEYS.map((key) => [
        key,
        raw[`${ATTRIBUTION_PREFIX}${key}`] || sameSite?.searchParams.get(key) || '',
      ]),
    ),
    pageUrl,
    referrerDomain: referrer?.hostname ?? '',
  })
}
