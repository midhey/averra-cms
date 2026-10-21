import type { APIRoute } from 'astro'
import { sitemapXml } from '../lib/seo'
import { loadSnapshot } from '../lib/snapshot'

// sitemap.xml: индексируемые опубликованные страницы (страница 404 и noindex — нет)
export const GET: APIRoute = async () => {
  const { site, pages } = await loadSnapshot()
  return new Response(sitemapXml(site, pages), {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  })
}
