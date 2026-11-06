import type { APIRoute } from 'astro'
import { siteCspOf } from '../lib/scripts'
import { apiOrigin, loadSnapshot } from '../lib/snapshot'

// CSP сайта файлом релиза (_averra/csp.txt): Caddy домена сайта ставит её заголовком на каждый
// ответ (deploy/Caddyfile). Статическую выгрузку отдаёт другой веб-сервер — строку берут отсюда
export const GET: APIRoute = async () => {
  const { site } = await loadSnapshot()
  const csp = siteCspOf({
    analytics: site.settings.analytics,
    siteScript: site.script,
    apiOrigin: apiOrigin(),
  })
  return new Response(`${csp}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
