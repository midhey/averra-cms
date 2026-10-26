import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HEADER_LABEL_MAX } from '@averra/schema'
import type { Browser, Locator, Page } from '@playwright/test'
import sharp from 'sharp'
import { publishDir } from '../urls'
import { expect, sites, test } from './fixtures'
import { serveRelease } from './release-server'

// «Шапка и подвал»: владелец настраивает шапку и меню, публикация с пунктом на неопубликованную
// страницу не проходит, без него — проходит. На собранном сайте (папка релиза, как её отдаёт
// Caddy) меню работает без JS на 1440 и 375, а с JS шапка собирается при прокрутке и меню
// закрывается по Esc. Шапку демо-сайта после теста убирает фикстура (resetHeader)

const release = (siteId: string) => join(publishDir, siteId, 'current')

async function servedHtml(siteId: string, slug = '') {
  const file = join(release(siteId), slug, 'index.html')
  return existsSync(file) ? readFile(file, 'utf8') : ''
}

async function visitor(browser: Browser, width: number, javaScriptEnabled: boolean) {
  const context = await browser.newContext({
    locale: 'ru-RU',
    javaScriptEnabled,
    viewport: { width, height: width < 768 ? 812 : 900 },
  })
  return { context, page: await context.newPage() }
}

/** Нет горизонтальной прокрутки: страница не шире окна */
const noHorizontalScroll = async (page: Page) =>
  (await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )) === 0

/**
 * Части шапки видны, лежат в окне шириной width, не сжаты в ноль (шире 40 px) и не накладываются
 * друг на друга
 */
async function expectSideBySide(parts: Record<string, Locator>, width: number, where: string) {
  const boxes = []
  for (const [name, part] of Object.entries(parts)) {
    await expect(part, `${name}: ${where}`).toBeVisible()
    const box = await part.boundingBox()
    if (!box) throw new Error(`${name}: нет рамки, ${where}`)
    expect(box.x, `${name} слева в окне: ${where}`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `${name} справа в окне: ${where}`).toBeLessThanOrEqual(width)
    expect(box.width, `${name} шире 40 px: ${where}`).toBeGreaterThanOrEqual(40)
    boxes.push({ name, ...box })
  }
  for (const [index, a] of boxes.entries()) {
    for (const b of boxes.slice(index + 1)) {
      const apart =
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y
      expect(apart, `${a.name} и ${b.name} не накладываются: ${where}`).toBe(true)
    }
  }
}

