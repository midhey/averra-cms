import type { APIRoute } from 'astro'
import { robotsTxt } from '../lib/seo'
import { loadSnapshot } from '../lib/snapshot'

// robots.txt сайта: при сборке — файл в корне релиза, в dev — по запросу (astro.config.mjs)
export const GET: APIRoute = async () => {
  const { site } = await loadSnapshot()
  return new Response(robotsTxt(site), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
