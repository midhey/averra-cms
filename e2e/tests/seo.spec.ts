import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import sharp from 'sharp'
import { publishDir, urls } from '../urls'
import { answerDialogs, editor, expect, ownerApi, sidebar, sites, test } from './fixtures'

// Раздел «SEO»: владелец заполняет настройки сайта в админке, сайт пересобирается на «сервере»
// (PUBLISH_DIR, как на VPS) — и в собранной версии нужные теги, robots.txt, sitemap.xml, иконки и
// страница 404. Редиректы и 404 в dev-рендерере — тем же правилом, что у Caddy с API

/** Файл текущей версии сайта на диске («сервер» e2e); нет — пустая строка */
async function served(siteId: string, file: string) {
  const path = join(publishDir, siteId, 'current', file)
  return existsSync(path) ? readFile(path, 'utf8') : ''
}

/** Картинка в медиатеке демо-сайта через API: квадрат для иконки или баннер для соцсетей */
async function uploadImage(siteId: string, width: number, height: number) {
  return (await uploadMedia(siteId, width, height)).name
}

/** То же, но с id картинки — для SEO страницы, которую сохраняют через API */
async function uploadMedia(siteId: string, width: number, height: number) {
  const name = `seo-${randomUUID().slice(0, 8)}.png`
  const data = await sharp({ create: { width, height, channels: 4, background: '#2f5bea' } })
    .png()
    .toBuffer()
  const res = await sites[':siteId'].media.$post({
    param: { siteId },
    form: { file: new File([new Uint8Array(data)], name, { type: 'image/png' }) },
  })
  expect(res.status, 'загрузка картинки').toBe(201)
  const created = res.status === 201 ? await res.json() : undefined
  return { name, id: created?.id ?? '' }
}

/** Карточка раздела «SEO» по заголовку и её «Сохранить» */
function card(page: Page, title: string) {
  const region = page.getByRole('region', { name: title })
  return {
    region,
    field: (label: string) => region.getByLabel(label, { exact: true }),
    save: async (done: RegExp) => {
      await region.getByRole('button', { name: /^Сохранить/ }).click()
      await expect(region.getByRole('status')).toHaveText(done)
    },
    /** Выбрать картинку из медиатеки в поле карточки */
    pick: async (legend: string, file: string) => {
      await region
        .getByRole('group', { name: legend })
        .getByRole('button', { name: /Выбрать картинку|Заменить/ })
        .click()
      const dialog = page.getByRole('dialog', { name: /^Медиатека/ })
      await dialog.getByRole('button', { name: new RegExp(`^Выбрать «${file}»`) }).click()
      await expect(dialog).toBeHidden()
      await expect(region.getByRole('group', { name: legend })).toContainText(file)
    },
  }
}

