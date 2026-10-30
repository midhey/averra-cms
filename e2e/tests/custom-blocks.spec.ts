import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { urls } from '../urls'
import { editor, expect, sites, test } from './fixtures'

// Свои блоки: владелец собирает блок «Тарифы с наклейкой» — поля с повторителем и картинкой,
// шаблон Liquid и CSS, — публикует его; редактор ставит блок на страницу из раздела «Свои»,
// заполняет и публикует; посетитель видит его на сайте на десктопе и телефоне без JavaScript

const TEMPLATE = `<h2 class="title">{{ title }}</h2>
{% if text %}<div class="text">{{ text | paragraphs }}</div>{% endif %}
<ul class="plans" role="list">
  {% for plan in plans %}
  <li class="plan">
    {% if plan.sticker %}<span class="sticker">{{ plan.sticker }}</span>{% endif %}
    {{ plan.photo | image: '(min-width: 64rem) 33vw, 100vw', 'photo' }}
    <h3 class="name">{{ plan.title }}</h3>
  </li>
  {% endfor %}
</ul>`

/**
 * CSS — ровно пример из документации (admin/custom-blocks.md): если пример даст прокрутку на
 * телефоне или картинка вылезет из карточки, это поймает проверка ниже
 */
const CSS = (() => {
  const guide = readFileSync(
    resolve(import.meta.dirname, '../../apps/docs/src/content/docs/admin/custom-blocks.md'),
    'utf8',
  ).replace(/\r/g, '')
  const block = /```css\n([\s\S]*?)\n\s*```/.exec(guide)?.[1]
  if (!block) throw new Error('В admin/custom-blocks.md нет примера CSS')
  return block.replace(/^ {3}/gm, '')
})()

const PLAN = 'Базовый'
const STICKER = 'Хит'
const ALT = 'Кухня после ремонта'

