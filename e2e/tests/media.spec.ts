import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { answerDialogs, editor, expect, mediaScreen, openSite, sites, test } from './fixtures'

/** JPEG, как с телефона: с GPS в EXIF. Имя уникальное — медиатека копится за прогон */
async function photo() {
  const name = `kuhnya-${randomUUID().slice(0, 8)}.jpg`
  const buffer = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: '#c8a26b' },
  })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '55/1 45/1 2100/100' } })
    .toBuffer()
  return { name, mimeType: 'image/jpeg', buffer }
}

/** Своя страница с первым экраном: тест не трогает главную демо-сайта */
async function createPage(siteId: string, slug: string) {
  const res = await sites[':siteId'].pages.$post({
    param: { siteId },
    json: { slug, title: 'Кухни на заказ', template: 'hero' },
  })
  expect(res.status, 'создание страницы').toBe(201)
}

const altText = 'Светлая кухня с деревянными фасадами'

test('картинка из медиатеки в первом экране split доходит до сайта в <picture>', async ({
  page,
  demoSite,
}) => {
  const media = mediaScreen(page)
  const file = await photo()
  await media.open()
  await media.fileInput.setInputFiles(file)
  await expect(media.status).toHaveText(`Картинка «${file.name}» загружена`)
  await expect(media.item(file.name)).toBeVisible()
  await expect(media.item(file.name)).toContainText('1600 × 1000')

  await createPage(demoSite.id, 'kuhni')
  const ed = editor(page)
  await ed.open('kuhni')

  // Вариант split без картинки — ошибка прямо у поля, сохранить нельзя
  await ed.inspector.getByRole('radio', { name: 'С картинкой' }).check()
  await expect(ed.inspector).toContainText('В варианте «С картинкой» (split) нужна картинка')
  await expect(ed.saveButton).toBeDisabled()
  // Подпись поля не спорит с ошибкой: «необязательно» у картинки не пишем
  await expect(ed.inspector.getByRole('group', { name: 'Картинка' })).not.toContainText(
    'необязательно',
  )

  await ed.inspector.getByRole('button', { name: 'Выбрать картинку' }).click()
  const dialog = page.getByRole('dialog', { name: 'Медиатека: выберите картинку' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: `Выбрать «${file.name}»` }).click()
  await expect(dialog).toBeHidden()

  // Alt обязателен: пустой — тоже ошибка у поля
  const alt = ed.field('Описание картинки (alt)')
  await expect(alt).toHaveAttribute('aria-invalid', 'true')
  await alt.fill(altText)
  await expect(alt).not.toHaveAttribute('aria-invalid')

  // Предпросмотр показывает картинку теми же компонентами, что и сайт
  await expect(ed.preview.getByRole('img', { name: altText })).toBeVisible()

  await ed.publishButton.click()
  await expect(ed.status).toHaveText('Опубликовано. Обнови сайт, чтобы увидеть')

  const site = await openSite(page, '/kuhni')
  const picture = site.locator('picture')
  await expect(picture).toHaveCount(1)
  const avif = picture.locator('source[type="image/avif"]')
  const webp = picture.locator('source[type="image/webp"]')
  await expect(avif).toHaveAttribute('srcset', /\/api\/media\/[^ ]+\/480\.avif 480w, .+ 1600w$/)
  await expect(webp).toHaveAttribute('srcset', /\/api\/media\/[^ ]+\/480\.webp 480w/)
  await expect(avif).toHaveAttribute('sizes', /100vw/)

  const img = picture.getByRole('img', { name: altText })
  await expect(img).toHaveAttribute('width', '1600')
  await expect(img).toHaveAttribute('height', '1000')
  // Первый экран: картинку грузим сразу и в первую очередь
  await expect(img).toHaveAttribute('loading', 'eager')
  await expect(img).toHaveAttribute('fetchpriority', 'high')
  // Браузер действительно загрузил вариант
  await expect
    .poll(() => img.evaluate((node) => (node as { naturalWidth: number }).naturalWidth))
    .toBeGreaterThan(0)

  // Файл варианта отдаётся с правильным типом и без метаданных
  const avifUrl = (await avif.getAttribute('srcset'))?.split(' ')[0] ?? ''
  const res = await site.request.get(avifUrl)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('image/avif')
  expect((await sharp(await res.body()).metadata()).exif).toBeUndefined()
})

