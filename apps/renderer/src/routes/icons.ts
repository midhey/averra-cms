import type { APIRoute, GetStaticPaths } from 'astro'
import { ICON_FILES, iconFile, loadSnapshot } from '../lib/snapshot'

// PNG-иконки сайта: apple-touch-icon.png, icon-192.png и icon-512.png (делает API).
// Маршрут /[icon].png: без иконки в «SEO» сборка их не пишет
export const getStaticPaths: GetStaticPaths = async () => {
  const { site } = await loadSnapshot()
  return site.settings.icon ? ICON_FILES.map((icon) => ({ params: { icon } })) : []
}

const isIconFile = (name: string | undefined): name is (typeof ICON_FILES)[number] =>
  ICON_FILES.some((file) => file === name)

// В dev маршруты точные (/icon-192.png): имя иконки — из адреса
export const GET: APIRoute = async ({ params, url }) => {
  const { site } = await loadSnapshot()
  const icon = params.icon ?? url.pathname.slice(1).replace(/\.png$/, '')
  if (!isIconFile(icon) || !site.settings.icon) {
    return new Response('Нет такой иконки', { status: 404 })
  }
  return iconFile(site.id, `${icon}.png`)
}
