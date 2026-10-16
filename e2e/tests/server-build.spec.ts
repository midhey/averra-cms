import { existsSync } from 'node:fs'
import { readdir, readFile, readlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { demoPage, demoPageTitle, MAIN_PAGE_SLUG } from '@averra/schema'
import { publishDir } from '../urls'
import { demo, expect, sites, test } from './fixtures'

// Публикация на сервере (модуль 9): API e2e запущен с PUBLISH_DIR, как на VPS, и после публикации
// собирает сайт настоящим Astro в новую папку релиза и переключает на неё ссылку current — её
// отдаёт Caddy. Сам Caddy и Docker здесь не участвуют: их проверяет чек-лист живого VPS

const currentPage = (siteId: string) => join(publishDir, siteId, 'current', 'index.html')

async function servedHtml(siteId: string) {
  const file = currentPage(siteId)
  return existsSync(file) ? readFile(file, 'utf8') : ''
}

test('публикация собирает сайт в новую версию на сервере, экран сайта это показывает', async ({
  page,
  demoSite,
}) => {
  // Фикстура только что опубликовала демо-страницу: сборка уже в очереди или идёт
  await page.goto(`/sites/${demoSite.id}`)
  const section = page.getByRole('region', { name: 'Сайт на сервере' })
  await expect(section.getByText(/На сайте версия, собранная/)).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => servedHtml(demoSite.id), { timeout: 60_000 }).toContain(demo.heroTitle)

  // Новая публикация — новая папка релиза: сайт меняется, прежняя версия остаётся на диске
  const releasesDir = join(publishDir, demoSite.id, 'releases')
  const currentRelease = () => readlink(join(publishDir, demoSite.id, 'current'))
  const before = basename(await currentRelease())
  const param = { siteId: demoSite.id, slug: MAIN_PAGE_SLUG }
  const title = `Сборка на сервере ${Date.now()}`
  const blocks = demoPage.blocks.map((block) =>
    block.type === 'hero' ? { ...block, props: { ...block.props, title } } : block,
  )
  const saved = await sites[':siteId'].pages[':slug'].$put({
    param,
    json: { title: demoPageTitle, content: { blocks } },
  })
  expect(saved.status).toBe(200)
  expect((await sites[':siteId'].pages[':slug'].publish.$post({ param })).status).toBe(200)

  await expect.poll(() => servedHtml(demoSite.id), { timeout: 60_000 }).toContain(title)
  expect(basename(await currentRelease())).not.toBe(before)
  expect(await readdir(releasesDir)).toContain(before)
  // В версию попадает только то, на что ссылается страница: бандла React для островов нет
  const assets = await readdir(join(publishDir, demoSite.id, 'current', '_astro'))
  expect(assets.some((name) => name.endsWith('.css'))).toBe(true)
  expect(assets.filter((name) => name.endsWith('.js'))).toEqual([])

  // «Собрать заново» — ещё одна сборка, экран показывает её и затем новую версию
  await page.reload()
  await section.getByRole('button', { name: 'Собрать заново' }).click()
  await expect(section.getByText(/На сайте версия, собранная/)).toBeVisible({ timeout: 60_000 })
  await expect(section.getByRole('button', { name: 'Собрать заново' })).toBeEnabled({
    timeout: 60_000,
  })
})

test('упавшая сборка видна на экране сайта с причиной, а на сайте прежняя версия', async ({
  page,
  demoSite,
}) => {
  // Уронить настоящий Astro на демо-сайте нечем (схемы не пустят сломанную страницу), поэтому
  // ответ API о сборке подменяется. Что упавшая сборка не трогает сайт — тесты API (src/publish)
  await page.route(/\/api\/sites\/[^/]+\/build$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const live = {
      id: 'b1',
      status: 'succeeded',
      release: '20261016T080000Z-aaaaaa',
      error: null,
      peakRssBytes: 360 * 2 ** 20,
      requestedAt: '2026-10-16T08:00:00.000Z',
      startedAt: '2026-10-16T08:00:00.000Z',
      finishedAt: '2026-10-16T08:00:02.000Z',
    }
    await route.fulfill({
      json: {
        enabled: true,
        live,
        latest: {
          ...live,
          id: 'b2',
          status: 'failed',
          release: null,
          error: 'Сборка упала (код выхода 1):\n[ERROR] блок «hero» без заголовка',
          finishedAt: '2026-10-16T09:00:00.000Z',
        },
      },
    })
  })
  await page.goto(`/sites/${demoSite.id}`)
  const section = page.getByRole('region', { name: 'Сайт на сервере' })
  const alert = section.getByRole('alert')
  await expect(alert).toContainText('Последняя сборка упала')
  await expect(alert).toContainText('На сайте осталась прежняя версия')
  await expect(alert).toContainText('[ERROR] блок «hero» без заголовка')
  await expect(section).toContainText('сборка заняла 360 МБ памяти')
})
