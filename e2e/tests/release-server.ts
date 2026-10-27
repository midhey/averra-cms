import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'

// Собранный сайт из папки релиза (PUBLISH_DIR) — как его отдал бы Caddy: тесты сайта смотрят
// ровно то, что ушло бы посетителю

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  // Картинки и шрифты — с настоящим типом, как у Caddy: SVG с application/octet-stream Chrome в
  // <img> не покажет, и тест логотипа прошёл бы по рамке пустой картинки
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** Статический сервер папки релиза: /адрес → адрес/index.html, нет файла — 404.html */
export async function serveRelease(root: string) {
  const fileFor = async (path: string) => {
    const clean = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '')
    for (const candidate of [clean, join(clean, 'index.html')]) {
      const file = join(root, candidate)
      if (!file.startsWith(root)) return undefined
      if (existsSync(file) && (await stat(file)).isFile()) return file
    }
    return undefined
  }
  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      const file = await fileFor(path)
      const status = file ? 200 : 404
      const body = await readFile(file ?? join(root, '404.html'))
      res.writeHead(status, {
        'content-type': types[extname(file ?? '.html')] ?? 'application/octet-stream',
      })
      res.end(body)
    })().catch(() => {
      res.writeHead(500)
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() }
}