test('картинку, которая стоит на странице, удалить нельзя — медиатека говорит где', async ({
  page,
  demoSite,
}) => {
  const media = mediaScreen(page)
  const file = await photo()
  await media.open()
  await media.fileInput.setInputFiles(file)
  await expect(media.item(file.name)).toBeVisible()

  // Ставим картинку на страницу через API — так же, как это сделал бы редактор
  const list = await sites[':siteId'].media.$get({ param: { siteId: demoSite.id } })
  if (list.status !== 200) throw new Error(`Медиатека: ${list.status}`)
  const uploaded = (await list.json()).items.find((item) => item.originalName === file.name)
  if (!uploaded) throw new Error('Загруженной картинки нет в медиатеке')
  await createPage(demoSite.id, 's-foto')
  const saved = await sites[':siteId'].pages[':slug'].$put({
    param: { siteId: demoSite.id, slug: 's-foto' },
    json: {
      title: 'Страница с фото',
      content: {
        blocks: [
          {
            id: 'hero',
            type: 'hero',
            props: {
              variant: 'split',
              title: 'Фото',
              image: { mediaId: uploaded.id, alt: 'Кухня' },
            },
          },
        ],
      },
    },
  })
  expect(saved.status).toBe(200)

  const dialogs = answerDialogs(page, [true])
  await media.deleteButton(file.name).click()
  await expect(media.alert).toContainText('Картинка используется на страницах')
  await expect(media.alert).toContainText('«Страница с фото» (/s-foto) — черновик')
  // В вопросе — не только имя файла (у фото с iOS оно у всех image.jpg), но и размеры
  expect(dialogs).toHaveLength(1)
  expect(dialogs[0]).toContain(`Удалить картинку «${file.name}», 1600 × 1000, `)
  expect(dialogs[0]).toContain('из медиатеки? Вернуть её не получится.')
  await expect(media.item(file.name)).toBeVisible()
})

test('SVG: загружается очищенным, ставится логотипом, а в выбор картинки для соцсетей не попадает', async ({
  page,
}) => {
  const media = mediaScreen(page)
  await media.open()
  const name = `logo-${randomUUID().slice(0, 8)}.svg`
  await media.fileInput.setInputFiles({
    name,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" onload="alert(1)"><script>alert(1)</script><rect width="120" height="40" fill="#f60"/></svg>',
    ),
  })
  await expect(media.status).toHaveText(`Картинка «${name}» загружена`)
  await expect(media.item(name)).toContainText('120 × 40 · SVG')

  // Файл — очищенный и с CSP: открытый напрямую, он ничего не исполнит
  const src = await media.item(name).locator('img').getAttribute('src')
  expect(src).toMatch(/\/api\/media\/[0-9a-f-]{36}\/image\.svg$/)
  const file = await page.request.get(new URL(src ?? '', page.url()).href)
  expect(file.headers()['content-type']).toBe('image/svg+xml')
  expect(file.headers()['content-security-policy']).toContain('sandbox')
  const body = await file.text()
  expect(body).toContain('<rect width="120" height="40" fill="#f60"/>')
  expect(body).not.toMatch(/script|onload/)

  // SVG без размеров — понятная причина
  const broken = `bez-razmerov-${randomUUID().slice(0, 8)}.svg`
  await media.fileInput.setInputFiles({
    name: broken,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'),
  })
  await expect(media.alert).toContainText(`Не удалось загрузить «${broken}»`)
  await expect(media.alert).toContainText('нужен viewBox')
  await expect(media.item(broken)).toHaveCount(0)

  // Логотип организации — SVG можно; картинка для соцсетей — в выборе его нет
  await page.goto('/seo')
  const organization = page.getByRole('region', { name: 'Организация' })
  await organization
    .getByRole('group', { name: 'Логотип' })
    .getByRole('button', { name: /Выбрать картинку|Заменить/ })
    .click()
  const logoDialog = page.getByRole('dialog', { name: /^Медиатека/ })
  await logoDialog.getByRole('button', { name: new RegExp(`^Выбрать «${name}»`) }).click()
  await expect(logoDialog).toBeHidden()
  await expect(organization.getByRole('group', { name: 'Логотип' })).toContainText(name)

  const general = page.getByRole('region', { name: 'Основное' })
  await general
    .getByRole('group', { name: 'Картинка для соцсетей' })
    .getByRole('button', { name: /Выбрать картинку|Заменить/ })
    .click()
  const socialDialog = page.getByRole('dialog', { name: /^Медиатека/ })
  await expect(socialDialog).toContainText('SVG сюда не ставится')
  await expect(socialDialog.getByRole('button', { name: new RegExp(`«${name}»`) })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(socialDialog).toBeHidden()
})

test('файл больше лимита: понятная причина сразу, без отправки на сервер', async ({ page }) => {
  const media = mediaScreen(page)
  await media.open()
  // Лимит e2e — 2 МБ (MEDIA_MAX_BYTES в playwright.config.ts), как фото с телефона против 10 МБ
  await expect(page.getByText('не больше 2 МБ')).toBeVisible()
  const uploads: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/media')) uploads.push(request.url())
  })

  const name = `telefon-${randomUUID().slice(0, 8)}.jpg`
  await media.fileInput.setInputFiles({
    name,
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(5 * 1024 * 1024, 0xff),
  })
  await expect(media.alert).toHaveText(
    `Не удалось загрузить «${name}»: Файл больше 2 МБ. Уменьшите картинку и загрузите снова`,
  )
  await expect(media.item(name)).toHaveCount(0)
  expect(uploads).toEqual([])
})

test('ненужную картинку удаляют из медиатеки', async ({ page }) => {
  const media = mediaScreen(page)
  const file = await photo()
  await media.open()
  await media.fileInput.setInputFiles(file)
  await expect(media.item(file.name)).toBeVisible()

  answerDialogs(page, [true])
  await media.deleteButton(file.name).click()
  await expect(media.status).toHaveText(`Картинка «${file.name}» удалена`)
  await expect(media.item(file.name)).toHaveCount(0)
})