test('настроить шапку и меню, опубликовать — на сайте меню работает без JS и с ним', async ({
  page,
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  const param = { siteId: demoSite.id }
  // Неопубликованная страница — цель пункта, с которым публикация не пройдёт
  const created = await sites[':siteId'].pages.$post({
    param,
    json: { slug: 'akcii', title: 'Акции', template: 'hero' },
  })
  expect(created.status).toBe(201)
  // Промо-страница со скрытой шапкой
  const promo = await sites[':siteId'].pages[':slug'].$put({
    param: { ...param, slug: 'promo' },
    json: {
      title: 'Промо',
      content: {
        blocks: [{ id: 'hero', type: 'hero', props: { title: 'Акция месяца' } }],
        hideHeader: true,
      },
    },
  })
  expect(promo.status).toBe(200)
  expect(
    (await sites[':siteId'].pages[':slug'].publish.$post({ param: { ...param, slug: 'promo' } }))
      .status,
  ).toBe(200)

  await page.goto('/header')
  await expect(page.getByRole('heading', { name: 'Шапка и подвал', level: 1 })).toBeVisible()
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Шапка и подвал' }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Шапки пока нет на сайте')).toBeVisible()
  await expect(page.getByText('Шапка скрыта на страницах: «Промо»')).toBeVisible()

  // Шапка: раскладка, сборка при прокрутке (только у липкой), кнопка к форме
  await page.getByRole('radio', { name: 'Классика' }).check()
  const condense = page.getByRole('checkbox', { name: 'Собирается при прокрутке' })
  await page.getByRole('checkbox', { name: 'Липкая шапка' }).uncheck()
  await expect(condense).toBeDisabled()
  await page.getByRole('checkbox', { name: 'Липкая шапка' }).check()
  await condense.check()
  await page.getByRole('checkbox', { name: 'Кнопка в шапке' }).check()
  await expect(page.getByRole('textbox', { name: 'Текст кнопки' })).toHaveValue('Оставить заявку')
  await expect(page.getByRole('combobox', { name: 'Куда ведёт' })).toHaveValue('index#contact')

  // Раскладки — сеткой 2×2, как в концепте: «Двухэтажная» под «Классикой», а не 3 + 1
  const cardBox = (name: string) => page.getByRole('radio', { name }).locator('..').boundingBox()
  const [classicBox, doubleBox, minimalBox] = await Promise.all(
    ['Классика', 'Двухэтажная', 'Минимум'].map(cardBox),
  )
  expect(doubleBox?.x).toBe(classicBox?.x)
  expect(minimalBox?.y).toBe(doubleBox?.y)

  // Подписи раскладок в узкой колонке переносятся, а не обрезаются многоточием
  const centerCard = page.getByRole('radio', { name: 'Меню по центру' }).locator('..')
  expect(
    await centerCard.evaluate((node) => {
      const label = [...node.querySelectorAll('span')].find(
        (span) => span.textContent === 'Меню по центру',
      )
      return label ? label.scrollWidth <= label.clientWidth : false
    }),
  ).toBe(true)
  await centerCard.locator('..').screenshot({ path: testInfo.outputPath('admin-layouts-1440.png') })

  // Меню: три пункта, один — на неопубликованную страницу
  await page.getByRole('tab', { name: 'Меню' }).click()
  const items = page.getByRole('list', { name: 'Пункты меню' }).getByRole('listitem')
  const fill = async (index: number, label: string, target: string) => {
    await page.getByRole('button', { name: 'Пункт меню', exact: true }).click()
    const item = items.nth(index)
    await item.getByRole('textbox', { name: 'Подпись' }).fill(label)
    await item.getByRole('combobox', { name: 'Куда ведёт' }).selectOption(target)
  }
  await fill(0, 'Почему мы', 'index#benefits')
  await fill(1, 'Акции', 'akcii')
  await fill(2, 'Связаться', 'index#contact')
  await expect(items.nth(1).getByText(/страница «Акции» не опубликована/)).toBeVisible()
  // Порядок — стрелками (перетаскивание то же, что у блоков: tests/drag.spec.ts)
  await items.nth(2).getByRole('button', { name: 'Поднять пункт «Связаться»' }).click()
  await expect(items.nth(1).getByRole('textbox', { name: 'Подпись' })).toHaveValue('Связаться')

  // Предпросмотр — настоящая шапка над главной
  const preview = page.frameLocator('iframe[title="Предпросмотр шапки"]')
  await expect(preview.getByRole('navigation', { name: 'Меню сайта' }).first()).toContainText(
    'Почему мы',
  )
  await expect(preview.getByRole('link', { name: 'Оставить заявку' }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(
    page.getByText('Шапка сохранена. На сайте она появится после публикации'),
  ).toBeVisible()

  // Публикация с пунктом на неопубликованную страницу — понятная ошибка и фокус на пункте
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(
    page.getByText(
      'Не удалось опубликовать: Шапку не опубликовать. Пункт меню «Акции»: страница «Акции» не опубликована — опубликуйте её или выберите другую',
    ),
  ).toBeVisible()
  await expect(items.nth(2).getByRole('combobox', { name: 'Куда ведёт' })).toBeFocused()

  await items.nth(2).getByRole('button', { name: 'Удалить пункт «Акции»' }).click()
  await expect(items).toHaveCount(2)
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByText(/Шапка опубликована/)).toBeVisible()
  await expect(page.getByText('Опубликована', { exact: true })).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('admin-1440.png'), fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('admin-375.png'), fullPage: true })

  // Сайт собран с шапкой; промо — без неё
  await expect
    .poll(() => servedHtml(demoSite.id), { timeout: 120_000 })
    .toContain('data-site-header')
  const html = await servedHtml(demoSite.id)
  expect(html).toContain('data-condense')
  // Скрипт шапки — свой модуль сборки (Astro встраивает маленький прямо в страницу), без загрузок
  expect(html).toMatch(/<script type="module"[^>]*>[^<]*data-header-sentinel/)
  expect(await servedHtml(demoSite.id, 'promo')).not.toContain('data-site-header')

  const site = await serveRelease(release(demoSite.id))
  try {
    // Без JS, широкий экран: меню строкой, кнопка, «К содержимому»
    const wide = await visitor(browser, 1440, false)
    await wide.page.goto(site.url)
    const wideNav = wide.page.getByRole('navigation', { name: 'Меню сайта' })
    await expect(wideNav).toHaveCount(1)
    await expect(wideNav.getByRole('link')).toHaveText(['Почему мы', 'Связаться'])
    await expect(wideNav.getByRole('link', { name: 'Почему мы' })).toHaveAttribute(
      'href',
      '/#benefits',
    )
    await expect(wide.page.getByRole('button', { name: 'Меню' })).toBeHidden()
    await wide.page.screenshot({ path: testInfo.outputPath('site-1440-nojs.png') })
    await wide.page.keyboard.press('Tab')
    await expect(wide.page.getByRole('link', { name: 'К содержимому' })).toBeFocused()
    // Липкая: прокрутили — шапка сверху
    await wide.page.mouse.wheel(0, 1500)
    await expect
      .poll(() => wide.page.locator('header').evaluate((node) => node.getBoundingClientRect().top))
      .toBe(0)
    await wide.page.mouse.wheel(0, -3000)
    expect(await noHorizontalScroll(wide.page)).toBe(true)
    await wide.context.close()

    // Без JS, телефон: меню в <details>, открывается и закрывается без скрипта
    const narrow = await visitor(browser, 375, false)
    await narrow.page.goto(site.url)
    const burger = narrow.page.locator('summary', { hasText: 'Меню' })
    await expect(burger).toBeVisible()
    const panelNav = narrow.page.getByRole('navigation', { name: 'Меню сайта' })
    await expect(panelNav).toBeHidden()
    await burger.click()
    await expect(panelNav).toBeVisible()
    await expect(panelNav.getByRole('link')).toHaveText(['Почему мы', 'Связаться'])
    await expect(narrow.page.getByRole('link', { name: 'Оставить заявку' })).toBeVisible()
    expect(await noHorizontalScroll(narrow.page)).toBe(true)
    await narrow.page.screenshot({ path: testInfo.outputPath('site-375-nojs-open.png') })
    await burger.click()
    await expect(panelNav).toBeHidden()
    await narrow.context.close()

    // С JS: прокрутка собирает шапку, Esc закрывает меню и возвращает фокус на «Меню»
    const live = await visitor(browser, 1440, true)
    await live.page.emulateMedia({ reducedMotion: 'no-preference' })
    await live.page.goto(site.url)
    const header = live.page.locator('header[data-site-header]')
    await expect(header).not.toHaveAttribute('data-condensed', '')
    const fullHeight = await header.evaluate((node) => node.getBoundingClientRect().height)
    await live.page.mouse.wheel(0, 1200)
    await expect(header).toHaveAttribute('data-condensed', '')
    await expect(header).toHaveAttribute('data-animate', '')
    await expect
      .poll(() => header.evaluate((node) => node.getBoundingClientRect().height))
      .toBeLessThan(fullHeight)
    await live.page.screenshot({ path: testInfo.outputPath('site-1440-condensed.png') })
    await live.page.mouse.wheel(0, -3000)
    await expect(header).not.toHaveAttribute('data-condensed', '')

    await live.page.setViewportSize({ width: 375, height: 812 })
    const liveBurger = live.page.locator('summary', { hasText: 'Меню' })
    await liveBurger.click()
    await expect(live.page.getByRole('navigation', { name: 'Меню сайта' })).toBeVisible()
    await live.page.keyboard.press('Escape')
    await expect(live.page.getByRole('navigation', { name: 'Меню сайта' })).toBeHidden()
    await expect(liveBurger).toBeFocused()
    await live.context.close()

    // «Уменьшить движение»: шапка собирается без анимации
    const calm = await visitor(browser, 1440, true)
    await calm.page.emulateMedia({ reducedMotion: 'reduce' })
    await calm.page.goto(site.url)
    await calm.page.mouse.wheel(0, 1200)
    const calmHeader = calm.page.locator('header[data-site-header]')
    await expect(calmHeader).toHaveAttribute('data-condensed', '')
    await expect(calmHeader).not.toHaveAttribute('data-animate', '')
    await calm.context.close()
  } finally {
    site.close()
  }
})

