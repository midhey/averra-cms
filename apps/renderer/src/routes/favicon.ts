import type { APIRoute, GetStaticPaths } from 'astro'
import { iconFile, loadSnapshot } from '../lib/snapshot'

// favicon.ico из иконки сайта (делает API). Маршрут /[name].ico: без иконки файла нет совсем
export const getStaticPaths: GetStaticPaths = async () => {
  const { site } = await loadSnapshot()
  return site.settings.icon ? [{ params: { name: 'favicon' } }] : []
}

// В dev маршрут точный (/favicon.ico) и без параметра
export const GET: APIRoute = async ({ params }) => {
  const { site } = await loadSnapshot()
  if ((params.name ?? 'favicon') !== 'favicon' || !site.settings.icon) {
    return new Response('У сайта нет иконки', { status: 404 })
  }
  return iconFile(site.id, 'favicon.ico')
}
