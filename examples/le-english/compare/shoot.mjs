// Снимки двух сайтов для сравнения: исходного le-english и переноса на Averra, на 1440 и 375 px.
//   node compare/shoot.mjs <папка для снимков> <адрес оригинала> <адрес Averra>
// Playwright берётся из пакета @averra/e2e: отдельно его ставить не нужно.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', '..', '..', 'e2e', 'package.json'))
const { chromium } = require('@playwright/test')

const [out, original, averra] = process.argv.slice(2)
if (!out || !original || !averra) {
  console.error('Нужно: <папка снимков> <адрес оригинала> <адрес Averra>')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

const sizes = [
  { name: '1440', width: 1440, height: 900 },
  { name: '375', width: 375, height: 812 },
]
const pages = [
  { name: 'home', original: '/', averra: '/' },
  { name: 'zapis', original: '/zapis/', averra: '/zapis/' },
]

const browser = await chromium.launch()
for (const size of sizes) {
  for (const [label, base, key] of [
    ['orig', original, 'original'],
    ['averra', averra, 'averra'],
  ]) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    for (const item of pages) {
      await page.goto(base + item[key], { waitUntil: 'networkidle' })
      await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' })
      await page.evaluate(() => document.fonts.ready)
      // Отложенные картинки: прокрутка до низа, чтобы они загрузились
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y)
          await new Promise((resolve) => setTimeout(resolve, 60))
        }
        window.scrollTo(0, 0)
      })
      await page.waitForTimeout(300)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      console.log(`${label} ${item.name} ${size.name}: горизонтальная прокрутка ${overflow}px`)
      await page.screenshot({
        path: join(out, `${item.name}-${size.name}-${label}.png`),
        fullPage: true,
      })
    }
    await context.close()
  }
}
await browser.close()
