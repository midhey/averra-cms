import type { APIRoute, GetStaticPaths } from 'astro'
import { webManifest } from '../lib/seo'
import { loadSnapshot } from '../lib/snapshot'

// manifest.webmanifest — только у сайта с иконкой: манифест без иконок браузеру не нужен.
// Маршрут /[name].webmanifest, чтобы без иконки сборка не писала файл вовсе
export const getStaticPaths: GetStaticPaths = async () => {
  const { site } = await loadSnapshot()
  return site.settings.icon ? [{ params: { name: 'manifest' } }] : []
}

// В dev маршрут точный (/manifest.webmanifest) и без параметра
export const GET: APIRoute = async ({ params }) => {
  const { site } = await loadSnapshot()
  if ((params.name ?? 'manifest') !== 'manifest' || !site.settings.icon) {
    return new Response('Нет манифеста: у сайта нет иконки', { status: 404 })
  }
  return new Response(webManifest(site), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8' },
  })
}
