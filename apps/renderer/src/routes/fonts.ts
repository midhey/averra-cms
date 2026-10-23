import { readFile } from 'node:fs/promises'
import type { APIRoute, GetStaticPaths } from 'astro'
import { siteFontFiles } from '../lib/fonts'
import { loadSnapshot } from '../lib/snapshot'

// Шрифты темы со своего сервера: /_fonts/<файл>-<хеш>.woff2. Сборка пишет только начертания
// темы сайта — у темы на системных шрифтах файлов нет вовсе
export const getStaticPaths: GetStaticPaths = async () => {
  const { site } = await loadSnapshot()
  return (await siteFontFiles(site.theme)).map((file) => ({ params: { file: file.name } }))
}

export const GET: APIRoute = async ({ params }) => {
  const { site } = await loadSnapshot()
  const file = (await siteFontFiles(site.theme)).find((item) => item.name === params.file)
  if (!file) return new Response('Нет такого шрифта', { status: 404 })
  return new Response(new Uint8Array(await readFile(file.path)), {
    headers: { 'content-type': 'font/woff2' },
  })
}