test('прозрачная шапка лежит на фото «Первого экрана» и читается, с JS после него — с фоном', async ({
  page,
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  const param = { siteId: demoSite.id }
  // Светлое фото — худший случай для светлого текста поверх
  const data = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: '#f4ead8' },
  })
    .jpeg()
    .toBuffer()
  const uploaded = await sites[':siteId'].media.$post({
    param,
    form: {
      file: new File([new Uint8Array(data)], `foto-${randomUUID().slice(0, 8)}.jpg`, {
        type: 'image/jpeg',
      }),
    },
  })
  expect(uploaded.status).toBe(201)
  const mediaId = uploaded.status === 201 ? (await uploaded.json()).id : ''
  const saved = await sites[':siteId'].pages[':slug'].$put({
    param: { ...param, slug: 'foto' },
    json: {
      title: 'Кухни на фото',
      content: {
        blocks: [
          {
            id: 'top',
            type: 'hero',
            props: {
              variant: 'cover',
              title: 'Кухни, в которых хочется готовить',
              subtitle: 'Замер, проект и сборка за три недели',
              image: { mediaId, alt: 'Светлая кухня' },
            },
          },
          { id: 'about', type: 'text', props: { body: 'О нас. '.repeat(400) } },
        ],
      },
    },
  })
  expect(saved.status).toBe(200)
  const pagePublish = sites[':siteId'].pages[':slug'].publish
  expect((await pagePublish.$post({ param: { ...param, slug: 'foto' } })).status).toBe(200)

  // Подсказка в админке называет страницу, где прозрачная шапка сработает
  await page.goto('/header')
  await expect(page.getByText(/Ложится на фото «Первого экрана».*«Кухни на фото»/)).toBeVisible()

  const header = sites[':siteId'].header
  const menu = [{ label: 'Кухни', page: 'foto' }]
  // Атрибут у самой шапки: в стилях страницы селектор [data-overlay] есть всегда
  const overlayHeader = /<header[^>]*data-overlay/
  expect((await header.$put({ param, json: { overlay: true, menu } })).status).toBe(200)
  expect((await header.publish.$post({ param })).status).toBe(200)
  await expect
    .poll(() => servedHtml(demoSite.id, 'foto'), { timeout: 120_000 })
    .toMatch(overlayHeader)
  // На главной фото нет — шапка обычная
  expect(await servedHtml(demoSite.id)).not.toMatch(overlayHeader)

  const site = await serveRelease(release(demoSite.id))
  try {
    for (const width of [1440, 375]) {
      const visit = await visitor(browser, width, false)
      await visit.page.goto(`${site.url}/foto/`)
      const siteHeader = visit.page.locator('header[data-site-header]')
      const hero = visit.page.locator('section#top')
      // Шапка лежит на фото: верх блока — под ней, текст шапки — цветом текста на фото
      const [headerBox, heroBox] = [await siteHeader.boundingBox(), await hero.boundingBox()]
      expect(heroBox?.y).toBe(0)
      expect(headerBox?.y).toBe(0)
      await expect(siteHeader).toHaveCSS('color', 'rgb(255, 255, 255)')
      await expect(hero.locator('h1')).toHaveCSS('color', 'rgb(255, 255, 255)')
      // Затемнение темы по умолчанию — посчитано на худшее фото (coverScrim)
      await expect(hero.locator('[data-hero-cover] > span')).toHaveCSS('opacity', '0.6')
      expect(await noHorizontalScroll(visit.page)).toBe(true)
      await visit.page.screenshot({ path: testInfo.outputPath(`overlay-${width}-nojs.png`) })
      await visit.context.close()
    }

    // С JS: после первого экрана шапка встаёт сверху уже с фоном и обычным цветом текста
    const live = await visitor(browser, 1440, true)
    await live.page.goto(`${site.url}/foto/`)
    const liveHeader = live.page.locator('header[data-site-header]')
    await live.page.mouse.wheel(0, 1500)
    await expect(liveHeader).toHaveAttribute('data-stuck', '')
    await expect.poll(() => liveHeader.evaluate((node) => node.getBoundingClientRect().top)).toBe(0)
    await expect(liveHeader).toHaveCSS('color', 'rgb(22, 24, 29)')
    await live.page.screenshot({ path: testInfo.outputPath('overlay-1440-stuck.png') })
    await live.context.close()
  } finally {
    site.close()
  }
})