test('владелец заполняет SEO, сайт пересобирается — в версии на сервере теги, файлы и 404', async ({
  page,
  demoSite,
}) => {
  test.slow()
  const icon = await uploadImage(demoSite.id, 512, 512)
  const banner = await uploadImage(demoSite.id, 1200, 630)

  // Пункт панели — у владельца
  await page.goto('/')
  await expect(page.getByText('Сайт скрыт от поисковиков')).toBeVisible()
  await sidebar(page).section('SEO').click()
  await expect(page).toHaveURL('/seo')
  await expect(page.getByRole('heading', { level: 1, name: 'SEO' })).toBeVisible()

  const general = card(page, 'Основное')
  await general.field('Шаблон заголовка страницы').fill('%s — Ремонт у Ивана')
  await expect(general.region).toContainText('«Цены — Ремонт у Ивана»')
  await general.field('Описание по умолчанию').fill('Ремонт квартир под ключ в Твери')
  await general.pick('Картинка для соцсетей', banner)
  await general.save(/Основное сохранено/)

  // Ошибка схемы — у поля, и фокус на нём
  const verification = card(page, 'Проверка в поисковиках')
  await verification.field('Яндекс Вебмастер').fill('"><script>')
  await verification.region.getByRole('button', { name: 'Сохранить' }).click()
  await expect(verification.field('Яндекс Вебмастер')).toBeFocused()
  await expect(verification.region).toContainText('латиница, цифры, _ и -')
  await verification
    .field('Яндекс Вебмастер')
    .fill('<meta name="yandex-verification" content="0a1b2c3d4e5f6a7b" />')
  await verification.save(/Коды сохранены/)
  await expect(verification.field('Яндекс Вебмастер')).toHaveValue('0a1b2c3d4e5f6a7b')

  const iconCard = card(page, 'Иконка сайта')
  await iconCard.pick('Иконка', icon)
  await iconCard.save(/Иконка сохранена/)

  const analytics = card(page, 'Аналитика')
  await analytics.field('Номер счётчика Яндекс Метрики').fill('98765432')
  await analytics.save(/Счётчики сохранены/)

  const organization = card(page, 'Организация')
  await organization.field('Название').fill('ООО «Ремонт у Ивана»')
  await organization.field('Телефон').fill('+7 900 123-45-67')
  await organization.save(/Организация сохранена/)

  const redirects = card(page, 'Редиректы')
  await redirects.region.getByRole('button', { name: 'Добавить редирект' }).click()
  await redirects.field('Откуда').fill('/old-price')
  await redirects.field('Куда').fill('/')
  await redirects.save(/Редиректы сохранены/)

  // Открыть сайт поисковикам — последним: обзор перестаёт напоминать
  const indexing = card(page, 'Индексация')
  await indexing.field('Скрыть сайт от поисковиков').uncheck()
  await indexing.save(/Сайт открыт поисковикам/)
  await expect(page.getByText('Сайт открыт поисковикам', { exact: true })).toBeVisible()

  // Версия на «сервере»: последняя сборка — со всеми настройками
  await expect
    .poll(() => served(demoSite.id, 'index.html'), { timeout: 90_000 })
    .toContain('ym(98765432,"init"')
  await expect
    .poll(() => served(demoSite.id, 'index.html'), { timeout: 90_000 })
    .not.toContain('noindex')
  const index = await served(demoSite.id, 'index.html')
  expect(index).toMatch(/^<!DOCTYPE html><html lang="ru">/)
  expect(index).toContain('<meta name="description" content="Ремонт квартир под ключ в Твери">')
  expect(index).toContain(`<link rel="canonical" href="${urls.renderer}/">`)
  expect(index).toContain('<meta name="yandex-verification" content="0a1b2c3d4e5f6a7b">')
  expect(index).toMatch(/<meta property="og:image" content="[^"]+\/media\/[0-9a-f-]+\/1200\.png">/)
  expect(index).toContain('<link rel="icon" href="/favicon.ico"')
  expect(index).toContain('"@type":"Organization","name":"ООО «Ремонт у Ивана»"')
  expect(index).toContain('https://mc.yandex.ru/watch/98765432')

  const robots = await served(demoSite.id, 'robots.txt')
  expect(robots).toContain('Disallow: /api/')
  expect(robots).toContain(`Sitemap: ${urls.renderer}/sitemap.xml`)
  expect(await served(demoSite.id, 'sitemap.xml')).toContain(`<loc>${urls.renderer}/</loc>`)
  expect(await served(demoSite.id, 'manifest.webmanifest')).toContain('"/icon-512.png"')
  const ico = await readFile(join(publishDir, demoSite.id, 'current', 'favicon.ico'))
  expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0])
  // Картинка для соцсетей — в версии на сервере, как картинки страниц
  const ogPath = /\/media\/([0-9a-f-]+\/1200\.png)/.exec(index)?.[1] ?? ''
  expect(existsSync(join(publishDir, demoSite.id, 'current', 'media', ogPath))).toBe(true)

  // Страница 404 — в корне версии, скрыта от поисковиков, по шаблону заголовка
  const notFound = await served(demoSite.id, '404.html')
  expect(notFound).toContain('<title>Страница не найдена — Ремонт у Ивана</title>')
  expect(notFound).toContain('<meta name="robots" content="noindex">')

  // Адрес без файла на сервере: Caddy спрашивает API — редирект или страница 404 версии
  const redirect = await fetch(`${urls.api}/api/site/fallback/old-price`, { redirect: 'manual' })
  expect(redirect.status).toBe(301)
  expect(redirect.headers.get('location')).toBe('/')
  const missing = await fetch(`${urls.api}/api/site/fallback/nothing-here`)
  expect(missing.status).toBe(404)
  expect(await missing.text()).toContain('Страница не найдена — Ремонт у Ивана')

  // Dev-рендерер — то же правило
  const devRedirect = await fetch(`${urls.renderer}/old-price/`, { redirect: 'manual' })
  expect(devRedirect.status).toBe(301)
  expect(devRedirect.headers.get('location')).toBe('/')
  const devMissing = await fetch(`${urls.renderer}/nothing-here`)
  expect(devMissing.status).toBe(404)
  expect(await devMissing.text()).toContain('Страница не найдена')
  expect((await fetch(`${urls.renderer}/robots.txt`)).status).toBe(200)
})

