import { findRedirect, redirectLocation } from '@averra/schema'
import type { APIRoute, GetStaticPaths } from 'astro'
import { needsOgCard } from '../lib/seo'
import { loadSnapshot, ogCardFile } from '../lib/snapshot'

// Карточки для соцсетей из заголовка (/og/<адрес>.png, рисует API) — только у страниц без своей
// картинки и без картинки сайта: на них ссылается og:image (lib/seo.ts). Остальным файл не нужен
export const getStaticPaths: GetStaticPaths = async () => {
  const { site, pages } = await loadSnapshot()
  return pages
    .filter((page) => needsOgCard(site, page))
    .map((page) => ({ params: { slug: page.slug } }))
}

export const GET: APIRoute = async ({ params, url, redirect }) => {
  const { site, pages } = await loadSnapshot()
  const page = pages.find((candidate) => candidate.slug === params.slug)
  if (page && needsOgCard(site, page)) return ogCardFile(site.id, page.slug)
  // При сборке сюда не попасть: собираются только карточки из getStaticPaths. В dev — как на
  // сервере, где файла нет: редирект из таблицы «SEO» или страница 404 сайта
  const to = findRedirect(site.settings.redirects, url.pathname)
  if (to) return redirect(redirectLocation(to, url.search), 301)
  // Страница 404 сайта — у самого dev-сервера (маршрут /404): rewrite() из эндпоинта на страницу
  // Astro в dev отвечает 500
  const notFound = await fetch(new URL('/404', url))
  return new Response(await notFound.text(), {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
