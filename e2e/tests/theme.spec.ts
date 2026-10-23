import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { publishDir } from '../urls'
import { expect, sites, test } from './fixtures'

// Экран «Тема»: готовая тема, проверка контраста, сохранение черновика и публикация — а на сайте
// (папка релиза, как её отдаёт Caddy) новые переменные и шрифты со своего сервера. Тему демо-сайта
// после теста возвращает фикстура (resetTheme)

const release = (siteId: string) => join(publishDir, siteId, 'current')

async function servedHtml(siteId: string) {
  const file = join(release(siteId), 'index.html')
  return existsSync(file) ? readFile(file, 'utf8') : ''
}

test('пресет, непроходящий акцент — ошибка, проходящий — сохранить и опубликовать', async ({
  page,
  demoSite,
}) => {
  await page.goto('/theme')
  await expect(page.getByRole('heading', { name: 'Тема сайта', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Тема' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // Готовая тема ставит цвета, шрифты и скругления разом
  await page.getByRole('radio', { name: 'Ночная' }).check()
  const accent = page.getByRole('textbox', { name: 'Акцент (кнопки, ссылки)', exact: true })
  await expect(accent).toHaveValue('#f2b544')
  await expect(page.getByLabel('Заголовки')).toHaveValue('manrope')
  await expect(page.getByText('Не сохранено')).toBeVisible()
  // Кнопки прилипают к низу экрана: после правки в середине формы листать до конца не нужно
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeInViewport()

  // Предпросмотр — настоящие блоки: рамка карточек «Преимуществ» — цвет «Линии и рамки»
  const card = page.frameLocator('iframe[title="Предпросмотр темы"]').locator('ul > li').first()
  await expect(card).toHaveCSS('border-top-color', 'rgb(44, 51, 61)')
  await page.getByRole('textbox', { name: 'Линии и рамки', exact: true }).fill('#ff00aa')
  await expect(card).toHaveCSS('border-top-color', 'rgb(255, 0, 170)')
  await page.getByRole('textbox', { name: 'Линии и рамки', exact: true }).fill('#2c333d')

  // Тёмный акцент на тёмном фоне: отметка «мало», сохранить нельзя, ошибка у поля
  await accent.fill('#2a2f38')
  const colors = page.getByRole('region', { name: 'Цвета' })
  await expect(colors.getByText(/\d,\d · мало/).first()).toBeVisible()
  await expect(colors.getByText('Так сохранить нельзя')).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Тему не сохранить: не хватает контраста')).toBeVisible()
  // Фокус — на акцент, который меняли, а не на первую ошибку («Текст на акценте»)
  await expect(accent).toBeFocused()
  await expect(
    colors.getByText(/Акцент на фоне \(ссылки\): контраст 1,\d — нужно не меньше 3,0/),
  ).toBeVisible()
  const draft = await sites[':siteId'].theme.$get({ param: { siteId: demoSite.id } })
  expect(((await draft.json()) as { unpublished: boolean }).unpublished).toBe(false)

  // Проходящий — сохраняется черновиком: на сайте пока прежняя тема
  await accent.fill('F5C04A')
  await expect(accent).toHaveValue('#f5c04a')
  await expect(colors.getByText('Так сохранить нельзя')).toBeHidden()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(
    page.getByText('Тема сохранена. На сайте она появится после публикации'),
  ).toBeVisible()
  await expect(page.getByText('Сохранено · не опубликовано')).toBeVisible()

  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByText(/Тема опубликована/)).toBeVisible()
  await expect(page.getByText('Опубликована', { exact: true })).toBeVisible()

  // На сайте — новые переменные и шрифт со своего сервера, только начертания темы
  await expect
    .poll(() => servedHtml(demoSite.id), { timeout: 90_000 })
    .toContain('--color-accent:#f5c04a')
  const html = await servedHtml(demoSite.id)
  expect(html).toContain('--font-heading:"Manrope"')
  expect(html).toMatch(/src:url\("\/_fonts\/manrope-cyrillic-400-normal-[0-9a-f]{10}\.woff2"\)/)
  expect(html).not.toContain('fonts.googleapis.com')
  // Знак ₽ — шрифтом темы: файл latin-ext с диапазоном из одного ₽ (качается, только если ₽ есть)
  expect(html).toMatch(
    /src:url\("\/_fonts\/manrope-latin-ext-400-normal-[0-9a-f]{10}\.woff2"\) format\("woff2"\);unicode-range:U\+20BD}/,
  )
  const fonts = await readdir(join(release(demoSite.id), '_fonts'))
  expect(fonts.some((file) => file.startsWith('manrope-latin-ext-400-normal-'))).toBe(true)
  expect(fonts.every((file) => file.startsWith('manrope-') && file.endsWith('.woff2'))).toBe(true)
})

test('телефон 375 px: подписи скруглений целиком, без горизонтальной прокрутки', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/theme')
  const radius = page.getByRole('group', { name: 'Скругления' })
  for (const name of ['Нет', 'Малые', 'Средние', 'Большие']) {
    const label = radius.getByText(name, { exact: true })
    await expect(label).toBeVisible()
    // Подпись не обрезана многоточием: вся ширина текста помещается
    expect(
      await label.evaluate(
        (node: { scrollWidth: number; clientWidth: number }) => node.scrollWidth - node.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
  }
  // Код выполняется в браузере строкой: типов DOM у e2e нет
  expect(
    await page.evaluate(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    ),
  ).toBe(0)
})
