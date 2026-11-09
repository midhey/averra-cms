// Снимки двух сайтов для сравнения: исходного le-english и переноса на Averra, на 1440 и 375 px.
//   node compare/shoot.mjs <папка для снимков> <адрес оригинала> <адрес Averra>
// Снимает по частям: шапку (закрытую и с открытым меню), каждую секцию, подвал, наведение на
// кнопки, открытый вопрос, окно записи (и его успех после настоящей заявки), страницу записи и 404. Рядом с парой снимков кладёт
// склейку «оригинал | перенос» (pair-*.png) — её удобно смотреть глазами. Анимации выключены
// (reducedMotion), чтобы снимки были одинаковыми; поведение проверяют руками и тестами.
// Playwright берётся из пакета @averra/e2e, sharp — из зависимостей примера: отдельно их ставить
// не нужно.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

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

/** Части страниц: у оригинала и переноса свои селекторы, id секций совпадают */
const sites = {
  orig: {
    base: original,
    header: '.site-header',
    menu: '.mobile-menu summary',
    headerButton: '.site-header__cta',
    footer: '.site-footer',
    dialog: 'dialog.lead-dialog',
  },
  averra: {
    base: averra,
    header: '[data-site-header]',
    menu: '[data-site-header] summary',
    headerButton: '[data-site-header] a[href="/zapis/"]',
    footer: '[data-site-footer]',
    dialog: 'dialog[data-site-window]',
  },
}
const SECTIONS = ['top', 'goals', 'about', 'steps', 'reviews', 'prices', 'faq', 'signup']

/** Подготовка страницы: шрифты, отложенные картинки, без плавной прокрутки */
async function settle(page) {
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' })
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(300)
}

/** Снимок элемента; нет элемента — строка в лог, а не падение всего прогона */
async function shotOf(page, selector, file) {
  const element = page.locator(selector).first()
  if ((await element.count()) === 0 || !(await element.isVisible())) {
    console.log(`  нет ${selector} → ${file}`)
    return false
  }
  await element.scrollIntoViewIfNeeded()
  await element.screenshot({ path: join(out, file) })
  return true
}

const shots = []
const browser = await chromium.launch()
for (const size of sizes) {
  for (const [label, site] of Object.entries(sites)) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
      ...(size.width < 768 && { isMobile: true, hasTouch: true }),
    })
    const page = await context.newPage()
    const shoot = async (state, selector) => {
      const file = `${state}-${size.name}-${label}.png`
      if (await shotOf(page, selector, file)) shots.push({ state, size: size.name, label, file })
    }
    const open = async (path) => {
      await page.goto(site.base + path, { waitUntil: 'networkidle' })
      await settle(page)
    }

    await open('/')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    console.log(`${label} ${size.name}: горизонтальная прокрутка ${overflow}px`)
    await shoot('header', site.header)
    for (const id of SECTIONS) await shoot(`section-${id}`, `#${id}`)
    await shoot('footer', site.footer)
    // Открытый вопрос
    await page.locator('#faq summary').first().click()
    await page.waitForTimeout(500)
    await shoot('faq-open', '#faq')
    if (size.width < 768) {
      // Меню телефона открыто
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.locator(site.menu).first().click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(out, `menu-open-${size.name}-${label}.png`) })
      shots.push({
        state: 'menu-open',
        size: size.name,
        label,
        file: `menu-open-${size.name}-${label}.png`,
      })
      await page.keyboard.press('Escape')
    } else {
      // Наведение: кнопка шапки и кнопка первого экрана
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.locator(site.headerButton).first().hover()
      await page.waitForTimeout(400)
      await shoot('hover-header', site.header)
      await page.locator('#top a[href="/zapis/"]').first().hover()
      await page.waitForTimeout(400)
      await shoot('hover-hero', '#top a[href="/zapis/"]')
    }
    // Окно записи: клик по кнопке первого экрана
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('#top a[href="/zapis/"]').first().click()
    await page.waitForTimeout(700)
    const dialog = page.locator(`${site.dialog}[open]`)
    if ((await dialog.count()) > 0) {
      await page.screenshot({ path: join(out, `window-${size.name}-${label}.png`) })
      shots.push({
        state: 'window',
        size: size.name,
        label,
        file: `window-${size.name}-${label}.png`,
      })
      // Успех в окне: настоящая заявка (у оригинала — в его временную папку данных)
      await dialog.locator('input[name="name"]').fill('Боря')
      await dialog.locator('input[name="contact"]').fill('@borya_shot')
      await dialog.locator('input[name="consent"]').check()
      await dialog.locator('button[type="submit"]').click()
      await page.waitForTimeout(1500)
      await page.screenshot({ path: join(out, `window-sent-${size.name}-${label}.png`) })
      shots.push({
        state: 'window-sent',
        size: size.name,
        label,
        file: `window-sent-${size.name}-${label}.png`,
      })
    } else console.log(`  ${label} ${size.name}: окно не открылось, адрес ${page.url()}`)

    for (const [state, path] of [
      ['zapis', '/zapis/'],
      ['not-found', '/net-takoy-stranicy/'],
      ['privacy', '/privacy/'],
    ]) {
      await open(state === 'privacy' && label === 'orig' ? '/politika/' : path)
      const file = `${state}-${size.name}-${label}.png`
      await page.screenshot({ path: join(out, file) })
      shots.push({ state, size: size.name, label, file })
      console.log(`  ${label} ${state}: «${await page.title()}»`)
    }
    await context.close()
  }
}
await browser.close()

// Склейки «оригинал | перенос» одной высоты: по ним видно отличия без открытия двух файлов
const pairs = new Map()
for (const shot of shots) {
  const key = `${shot.state}-${shot.size}`
  pairs.set(key, { ...pairs.get(key), [shot.label]: shot.file })
}
for (const [key, pair] of pairs) {
  if (!pair.orig || !pair.averra) continue
  const images = await Promise.all(
    [pair.orig, pair.averra].map(async (file) => {
      const image = sharp(join(out, file))
      return { image, meta: await image.metadata(), file }
    }),
  )
  const height = Math.max(...images.map((one) => one.meta.height ?? 0))
  const gap = 16
  // Без масштаба: короткий снимок дополняется снизу белым до высоты длинного
  const parts = await Promise.all(
    images.map(({ file, meta }) =>
      sharp(join(out, file))
        .extend({ bottom: height - (meta.height ?? 0), background: '#ffffff' })
        .png()
        .toBuffer({ resolveWithObject: true }),
    ),
  )
  const width = parts.reduce((sum, part) => sum + part.info.width, gap)
  await sharp({ create: { width, height, channels: 3, background: '#ff00ff' } })
    .composite([
      { input: parts[0].data, left: 0, top: 0 },
      { input: parts[1].data, left: parts[0].info.width + gap, top: 0 },
    ])
    .png()
    .toFile(join(out, `pair-${key}.png`))
}
console.log(`Снимки и склейки: ${out}`)