test('собранная шапка не мигает, когда прокрутка остановилась чуть ниже метки', async ({
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  const param = { siteId: demoSite.id }
  const header = sites[':siteId'].header
  // Двухэтажная и «по центру» при сборке теряют ~50 px высоты, «Классика» — ~12: браузер сдвигает
  // прокрутку на эту разницу (scroll anchoring), и с одной меткой шапка мигала бы каждый кадр
  for (const layout of ['classic', 'center', 'double'] as const) {
    // Подпись своя у каждой раскладки: по ней видно, что собрана именно эта шапка
    const label = `Почему мы ${layout}`
    const menu = [{ label, page: 'index', block: 'benefits' }]
    expect(
      (await header.$put({ param, json: { layout, condense: true, phone: true, menu } })).status,
    ).toBe(200)
    expect((await header.publish.$post({ param })).status).toBe(200)
    await expect.poll(() => servedHtml(demoSite.id), { timeout: 120_000 }).toContain(label)
    const site = await serveRelease(release(demoSite.id))
    try {
      for (const width of [1440, 375]) {
        const visit = await visitor(browser, width, true)
        await visit.page.emulateMedia({ reducedMotion: 'no-preference' })
        await visit.page.goto(site.url)
        const siteHeader = visit.page.locator('header[data-site-header]')
        await expect(siteHeader).toHaveAttribute('data-animate', '')
        await visit.page.screenshot({ path: testInfo.outputPath(`${layout}-${width}.png`) })
        if (layout === 'center' && width === 1440) {
          // Над меню строкой ниже логотипа — линия, как в концепте
          await expect(siteHeader.locator('nav ul').first()).toHaveCSS('border-top-width', '1px')
        }
        // Метка — 7rem (112 px): останавливаемся на 5–40 px ниже
        for (const y of [117, 130, 152]) {
          await visit.page.evaluate('window.scrollTo(0, 0)')
          await expect(siteHeader).not.toHaveAttribute('data-condensed', '')
          const toggles = await visit.page.evaluate(
            `new Promise((resolve) => {
              const node = document.querySelector('header[data-site-header]')
              let state = node.hasAttribute('data-condensed')
              let changes = 0
              // Считаем смены состояния, а не записи: скрипт может поставить тот же атрибут ещё раз
              const watch = new MutationObserver(() => {
                const now = node.hasAttribute('data-condensed')
                if (now !== state) changes += 1
                state = now
              })
              watch.observe(node, { attributes: true, attributeFilter: ['data-condensed'] })
              window.scrollTo(0, ${y})
              setTimeout(() => {
                watch.disconnect()
                resolve(changes)
              }, 1000)
            })`,
          )
          expect(toggles, `${layout}, ${width} px, прокрутка ${y}`).toBeLessThanOrEqual(1)
          await expect(siteHeader).toHaveAttribute('data-condensed', '')
        }
        await visit.context.close()
      }
    } finally {
      site.close()
    }
  }
})

/**
 * Шапка без меню на телефоне: кнопка своей строкой под логотипом и трубкой и во всю ширину строки
 * (за вычетом полей), а не сжатой колонкой рядом с ними
 */
async function expectRowButton(parts: Record<'logo' | 'phone' | 'button', Locator>, where: string) {
  const [logo, phone, button] = await Promise.all(
    [parts.logo, parts.phone, parts.button].map((part) => part.boundingBox()),
  )
  if (!logo || !phone || !button) throw new Error(`нет рамки: ${where}`)
  expect(button.y, `кнопка ниже логотипа: ${where}`).toBeGreaterThanOrEqual(logo.y + logo.height)
  expect(button.y, `кнопка ниже трубки: ${where}`).toBeGreaterThanOrEqual(phone.y + phone.height)
  // Строка — родитель ссылки на главную (бренда): её ширина без полей
  const rowWidth = await parts.logo.evaluate((node) => {
    const row = node.closest('a[href="/"]')?.parentElement
    if (!row) return 0
    const style = row.ownerDocument.defaultView?.getComputedStyle(row)
    if (!style) return 0
    return (
      row.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
    )
  })
  expect(Math.abs(button.width - rowWidth), `кнопка во всю ширину: ${where}`).toBeLessThan(1)
}

test('«Минимум» с самой длинной кнопкой, телефоном и широким логотипом умещается в 320 и 375 px', async ({
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  const param = { siteId: demoSite.id }
  // Номер и адрес — из «Организации»; фикстура потом вернёт её пустой
  const settings = await sites[':siteId'].settings.$patch({
    param,
    json: {
      organization: {
        name: 'Ремонт у Ивана',
        phone: '+7 (342) 000-00-00',
        address: { city: 'Пермь', street: 'ул. Ленина, 1' },
      },
    },
  })
  expect(settings.status).toBe(200)
  // Вытянутый логотип 5:1 — худший случай по ширине
  const logoData = await sharp({
    create: { width: 1000, height: 200, channels: 3, background: '#2e6b49' },
  })
    .png()
    .toBuffer()
  const upload = async (data: Buffer, name: string, type: string) => {
    const res = await sites[':siteId'].media.$post({
      param,
      form: { file: new File([new Uint8Array(data)], name, { type }) },
    })
    expect(res.status).toBe(201)
    return res.status === 201 ? (await res.json()).id : ''
  }
  const logo = await upload(logoData, `logo-${randomUUID().slice(0, 8)}.png`, 'image/png')
  const photoData = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: '#f4ead8' },
  })
    .jpeg()
    .toBuffer()
  const photo = await upload(photoData, `foto-${randomUUID().slice(0, 8)}.jpg`, 'image/jpeg')
  // Промо-страница на фото: прозрачная шапка в две строки не должна лечь на заголовок
  const slug = 'akciya'
  const saved = await sites[':siteId'].pages[':slug'].$put({
    param: { ...param, slug },
    json: {
      title: 'Акция',
      content: {
        blocks: [
          {
            id: 'top',
            type: 'hero',
            props: {
              variant: 'cover',
              title: 'Ванная под ключ за 14 дней',
              image: { mediaId: photo, alt: 'Ванная' },
            },
          },
        ],
      },
    },
  })
  expect(saved.status).toBe(200)
  expect(
    (await sites[':siteId'].pages[':slug'].publish.$post({ param: { ...param, slug } })).status,
  ).toBe(200)

  // Самая длинная допустимая подпись: на 320 px строкой с логотипом и трубкой ей не уместиться
  const label = 'Записаться на бесплатный замер и расчёт!'
  expect(label).toHaveLength(HEADER_LABEL_MAX)
  const header = sites[':siteId'].header
  expect(
    (
      await header.$put({
        param,
        json: {
          layout: 'minimal',
          phone: true,
          overlay: true,
          logo,
          button: { label, page: 'index' },
        },
      })
    ).status,
  ).toBe(200)
  expect((await header.publish.$post({ param })).status).toBe(200)
  await expect.poll(() => servedHtml(demoSite.id, slug), { timeout: 120_000 }).toContain(label)
  await expect.poll(() => servedHtml(demoSite.id), { timeout: 120_000 }).toContain('tel:')

  const site = await serveRelease(release(demoSite.id))
  try {
    // 768 и 1440 — кнопка снова в строке с логотипом, ничего не наложилось
    for (const width of [320, 375, 768, 1440]) {
      for (const javaScriptEnabled of [false, true]) {
        const visit = await visitor(browser, width, javaScriptEnabled)
        for (const path of ['/', `/${slug}/`]) {
          const where = `${width} px, ${javaScriptEnabled ? 'с JS' : 'без JS'}, ${path}`
          await visit.page.goto(`${site.url}${path}`)
          const siteHeader = visit.page.locator('header[data-site-header]')
          const parts = {
            logo: siteHeader.locator('a[href="/"] img'),
            phone: siteHeader.getByRole('link', { name: '+7 (342) 000-00-00' }),
            button: siteHeader.getByRole('link', { name: label }),
          }
          await expectSideBySide(parts, width, where)
          if (width < 640) await expectRowButton(parts, where)
          // Подпись кнопки не обрезана
          expect(
            await parts.button.evaluate((node) => node.scrollWidth - node.clientWidth),
            `кнопка не обрезана: ${where}`,
          ).toBe(0)
          expect(await noHorizontalScroll(visit.page), `прокрутки нет: ${where}`).toBe(true)
          if (path !== '/') {
            // Прозрачная шапка лежит на фото, заголовок первого экрана — ниже неё
            const headerBox = await siteHeader.boundingBox()
            const titleBox = await visit.page.locator('section#top h1').boundingBox()
            expect(
              (titleBox?.y ?? 0) - ((headerBox?.y ?? 0) + (headerBox?.height ?? 0)),
              `заголовок под шапкой: ${where}`,
            ).toBeGreaterThanOrEqual(0)
          }
          await visit.page.screenshot({
            path: testInfo.outputPath(
              `minimal-${width}-${javaScriptEnabled ? 'js' : 'nojs'}${path === '/' ? '' : '-cover'}.png`,
            ),
          })
        }
        await visit.context.close()
      }
    }
  } finally {
    site.close()
  }

  // С меню тот же вытянутый логотип ужимается и не уходит под трубку и «Меню»
  expect(
    (
      await header.$put({
        param,
        json: { layout: 'classic', phone: true, logo, menu: [{ label: 'Акция', page: slug }] },
      })
    ).status,
  ).toBe(200)
  expect((await header.publish.$post({ param })).status).toBe(200)
  await expect.poll(() => servedHtml(demoSite.id), { timeout: 120_000 }).toContain('data-panel')
  const withMenu = await serveRelease(release(demoSite.id))
  try {
    const visit = await visitor(browser, 320, false)
    await visit.page.goto(withMenu.url)
    const siteHeader = visit.page.locator('header[data-site-header]')
    await expectSideBySide(
      {
        logo: siteHeader.locator('a[href="/"] img'),
        phone: siteHeader.getByRole('link', { name: '+7 (342) 000-00-00' }).first(),
        menu: siteHeader.locator('summary'),
      },
      320,
      '320 px с меню',
    )
    // «Меню» не сжато: подпись в одну строку
    expect((await siteHeader.locator('summary').boundingBox())?.height).toBeLessThan(56)
    expect(await noHorizontalScroll(visit.page)).toBe(true)
    await visit.page.screenshot({ path: testInfo.outputPath('classic-320-logo.png') })
    // В раскрытом меню номер — контурной кнопкой под основной, как в концепте телефона
    await siteHeader.locator('summary').click()
    const panelPhone = siteHeader
      .locator('details')
      .getByRole('link', { name: '+7 (342) 000-00-00' })
    await expect(panelPhone).toBeVisible()
    await expect(panelPhone).toHaveCSS('border-top-width', '2px')
    await visit.page.screenshot({ path: testInfo.outputPath('classic-320-open.png') })
    await visit.context.close()
  } finally {
    withMenu.close()
  }

  // Восемь длинных пунктов на ноутбуке: переносится меню, а логотип не тает в полоску
  const longItem = (index: number) => ({
    label: `${index + 1}. ${'Пункт меню '.repeat(4)}`.trim().slice(0, HEADER_LABEL_MAX),
    page: slug,
  })
  expect(
    (
      await header.$put({
        param,
        json: {
          layout: 'classic',
          phone: true,
          logo,
          menu: Array.from({ length: 8 }, (_, index) => longItem(index)),
          button: { label, page: 'index' },
        },
      })
    ).status,
  ).toBe(200)
  expect((await header.publish.$post({ param })).status).toBe(200)
  await expect.poll(() => servedHtml(demoSite.id), { timeout: 120_000 }).toContain('8. Пункт')
  const longMenu = await serveRelease(release(demoSite.id))
  try {
    for (const width of [1024, 1440]) {
      const visit = await visitor(browser, width, false)
      await visit.page.goto(longMenu.url)
      const logoBox = await visit.page
        .locator('header[data-site-header] a[href="/"] img')
        .boundingBox()
      expect(logoBox?.width ?? 0, `логотип не сжат: ${width} px`).toBeGreaterThanOrEqual(120)
      expect(await noHorizontalScroll(visit.page)).toBe(true)
      await visit.page.screenshot({ path: testInfo.outputPath(`classic-${width}-long-menu.png`) })
      await visit.context.close()
    }
  } finally {
    longMenu.close()
  }
})

