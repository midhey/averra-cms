import {
  ATTRIBUTION_PREFIX,
  cleanAttributionValue,
  UTM_KEYS,
  UTM_MAX_LENGTH,
} from '@averra/schema/lead-attribution'

const STORAGE_KEY = 'averra_lead_attribution'

/** Метки живут в одной вкладке; недоступное хранилище не мешает обычному POST. */
export function startLeadAttribution(
  doc: Document = document,
  win: Window & typeof globalThis = window,
) {
  const url = new URL(win.location.href)
  let saved: unknown = {}
  try {
    saved = JSON.parse(win.sessionStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    // Хранилище может быть запрещено настройками браузера.
  }
  const previous =
    typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
  const current = UTM_KEYS.some((key) => url.searchParams.has(key))
  let referrerDomain = cleanAttributionValue(previous.referrerDomain, 253)
  try {
    const referrer = new URL(doc.referrer)
    if (referrer.origin !== url.origin && ['http:', 'https:'].includes(referrer.protocol)) {
      referrerDomain = referrer.hostname
    }
  } catch {
    // При прямом заходе Referer пуст.
  }
  const attribution = {
    tags: UTM_KEYS.map(
      (key) =>
        [
          key,
          cleanAttributionValue(
            current ? url.searchParams.get(key) : previous[key],
            UTM_MAX_LENGTH,
          ),
        ] as const,
    ),
    referrerDomain,
  }
  try {
    win.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...Object.fromEntries(attribution.tags), referrerDomain }),
    )
  } catch {
    // Метки текущей страницы всё равно попадут в форму.
  }

  function fill(form: HTMLFormElement) {
    const action = new URL(form.action, url)
    if (form.method.toLowerCase() !== 'post' || !action.pathname.startsWith('/api/forms/')) return
    const values = {
      ...Object.fromEntries(attribution.tags),
      page_url: `${url.origin}${url.pathname}`,
      referrer: attribution.referrerDomain ? `https://${attribution.referrerDomain}/` : '',
    }
    for (const [key, value] of Object.entries(values)) {
      const name = `${ATTRIBUTION_PREFIX}${key}`
      let input = form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)
      if (!input) {
        input = doc.createElement('input')
        input.type = 'hidden'
        input.name = name
        form.append(input)
      }
      input.value = value
    }
  }
  doc.querySelectorAll<HTMLFormElement>('form').forEach(fill)
  // Формы окон появляются после загрузки страницы; capture опережает их fetch-обработчик.
  doc.addEventListener(
    'submit',
    (event) => {
      const form = event.target
      if (form instanceof win.HTMLFormElement) fill(form)
    },
    true,
  )
}