test('новый сайт скрыт от поисковиков, а без счётчиков на сайте нет ни одного скрипта', async ({
  demoSite,
}) => {
  // Сброс фикстуры вернул настройки нового сайта и опубликовал главную
  await expect
    .poll(() => served(demoSite.id, 'robots.txt'), { timeout: 90_000 })
    .toBe('User-agent: *\nDisallow: /\n')
  await expect
    .poll(() => served(demoSite.id, 'index.html'), { timeout: 90_000 })
    .toContain('<meta name="robots" content="noindex, nofollow">')
  const index = await served(demoSite.id, 'index.html')
  expect(index).not.toContain('<script')
  expect(index).not.toContain('canonical')
  expect(await served(demoSite.id, 'sitemap.xml')).not.toContain('<url>')
  // Иконки не выбраны — файлов иконок в версии нет
  expect(existsSync(join(publishDir, demoSite.id, 'current', 'favicon.ico'))).toBe(false)
  // Стандартная страница 404 есть всегда
  expect(await served(demoSite.id, '404.html')).toContain('Страница не найдена')
})

test('описание и noindex страницы — в редакторе; такой страницы нет в карте сайта', async ({
  page,
  demoSite,
}) => {
  const opened = await sites[':siteId'].settings.$patch({
    param: { siteId: demoSite.id },
    json: { hideFromSearch: false },
  })
  expect(opened.status).toBe(200)
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug: 'spasibo', title: 'Спасибо', template: 'hero' },
  })
  expect(created.status).toBe(201)

  const ed = editor(page)
  await ed.open('spasibo')
  await page.getByRole('button', { name: /^SEO/ }).click()
  const panel = page.getByRole('complementary', { name: 'SEO страницы' })
  await panel.getByLabel('Описание').fill('Заявка получена — перезвоним за 15 минут')
  await panel.getByLabel('Скрыть страницу от поисковиков').check()
  await ed.publishButton.click()
  await expect(ed.status).toHaveText(/Опубликовано/)

  const html = await (await fetch(`${urls.renderer}/spasibo`)).text()
  expect(html).toContain(
    '<meta name="description" content="Заявка получена — перезвоним за 15 минут">',
  )
  expect(html).toContain('<meta name="robots" content="noindex">')
  const sitemap = await (await fetch(`${urls.renderer}/sitemap.xml`)).text()
  expect(sitemap).toContain(`<loc>${urls.renderer}/</loc>`)
  expect(sitemap).not.toContain('spasibo')
})

test('несохранённая правка в карточке — пометка и вопрос перед уходом с экрана', async ({
  page,
}) => {
  const dialogs = answerDialogs(page, [false, true])
  await page.goto('/seo')
  const general = card(page, 'Основное')
  const mark = general.region.getByText('Не сохранено')
  await expect(general.field('Описание по умолчанию')).toBeVisible()
  await expect(mark).toBeHidden()
  await general.field('Описание по умолчанию').fill('Черновое описание')
  await expect(mark).toBeVisible()

  // «Отмена» — остаёмся с правкой, «ОК» — уходим без неё
  await sidebar(page).section('Обзор').click()
  await expect(page).toHaveURL('/seo')
  await expect(general.field('Описание по умолчанию')).toHaveValue('Черновое описание')
  await sidebar(page).section('Обзор').click()
  await expect(page).toHaveURL('/')
  expect(dialogs).toEqual([
    expect.stringMatching(/несохранённые правки/),
    expect.stringMatching(/несохранённые правки/),
  ])
})

