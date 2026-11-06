import type { APIRoute, GetStaticPaths } from 'astro'
import { allScriptFiles } from '../lib/scripts'
import { loadSnapshot } from '../lib/snapshot'

// Свои скрипты сайта: /_scripts/<имя>.<хеш>.js (lib/scripts.ts). Сборка пишет скрипт сайта и
// скрипты опубликованных своих блоков; в dev — по запросу
async function files() {
  const { site, customBlocks } = await loadSnapshot()
  return allScriptFiles({ siteScript: site.script, customBlocks })
}

export const getStaticPaths: GetStaticPaths = async () =>
  (await files()).map((file) => ({ params: { file: file.name } }))

export const GET: APIRoute = async ({ params }) => {
  const file = (await files()).find((item) => item.name === params.file)
  if (!file) return new Response('Нет такого скрипта', { status: 404 })
  return new Response(file.content, {
    headers: { 'content-type': 'text/javascript; charset=utf-8' },
  })
}
