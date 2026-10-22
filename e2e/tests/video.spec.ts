import { randomUUID } from 'node:crypto'
import { VIDEO_URL_MESSAGE } from '@averra/schema'
import type { Browser } from '@playwright/test'
import { urls } from '../urls'
import { editor, expect, sites, test } from './fixtures'

// Блок «Видео»: редактор добавляет ролик и публикует страницу, посетитель видит обложку и ссылку,
// а плеер появляется только по клику. Запросы к площадкам перехватываются: наружу тест не ходит,
// но видно, когда и что страница у них попросила

const YT = 'aqz-KE-bpKQ'
const TITLE = 'Ремонт кухни за две недели'

/** Всё, что ведёт к YouTube: плеер, обложки, видеопоток, короткие ссылки */
const YOUTUBE =
  /^https:\/\/([^/]+\.)?(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com|youtu\.be)\//

/** Посетитель в своём браузере: запросы к YouTube записываются и получают пустую страницу */
async function visitor(browser: Browser, options: { javaScriptEnabled?: boolean } = {}) {
  const context = await browser.newContext({ locale: 'ru-RU', ...options })
  const requested: string[] = []
  await context.route(YOUTUBE, (route) => {
    requested.push(route.request().url())
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Плеер</title>',
    })
  })
  return { context, requested }
}

test('видео: добавить в редакторе, опубликовать, на сайте обложка, по клику — плеер', async ({
  page,
  browser,
  demoSite,
}) => {
  const slug = `video-${randomUUID().slice(0, 8)}`
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug, title: 'Как мы работаем', template: 'hero' },
  })
  expect(created.status, 'создание страницы').toBe(201)

  const ed = editor(page)
  await ed.open(slug)
  await ed.addBlock('Видео')
  await expect(ed.inspector.getByRole('heading', { name: 'Видео' })).toBeVisible()

  // Чужая ссылка — ошибка у поля, сохранить нельзя
  const url = ed.field('Ссылка на ролик')
  await url.fill('https://example.com/video.mp4')
  await expect(url).toHaveAttribute('aria-invalid', 'true')
  await expect(ed.inspector).toContainText(VIDEO_URL_MESSAGE)
  await expect(ed.saveButton).toBeDisabled()

  await url.fill(`https://youtu.be/${YT}?si=share`)
  await expect(url).not.toHaveAttribute('aria-invalid')
  await ed.field('Заголовок').fill(TITLE)
  await ed.field('Подпись под роликом · необязательно').fill('Снято на объекте в Твери')

  // Предпросмотр — те же компоненты: обложка-ссылка, без плеера
  await expect(
    ed.preview.getByRole('link', { name: `Смотреть на YouTube: ${TITLE}` }),
  ).toBeVisible()
  await expect(ed.preview.locator('iframe')).toHaveCount(0)

  await ed.publishButton.click()
  await expect(ed.status).toHaveText('Опубликовано. Обнови сайт, чтобы увидеть')

  // Посетитель: до клика — обложка и ссылка, ни iframe, ни одного запроса к YouTube
  const viewer = await visitor(browser)
  const site = await viewer.context.newPage()
  await site.goto(`${urls.renderer}/${slug}`)
  const cover = site.getByRole('link', { name: `Смотреть на YouTube: ${TITLE}` })
  await expect(cover).toBeVisible()
  await expect(cover).toHaveAttribute('href', `https://www.youtube.com/watch?v=${YT}`)
  await expect(site.getByText('Снято на объекте в Твери')).toBeVisible()
  await expect(site.locator('iframe')).toHaveCount(0)
  // Место под ролик — 16:9 заранее
  const box = await cover.boundingBox()
  expect(box && Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02)
  await site.waitForLoadState('networkidle')
  expect(viewer.requested).toEqual([])

  // Клик — плеер youtube-nocookie на месте обложки, новая вкладка не открывается
  await cover.click()
  const player = site.locator('iframe')
  await expect(player).toHaveAttribute(
    'src',
    `https://www.youtube-nocookie.com/embed/${YT}?autoplay=1`,
  )
  await expect(player).toHaveAttribute('title', TITLE)
  await expect(player).toHaveAttribute('sandbox', /allow-scripts/)
  await expect(cover).toHaveCount(0)
  await expect
    .poll(() => viewer.requested)
    .toContain(`https://www.youtube-nocookie.com/embed/${YT}?autoplay=1`)
  expect(viewer.context.pages()).toHaveLength(1)
  const playerBox = await player.boundingBox()
  expect(playerBox?.height).toBeCloseTo(box?.height ?? 0, 0)
  await viewer.context.close()

  // Без JavaScript — та же ссылка на ролик, страница рабочая
  const plain = await visitor(browser, { javaScriptEnabled: false })
  const noJs = await plain.context.newPage()
  await noJs.goto(`${urls.renderer}/${slug}`)
  const link = noJs.getByRole('link', { name: `Смотреть на YouTube: ${TITLE}` })
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(noJs.locator('iframe')).toHaveCount(0)
  expect(plain.requested).toEqual([])
  await plain.context.close()
})