test('адрес сайта набирается по буквам: экран жив, ошибка схемы — у поля', async ({ page }) => {
  await page.goto('/seo')
  const general = card(page, 'Основное')
  const url = general.field('Адрес сайта')
  // Каждая буква — недописанный адрес («h», «exa…»): сниппет не должен ронять экран
  await url.pressSequentially('example.ru')
  await expect(page.getByRole('heading', { level: 1, name: 'SEO' })).toBeVisible()
  await expect(url).toHaveValue('example.ru')
  await general.region.getByRole('button', { name: /^Сохранить/ }).click()
  await expect(url).toBeFocused()
  await expect(general.region).toContainText('https:// и домен')

  await url.clear()
  await url.pressSequentially('https://remont.example')
  await expect(general.region).toContainText('remont.example › ceny')
})

test('dev-рендерер: редирект на кириллический адрес и страница 404 по её адресу', async ({
  demoSite,
}) => {
  const saved = await sites[':siteId'].settings.$patch({
    param: { siteId: demoSite.id },
    json: {
      redirects: [
        { from: '/staraya', to: '/цены' },
        { from: '/old-logo.png', to: '/' },
      ],
    },
  })
  expect(saved.status).toBe(200)
  // В заголовке Location только ASCII: адрес закодирован, как у API
  const redirect = await fetch(`${urls.renderer}/staraya`, { redirect: 'manual' })
  expect(redirect.status).toBe(301)
  expect(redirect.headers.get('location')).toBe('/%D1%86%D0%B5%D0%BD%D1%8B')
  // Адреса с .png, .ico и .webmanifest — не только иконки: как на сервере, редирект или 404 сайта
  const logo = await fetch(`${urls.renderer}/old-logo.png`, { redirect: 'manual' })
  expect(logo.status).toBe(301)
  expect(logo.headers.get('location')).toBe('/')
  for (const path of ['/x.png', '/other.ico', '/app.webmanifest']) {
    const missing = await fetch(`${urls.renderer}${path}`)
    expect(missing.status, path).toBe(404)
    expect(await missing.text(), path).toContain('Страница не найдена')
  }
  // /404 — страница 404 сайта, а не заглушка Astro
  const notFound = await fetch(`${urls.renderer}/404`)
  expect(notFound.status).toBe(404)
  const html = await notFound.text()
  expect(html).toContain('<html lang="ru">')
  expect(html).toContain('Страница не найдена')
})

test('страница 404 создаётся из раздела SEO и открывается в редакторе', async ({ page }) => {
  await page.goto('/seo')
  const section = page.getByRole('region', { name: 'Страница 404' })
  await expect(section).toContainText('Своей нет')
  await section.getByRole('button', { name: 'Создать страницу 404' }).click()
  await expect(page).toHaveURL('/pages/404')
  await expect(page.getByLabel('Заголовок страницы')).toHaveValue('Страница не найдена')
  await page.getByRole('button', { name: /^SEO/ }).click()
  await expect(page.getByText('Служебная страница 404')).toBeVisible()

  await page.goto('/seo')
  await expect(page.getByRole('region', { name: 'Страница 404' })).toContainText('Черновик')
  await page.goto('/pages')
  await expect(page.getByRole('table', { name: 'Страницы' })).toContainText(
    '/404 · на адресах, где страницы нет',
  )
})

