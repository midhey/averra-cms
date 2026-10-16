// Сборка сайта для публикации на сервере (модуль 9). Её запускает API отдельным процессом
// (apps/api/src/publish/renderer.ts): так память сборки уходит вместе с процессом, а сбой
// или зависание сборки не роняют API.
//
// Вход — переменные окружения: CMS_SITE_ID, CMS_API_URL, AVERRA_OUT_DIR (папка, куда положить
// сайт) и AVERRA_CACHE_DIR (кеш сборщика). CMS_LINKS=relative ставит сам API: ссылки на картинки
// и формы — от корня сайта. Последняя строка stdout — JSON с пиковой памятью процесса: API пишет
// её в журнал сборок, по ней видно, хватает ли VPS памяти
import { fileURLToPath } from 'node:url'
import { build } from 'astro'

const outDir = process.env.AVERRA_OUT_DIR
if (!outDir) {
  console.error('Не задан AVERRA_OUT_DIR — куда собирать сайт')
  process.exit(2)
}

await build({
  root: fileURLToPath(new URL('..', import.meta.url)),
  outDir,
  ...(process.env.AVERRA_CACHE_DIR ? { cacheDir: process.env.AVERRA_CACHE_DIR } : {}),
  logLevel: 'warn',
})

// maxRSS — в килобайтах (документация Node, process.resourceUsage)
const peakRssBytes = process.resourceUsage().maxRSS * 1024
process.stdout.write(`${JSON.stringify({ peakRssBytes })}\n`)