test('свой блок: поля с повторителем и картинкой → страница → сайт без JS на 1440 и 375', async ({
  page,
  browser,
  demoSite,
}, testInfo) => {
  // Владелец: «Свои блоки» → «Создать блок»
  await page.goto('/blocks')
  await expect(page.getByRole('heading', { level: 1, name: 'Свои блоки' })).toBeVisible()
  await page.getByRole('button', { name: 'Создать блок' }).first().click()
  const create = page.getByRole('dialog', { name: 'Новый свой блок' })
  await create.getByLabel('Название').fill('Тарифы с наклейкой')
  // Ключ предложен из названия латиницей; оставляем короче
  await expect(create.getByLabel('Ключ')).toHaveValue('tarify-s-nakleykoy')
  await create.getByLabel('Ключ').fill('tariffs')
  await create.getByRole('button', { name: 'Создать' }).click()
  await expect(page).toHaveURL(/\/blocks\/tariffs$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Тарифы с наклейкой' })).toBeVisible()

  // Поля: к заготовке (заголовок и текст) — повторитель «Тарифы» с названием, наклейкой и фото
  const panel = page.getByRole('tabpanel')
  const kind = panel.getByRole('combobox', { name: 'Вид' })
  const label = panel.getByLabel('Подпись', { exact: true })
  const key = panel.getByLabel('Ключ', { exact: true })
  await panel.getByRole('button', { name: 'Добавить поле', exact: true }).click()
  await kind.nth(2).selectOption('repeater')
  await label.nth(2).fill('Тарифы')
  await key.nth(2).fill('plans')
  const inside = panel.getByRole('button', { name: 'Добавить поле внутрь' })
  await inside.click()
  await kind.nth(4).selectOption('text')
  await label.nth(4).fill('Наклейка')
  await key.nth(4).fill('sticker')
  await inside.click()
  await kind.nth(5).selectOption('image')
  await label.nth(5).fill('Фото')
  await key.nth(5).fill('photo')

  // Шаблон: script не пройдёт — ошибка со строкой, по ней курсор встаёт на строку
  await page.getByRole('tab', { name: /^Шаблон/ }).click()
  const template = page.getByRole('textbox', { name: 'Шаблон Liquid' })
  await template.fill('<h2>{{ title }}</h2>\n<script>alert(1)</script>')
  await expect(page.getByRole('tab', { name: 'Шаблон · 1' })).toBeVisible()
  const problems = page.getByRole('list', { name: 'Замечания' })
  await expect(problems).toContainText('<script> запрещён: свой блок работает без JavaScript')
  await problems.getByRole('button', { name: 'Строка 2' }).click()
  await expect(template).toBeFocused()
  await template.fill(TEMPLATE)
  await expect(page.getByRole('tab', { name: 'Шаблон', exact: true })).toBeVisible()
  await expect(page.getByText('Замечаний нет')).toBeVisible()

  // CSS: конкретный цвет — совет, а не ошибка; на ролях темы замечаний нет
  await page.getByRole('tab', { name: /^CSS/ }).click()
  const css = page.getByRole('textbox', { name: 'CSS блока' })
  await css.fill('.sticker { color: #fff; }')
  await expect(page.getByRole('list', { name: 'Замечания' })).toContainText(
    'Цвет #fff задан напрямую',
  )
  await css.fill(CSS)
  await expect(page.getByText('Замечаний нет')).toBeVisible()

  // Живой предпросмотр — на настоящем рендере: заголовок примера в рамке блока
  const preview = page.getByTitle('Предпросмотр своего блока').contentFrame()
  await expect(preview.locator('[data-custom-block="tariffs"] h2.title')).toBeVisible()

  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByText(/^Опубликовано: блок есть в каталоге редактора/)).toBeVisible()

  // Экран блока на телефоне: колонки друг под другом, без горизонтальной прокрутки
  const adminOverflow = () =>
    page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  await page.getByRole('tab', { name: 'Поля' }).click()
  await page.screenshot({ path: testInfo.outputPath('block-screen-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await adminOverflow(), 'прокрутка экрана блока на 375').toBe(0)
  await page.screenshot({ path: testInfo.outputPath('block-screen-375.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 720 })

  // Редактор страницы: блок — в разделе «Свои» каталога
  const slug = `tarify-${randomUUID().slice(0, 8)}`
  const created = await sites[':siteId'].pages.$post({
    param: { siteId: demoSite.id },
    json: { slug, title: 'Тарифы', template: 'hero' },
  })
  expect(created.status, 'создание страницы').toBe(201)
  const ed = editor(page)
  await ed.open(slug)
  await ed.addBlockButton.click()
  const dialog = ed.addBlockDialog
  await dialog.getByRole('radio', { name: 'Свои' }).check()
  const cards = dialog.getByRole('list', { name: 'Каталог блоков' }).getByRole('button')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('свой')
  await cards.first().click()
  await expect(dialog).toBeHidden()
  await expect(ed.inspector.getByRole('heading', { name: 'Тарифы с наклейкой' })).toBeVisible()

  // Заполнить: заголовок, тариф с наклейкой и фото из медиатеки (загружено прямо из выбора)
  await ed.field('Заголовок').first().fill('Наши тарифы')
  const plans = ed.inspector.getByRole('group', { name: 'Тарифы' })
  await plans.getByRole('button', { name: 'Добавить пункт' }).click()
  await plans.getByLabel('Заголовок', { exact: true }).fill(PLAN)
  await plans.getByLabel(/^Наклейка/).fill(STICKER)
  await plans.getByRole('button', { name: 'Выбрать картинку' }).click()
  const library = page.getByRole('dialog', { name: 'Медиатека: выберите картинку' })
  const photoName = `kuhnya-${randomUUID().slice(0, 8)}.png`
  const photo = await sharp({
    create: { width: 960, height: 640, channels: 3, background: '#b5835a' },
  })
    .png()
    .toBuffer()
  await library.getByLabel('Загрузить картинку').setInputFiles({
    name: photoName,
    mimeType: 'image/png',
    buffer: photo,
  })
  await library.getByRole('button', { name: new RegExp(`^Выбрать «${photoName}»`) }).click()
  await expect(library).toBeHidden()
  await plans.getByLabel('Описание картинки (alt)').fill(ALT)
  await expect(ed.preview.getByRole('img', { name: ALT })).toBeVisible()

  await ed.publishButton.click()
  await expect(ed.status).toHaveText('Опубликовано. Обнови сайт, чтобы увидеть')

  // Посетитель без JavaScript: блок в рамке секции с якорем, картинка адаптивная, CSS блока
  // на ролях темы, без горизонтальной прокрутки на десктопе и телефоне
  const context = await browser.newContext({ locale: 'ru-RU', javaScriptEnabled: false })
  const site = await context.newPage()
  await site.goto(`${urls.renderer}/${slug}`)
  const block = site.locator('section[data-custom-block="tariffs"]')
  await expect(block).toHaveAttribute('id', 'tariffs-1')
  await expect(block.getByRole('heading', { level: 2, name: 'Наши тарифы' })).toBeVisible()
  await expect(block.getByRole('heading', { level: 3, name: PLAN })).toBeVisible()
  const image = block.getByRole('img', { name: ALT })
  await expect(image).toHaveAttribute('srcset', /480w/)
  await expect(image).toHaveAttribute('width', '960')
  // Картинка не шире карточки и без CSS для img в примере (правило по умолчанию в base.css)
  const fits = await image.evaluate((element) => {
    const card = element.closest('li')?.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return card !== undefined && box.right <= card.right + 0.5 && box.left >= card.left - 0.5
  })
  expect(fits, 'картинка в карточке').toBe(true)
  await expect(block.locator('script')).toHaveCount(0)
  const sticker = block.getByText(STICKER)
  const background = await sticker.evaluate(
    (element) => element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor,
  )
  expect(background).not.toBe('rgba(0, 0, 0, 0)')

  const overflow = () =>
    site.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  for (const [width, height] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    await site.setViewportSize({ width, height })
    await block.scrollIntoViewIfNeeded()
    expect(await overflow(), `горизонтальная прокрутка на ${width}`).toBe(0)
    await block.screenshot({ path: testInfo.outputPath(`custom-block-${width}.png`) })
  }
  await context.close()
})

test('публикуется черновик, который человек видел: правка со стороны (MCP) — предупреждение, а не сайт', async ({
  page,
  demoSite,
}) => {
  const siteId = demoSite.id
  const blocks = sites[':siteId']['custom-blocks']
  const param = { siteId, key: 'race' }
  const created = await blocks.$post({ param: { siteId }, json: { key: 'race', title: 'Гонка' } })
  expect(created.status).toBe(201)
  await page.goto('/blocks/race')
  await expect(page.getByRole('heading', { level: 1, name: 'Гонка' })).toBeVisible()

  // Пока экран открыт, черновик меняют со стороны — так его сохраняет нейронка через MCP
  const view = await blocks[':key'].$get({ param })
  if (view.status !== 200) throw new Error(`Блок не прочитан: ${view.status}`)
  const { draft } = await view.json()
  if (!draft) throw new Error('У блока нет черновика')
  const changed = { ...draft, template: `${draft.template}\n<p>Правка нейронки</p>` }
  expect((await blocks[':key'].$put({ param, json: changed })).status).toBe(200)

  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByText(/^Черновик изменили, пока он был открыт/)).toBeVisible()
  const after = await blocks[':key'].$get({ param })
  if (after.status !== 200) throw new Error(`Блок не прочитан: ${after.status}`)
  expect((await after.json()).published, 'непрочитанная правка не ушла на сайт').toBeNull()

  // Экран показывает свежий черновик: человек его читает и публикует осознанно
  await page.getByRole('tab', { name: /^Шаблон/ }).click()
  await expect(page.getByRole('textbox', { name: 'Шаблон Liquid' })).toHaveValue(/Правка нейронки/)
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByText(/^Опубликовано: блок есть в каталоге редактора/)).toBeVisible()
})

test('закрытое окно popover не открывается CSS блока: display: block не выводит его поверх страницы', async ({
  browser,
  demoSite,
}) => {
  const siteId = demoSite.id
  const blocks = sites[':siteId']['custom-blocks']
  const key = 'popover-ad'
  const param = { siteId, key }
  expect((await blocks.$post({ param: { siteId }, json: { key, title: 'Окно' } })).status).toBe(201)
  // Обход, который пробовал проверяющий: `display: block` у [popover] показывает закрытое окно
  // с position: fixed из стиля браузера — защитный слой base.css не даёт этого сделать
  const saved = await blocks[':key'].$put({
    param,
    json: {
      key,
      title: 'Окно',
      description: 'Проверка защитного слоя popover',
      category: 'about',
      fields: [{ type: 'text', name: 'title', label: 'Заголовок', required: true }],
      template:
        '<h2>{{ title }}</h2>\n<button type="button" popovertarget="t-ad">Открыть</button>\n<div id="t-ad" popover class="ad"><p>Окно</p></div>',
      css: '.ad { display: block !important; inset: 0; width: auto; height: auto; margin: 0; z-index: 9 }',
      example: { title: 'Заголовок' },
    },
  })
  expect(saved.status, 'сохранение: ошибок в проверке нет').toBe(200)
  const view = await blocks[':key'].$get({ param })
  if (view.status !== 200) throw new Error(`Блок не прочитан: ${view.status}`)
  const { draft } = await view.json()
  if (!draft) throw new Error('У блока нет черновика')
  expect((await blocks[':key'].publish.$post({ param, json: { draft } })).status).toBe(200)

  const slug = `okno-${randomUUID().slice(0, 8)}`
  expect(
    (await sites[':siteId'].pages.$post({ param: { siteId }, json: { slug, title: 'Окно' } }))
      .status,
  ).toBe(201)
  const pageParam = { siteId, slug }
  expect(
    (
      await sites[':siteId'].pages[':slug'].$put({
        param: pageParam,
        json: {
          title: 'Окно',
          content: {
            blocks: [{ id: 'ad-1', type: `custom:${key}`, props: { title: 'Страница с окном' } }],
          },
        },
      })
    ).status,
  ).toBe(200)
  expect((await sites[':siteId'].pages[':slug'].publish.$post({ param: pageParam })).status).toBe(
    200,
  )

  const context = await browser.newContext({ locale: 'ru-RU' })
  const site = await context.newPage()
  await expect
    .poll(async () => (await site.goto(`${urls.renderer}/${slug}`))?.status(), { timeout: 120_000 })
    .toBe(200)
  const ad = site.locator('[data-custom-block] .ad')
  const display = () =>
    ad.evaluate((el) => el.ownerDocument.defaultView?.getComputedStyle(el).display)
  expect(await display(), 'закрытое окно скрыто').toBe('none')
  await site.getByRole('button', { name: 'Открыть' }).click()
  expect(await display(), 'открытое окно показывается').toBe('block')
  await context.close()
})