test('редирект с адреса существующей страницы не сохраняется: страница главнее', async ({
  page,
  demoSite,
}) => {
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug: 'ceny', title: 'Цены' },
  })
  expect(created.status).toBe(201)
  await page.goto('/seo')
  const redirects = card(page, 'Редиректы')
  await redirects.region.getByRole('button', { name: 'Добавить редирект' }).click()
  await redirects.field('Откуда').fill('/ceny/')
  await redirects.field('Куда').fill('/')
  await redirects.region.getByRole('button', { name: 'Сохранить редиректы' }).click()
  await expect(redirects.region).toContainText('По этому адресу есть страница «Цены»')
  await expect(redirects.field('Откуда')).toBeFocused()
  const saved = await ownerApi.sites[':siteId'].settings.$get({ param: { siteId: demoSite.id } })
  expect(saved.status).toBe(200)
  if (saved.status === 200) expect((await saved.json()).settings.redirects).toEqual([])
})

test('страница, созданная по адресу редиректа, перекрывает его — раздел SEO предупреждает', async ({
  page,
  demoSite,
}) => {
  const saved = await sites[':siteId'].settings.$patch({
    param: { siteId: demoSite.id },
    json: { redirects: [{ from: '/akcii', to: '/' }] },
  })
  expect(saved.status).toBe(200)
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug: 'akcii', title: 'Акции' },
  })
  expect(created.status).toBe(201)
  await page.goto('/seo')
  const redirects = card(page, 'Редиректы')
  await expect(redirects.field('Откуда')).toHaveAccessibleDescription(
    /есть страница «Акции»: редирект не сработает/,
  )
  // Строку убрали — таблица сохраняется
  await redirects.region.getByRole('button', { name: /^Удалить редирект 1/ }).click()
  await redirects.save(/Редиректы сохранены/)
})

