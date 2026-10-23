import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { urls } from '../urls'
import { editor, expect, sites, test } from './fixtures'

// Блоки лендинга второго шага: наши работы, отзывы, клиенты, команда, контакты. Человек
// добавляет их из каталога, ставит SVG-логотип клиента, заполняет контакты и публикует —
// посетитель видит всё без JavaScript, а поисковик — организацию из «SEO» с данными блока

const PHONE = '+7 (342) 000-00-00'
const EMAIL = 'office@remont.example'
const ADDRESS = 'Пермь, улица Ленина, 50'
const CLIENT = 'ООО «Стройка»'
const WORK_ALT = 'Кухня после ремонта'
const MEMBER_ALT = 'Прораб на объекте'

test('работы, отзывы, клиенты, команда и контакты — из каталога на сайт', async ({
  page,
  browser,
  demoSite,
}) => {
  // Разметку организации получает открытая для поиска страница сайта с названием организации
  const settings = await sites[':siteId'].settings.$patch({
    param: { siteId: demoSite.id },
    json: {
      hideFromSearch: false,
      organization: { type: 'LocalBusiness', name: 'Ремонт у Ивана' },
    },
  })
  expect(settings.status).toBe(200)
  const slug = `kontakty-${randomUUID().slice(0, 8)}`
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug, title: 'Контакты и работы', template: 'hero' },
  })
  expect(created.status, 'создание страницы').toBe(201)

  const ed = editor(page)
  await ed.open(slug)
  const dialog = ed.addBlockDialog

  // Каталог: 16 блоков, новые — в разделе «Доверие»
  await ed.addBlockButton.click()
  await expect(dialog.getByRole('radio', { name: 'Все · 16' })).toBeVisible()
  await dialog.getByRole('radio', { name: 'Доверие' }).check()
  const cards = dialog.getByRole('list', { name: 'Каталог блоков' }).getByRole('button')
  await expect(cards).toHaveCount(5)
  await expect(dialog.getByRole('button', { name: /^Клиенты/ })).toContainText('новый')

  // «Клиенты» — поиском по слову из описания; логотип — SVG, загруженный прямо из выбора
  await dialog.getByRole('searchbox', { name: 'Найти блок' }).fill('логотип')
  await expect(cards).toHaveCount(1)
  await cards.first().click()
  await expect(dialog).toBeHidden()
  await ed.inspector.getByLabel('Название', { exact: true }).first().fill(CLIENT)
  const logo = ed.inspector.getByRole('group', { name: 'Логотип', exact: true }).first()
  await logo.getByRole('button', { name: 'Выбрать картинку' }).click()
  const library = page.getByRole('dialog', { name: 'Медиатека: выберите картинку' })
  await expect(library).toContainText('SVG — для логотипов и иконки сайта')
  const svgName = `stroyka-${randomUUID().slice(0, 8)}.svg`
  await library.getByLabel('Загрузить картинку').setInputFiles({
    name: svgName,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#f60"/></svg>',
    ),
  })
  await library.getByRole('button', { name: new RegExp(`^Выбрать «${svgName}»`) }).click()
  await expect(library).toBeHidden()
  await expect(logo).toContainText(svgName)
  // У логотипа нет своего описания: его alt — название клиента
  await expect(logo.getByRole('textbox')).toHaveCount(0)

  // «Контакты» — разделом «Связь»: телефон, почта, адрес, 2ГИС по координатам, разметка
  await ed.addBlockButton.click()
  await dialog.getByRole('radio', { name: 'Связь' }).check()
  await dialog.getByRole('button', { name: /^Контакты/ }).click()
  await expect(dialog).toBeHidden()
  await ed.inspector.getByLabel(/^Телефон/).fill('нет номера')
  await expect(ed.inspector).toContainText('Телефон: цифры, пробелы, скобки и дефис')
  await expect(ed.saveButton).toBeDisabled()
  await ed.inspector.getByLabel(/^Телефон/).fill(PHONE)
  await ed.inspector.getByLabel(/^Почта/).fill(EMAIL)
  await ed.inspector.getByLabel(/^Адрес/).fill(ADDRESS)
  await ed.inspector.getByRole('radio', { name: '2ГИС' }).check()
  await ed.inspector.getByLabel(/^Координаты/).fill('58.0105, 56.2502')
  await ed.inspector.getByLabel('Разметка для поисковиков').check()

  // «Наши работы»: фото в первую работу — JPEG шире самого большого варианта
  await ed.addBlock('Наши работы')
  const photoName = `kuhnya-${randomUUID().slice(0, 8)}.jpg`
  const photo = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: '#c8a26b' },
  })
    .jpeg()
    .toBuffer()
  // У галереи «Фото» — и весь список, и поле пункта: берём первую кнопку и первое описание
  const pickImage = ed.inspector.getByRole('button', { name: 'Выбрать картинку' }).first()
  const imageAlt = ed.inspector.getByLabel('Описание картинки (alt)').first()
  await pickImage.click()
  await library.getByLabel('Загрузить картинку').setInputFiles({
    name: photoName,
    mimeType: 'image/jpeg',
    buffer: photo,
  })
  await library.getByRole('button', { name: new RegExp(`^Выбрать «${photoName}»`) }).click()
  await expect(library).toBeHidden()
  await imageAlt.fill(WORK_ALT)

  await ed.addBlock('Отзывы')

  // «Команда»: то же фото из медиатеки — первому человеку
  await ed.addBlock('Команда')
  await pickImage.click()
  await library.getByRole('button', { name: new RegExp(`^Выбрать «${photoName}»`) }).click()
  await expect(library).toBeHidden()
  await imageAlt.fill(MEMBER_ALT)
  await expect(ed.blocks).toHaveCount(6)

  // Предпросмотр — те же компоненты
  await expect(ed.preview.getByRole('link', { name: PHONE })).toHaveAttribute(
    'href',
    'tel:+73420000000',
  )
  await expect(ed.preview.getByRole('img', { name: CLIENT })).toBeVisible()

  await ed.publishButton.click()
  await expect(ed.status).toHaveText('Опубликовано. Обнови сайт, чтобы увидеть')

  // Посетитель без JavaScript
  const context = await browser.newContext({ locale: 'ru-RU', javaScriptEnabled: false })
  const site = await context.newPage()
  await site.setViewportSize({ width: 1440, height: 900 })
  await site.goto(`${urls.renderer}/${slug}`)

  const logoImage = site.getByRole('img', { name: CLIENT })
  await expect(logoImage).toBeVisible()
  expect(await logoImage.getAttribute('src')).toMatch(/\/image\.svg$/)
  await expect(site.getByText('[Название клиента]')).toHaveCount(3)

  await expect(site.getByRole('link', { name: PHONE })).toHaveAttribute('href', 'tel:+73420000000')
  await expect(site.getByRole('link', { name: EMAIL })).toHaveAttribute('href', `mailto:${EMAIL}`)
  await expect(site.locator('address')).toContainText(ADDRESS)
  await expect(site.getByRole('link', { name: 'Открыть на карте' })).toHaveAttribute(
    'href',
    'https://2gis.ru/geo/56.2502,58.0105',
  )
  await expect(site.locator('iframe')).toHaveCount(0)

  await expect(site.getByRole('heading', { level: 2, name: 'Наши работы' })).toBeVisible()
  // Фото работы — ссылка на самый большой вариант снимка (1600 px), браузер откроет его сам
  const workImage = site.getByRole('img', { name: WORK_ALT })
  await expect(workImage).toBeVisible()
  expect(await site.getByRole('link', { name: WORK_ALT }).getAttribute('href')).toMatch(
    /\/1600\.jpe?g$/,
  )
  await expect(site.getByRole('img', { name: MEMBER_ALT })).toBeVisible()
  await expect(site.locator('figcaption', { hasText: '[Что за объект, площадь]' })).toHaveCount(3)
  await expect(site.locator('blockquote')).toHaveCount(2)
  await expect(site.locator('figcaption', { hasText: '[Имя клиента]' })).toHaveCount(2)
  await expect(site.getByRole('heading', { level: 3, name: '[Имя и фамилия]' })).toHaveCount(3)

  // Организация из «SEO» с телефоном, почтой, адресом и картой из блока
  const jsonLd = await site.locator('script[type="application/ld+json"]').allTextContents()
  const org = jsonLd
    .map((text) => JSON.parse(text))
    .find((data) => data['@type'] === 'LocalBusiness')
  expect(org).toMatchObject({
    name: 'Ремонт у Ивана',
    telephone: PHONE,
    email: EMAIL,
    address: { '@type': 'PostalAddress', streetAddress: ADDRESS },
    hasMap: 'https://2gis.ru/geo/56.2502,58.0105',
  })

  // Телефон: страница без горизонтальной прокрутки
  await site.setViewportSize({ width: 375, height: 812 })
  const overflow = await site.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )
  expect(overflow).toBe(0)
  await context.close()
})