test('кнопка липкой шапки без меню ведёт к разделу, и его заголовок не под шапкой на 320 и 375 px', async ({
  browser,
  demoSite,
}, testInfo) => {
  test.slow()
  const param = { siteId: demoSite.id }
  const settings = await sites[':siteId'].settings.$patch({
    param,
    json: {
      organization: {
        name: 'Ремонт у Ивана',
        phone: '+7 (342) 000-00-00',
        address: { city: 'Пермь', street: 'ул. Ленина, 1' },
      },
    },
  })
  expect(settings.status).toBe(200)
  // Длинная страница: раздел, куда ведёт кнопка, — посередине, к нему есть куда прокрутить
  const slug = 'zamer'
  const filler = (id: string) => ({
    id,
    type: 'text' as const,
    props: { body: 'Подробности. '.repeat(300) },
  })
  const saved = await sites[':siteId'].pages[':slug'].$put({
    param: { ...param, slug },
    json: {
      title: 'Замер',
      content: {
        blocks: [
          { id: 'top', type: 'hero', props: { title: 'Замер бесплатно' } },
          filler('first'),
          { id: 'calc', type: 'text', props: { title: 'Расчёт за день', body: 'Как считаем.' } },
          filler('second'),
          filler('third'),
        ],
      },
    },
  })
  expect(saved.status).toBe(200)
  expect(
    (await sites[':siteId'].pages[':slug'].publish.$post({ param: { ...param, slug } })).status,
  ).toBe(200)

  const label = 'Записаться на бесплатный замер и расчёт!'
  const header = sites[':siteId'].header
  // «Минимум» и двухэтажная без меню — у обеих кнопка на телефоне своей строкой
  for (const layout of ['minimal', 'double'] as const) {
    expect(
      (
        await header.$put({
          param,
          json: { layout, sticky: true, phone: true, button: { label, page: slug, block: 'calc' } },
        })
      ).status,
    ).toBe(200)
    expect((await header.publish.$post({ param })).status).toBe(200)
    await expect
      .poll(() => servedHtml(demoSite.id, slug), { timeout: 120_000 })
      .toContain(`data-layout="${layout}"`)
    const site = await serveRelease(release(demoSite.id))
    try {
      for (const width of [320, 375]) {
        for (const javaScriptEnabled of [false, true]) {
          const where = `${layout}, ${width} px, ${javaScriptEnabled ? 'с JS' : 'без JS'}`
          const visit = await visitor(browser, width, javaScriptEnabled)
          await visit.page.goto(`${site.url}/${slug}/`)
          const siteHeader = visit.page.locator('header[data-site-header]')
          await siteHeader.getByRole('link', { name: label }).click()
          await expect(visit.page).toHaveURL(/#calc$/)
          const title = visit.page.locator('section#calc h2')
          // Раздел прокручен к верху окна, а его заголовок — ниже низа липкой шапки
          await expect
            .poll(async () => (await title.boundingBox())?.y ?? 0, { message: where })
            .toBeLessThan(400)
          const headerBox = await siteHeader.boundingBox()
          const titleBox = await title.boundingBox()
          expect(
            (titleBox?.y ?? 0) - ((headerBox?.y ?? 0) + (headerBox?.height ?? 0)),
            `заголовок раздела под шапкой: ${where}`,
          ).toBeGreaterThanOrEqual(0)
          await visit.page.screenshot({
            path: testInfo.outputPath(
              `anchor-${layout}-${width}-${javaScriptEnabled ? 'js' : 'nojs'}.png`,
            ),
          })
          await visit.context.close()
        }
      }
    } finally {
      site.close()
    }
  }
})

test('вкладка «Подвал» говорит, что сейчас внизу страниц', async ({ page }) => {
  await page.goto('/header')
  await page.getByRole('tab', { name: 'Подвал' }).click()
  await expect(page.getByRole('tabpanel')).toContainText('Политика конфиденциальности')
  await expect(page.getByRole('link', { name: '«Cookie и согласие»' })).toHaveAttribute(
    'href',
    '/seo/cookies',
  )
})