test('SEO страницы в редакторе: советы до публикации, теги и карточка из заголовка на сайте', async ({
  page,
  demoSite,
}) => {
  test.slow()
  const opened = await sites[':siteId'].settings.$patch({
    param: { siteId: demoSite.id },
    json: { hideFromSearch: false },
  })
  expect(opened.status).toBe(200)
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug: 'ceny', title: 'Цены', template: 'hero' },
  })
  expect(created.status).toBe(201)

  const ed = editor(page)
  await ed.open('ceny')
  // Советы видны на кнопке ещё до того, как панель открыли: короткий заголовок и нет описания
  const seoButton = page.getByRole('button', { name: /^SEO/ })
  await expect(seoButton).toHaveAccessibleName(/SEO.*2 совета/)
  await seoButton.click()
  const panel = page.getByRole('complementary', { name: 'SEO страницы' })
  const checks = panel.getByRole('region', { name: 'Проверки' })
  await expect(checks).toContainText('Важно: Описания нет')
  await expect(checks).toContainText('Заголовок короткий: 4 символа')
  // Карточка из заголовка — от API: картинка загрузилась
  const card = panel.getByRole('img', { name: /^Карточка из заголовка «Цены»/ })
  await expect(card).toBeVisible()
  await expect
    .poll(() => card.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth))
    .toBe(1200)

  await panel.getByLabel('SEO-заголовок').fill('Цены на ремонт квартир в Твери — Ремонт у Ивана')
  await panel
    .getByLabel('Описание')
    .fill(
      'Сколько стоит ремонт квартиры под ключ: смета за день, цена в договоре и гарантия 3 года',
    )
  await expect(checks).toContainText('Заголовок 47 символов — в самый раз')
  await expect(seoButton).toHaveAccessibleName('SEO')
  await expect(panel).toContainText('Примерно так — в Яндексе')
  await expect(panel).toContainText('Цены на ремонт квартир в Твери — Ремонт у Ивана')

  // Canonical на другой адрес — совет, а не запрет; убрали — совета нет
  const canonical = panel.getByLabel('Канонический адрес (canonical)')
  await canonical.fill('/uslugi/')
  await expect(checks).toContainText('Основной адрес — другой: /uslugi/')
  await expect(seoButton).toHaveAccessibleName(/1 совет/)
  await canonical.fill('')
  await expect(seoButton).toHaveAccessibleName('SEO')

  await ed.publishButton.click()
  await expect(ed.status).toHaveText(/Опубликовано/)

  // Версия на «сервере»: теги из SEO страницы и файл карточки рядом со страницей. Сборки заводят и
  // сброс фикстуры, и этот тест, а current переключается на каждый новый релиз. Поэтому ждём
  // релиз, где есть и страница с SEO, и карточка, и дальше читаем только из его папки
  const seoTitle = '<title>Цены на ремонт квартир в Твери — Ремонт у Ивана</title>'
  let release = ''
  await expect
    .poll(
      async () => {
        release = await realpath(join(publishDir, demoSite.id, 'current')).catch(() => '')
        if (!release) return false
        const page = await readFile(join(release, 'ceny', 'index.html'), 'utf8').catch(() => '')
        return page.includes(seoTitle) && existsSync(join(release, 'og', 'ceny.png'))
      },
      { timeout: 90_000 },
    )
    .toBe(true)
  const html = await readFile(join(release, 'ceny', 'index.html'), 'utf8')
  expect(html).toContain(
    '<meta property="og:title" content="Цены на ремонт квартир в Твери — Ремонт у Ивана">',
  )
  expect(html).toContain('<meta name="description" content="Сколько стоит ремонт квартиры под ключ')
  expect(html).toContain(`<link rel="canonical" href="${urls.renderer}/ceny/">`)
  expect(html).toMatch(
    new RegExp(
      `<meta property="og:image" content="${urls.renderer}/og/ceny[.]png[?]v=[0-9a-f]{8}">`,
    ),
  )
  const meta = await sharp(await readFile(join(release, 'og', 'ceny.png'))).metadata()
  expect([meta.format, meta.width, meta.height]).toEqual(['png', 1200, 630])
  expect(await readFile(join(release, 'sitemap.xml'), 'utf8')).toContain(
    `<loc>${urls.renderer}/ceny/</loc>`,
  )

  // Dev-рендерер — то же: карточка по адресу, неизвестная — страница 404 сайта
  const devCard = await fetch(`${urls.renderer}/og/ceny.png`)
  expect(devCard.status).toBe(200)
  expect(devCard.headers.get('content-type')).toBe('image/png')
  const devMissing = await fetch(`${urls.renderer}/og/net-takoy.png`)
  expect(devMissing.status).toBe(404)
  expect(await devMissing.text()).toContain('Страница не найдена')

  // Вторая страница с canonical на первую (без косой черты, как часто пишут руками) и своей
  // картинкой: на собранном сайте canonical и og:url — адрес первой в виде карты сайта, og:image —
  // картинка медиатеки, а саму страницу карта сайта не знает
  const photo = await uploadMedia(demoSite.id, 1200, 630)
  const param = { siteId: demoSite.id, slug: 'ceny-2025' }
  const copy = sites[':siteId'].pages[':slug']
  const seo = { canonical: '/ceny', image: { mediaId: photo.id } }
  const draft = { title: 'Цены 2025', content: { blocks: [], seo } }
  expect((await copy.$put({ param, json: draft })).status).toBe(200)
  expect((await copy.publish.$post({ param })).status).toBe(200)
  let next = ''
  await expect
    .poll(
      async () => {
        next = await realpath(join(publishDir, demoSite.id, 'current')).catch(() => '')
        return next !== '' && existsSync(join(next, 'ceny-2025', 'index.html'))
      },
      { timeout: 90_000 },
    )
    .toBe(true)
  const copyHtml = await readFile(join(next, 'ceny-2025', 'index.html'), 'utf8')
  expect(copyHtml).toContain(`<link rel="canonical" href="${urls.renderer}/ceny/">`)
  expect(copyHtml).toContain(`<meta property="og:url" content="${urls.renderer}/ceny/">`)
  expect(copyHtml).toMatch(
    new RegExp(
      `<meta property="og:image" content="${urls.renderer}/media/${photo.id}/1200[.]png">`,
    ),
  )
  expect(existsSync(join(next, 'og', 'ceny-2025.png'))).toBe(false)
  const nextSitemap = await readFile(join(next, 'sitemap.xml'), 'utf8')
  expect(nextSitemap).toContain(`<loc>${urls.renderer}/ceny/</loc>`)
  expect(nextSitemap).not.toContain('ceny-2025')
})
