import { readFile } from 'node:fs/promises'
import type { AppType } from '@cms/api'
import { demoPage, demoPageTitle, MAIN_PAGE_SLUG } from '@cms/schema'
import { test as base, expect, type Page } from '@playwright/test'
import { hc } from 'hono/client'
import { ownerStateFile, urls } from '../urls'

/**
 * Cookie сессии владельца из файла, который сохранил проект setup, и Origin админки:
 * без него API не примет изменяющий запрос с cookie. Так ходит в API и сама админка
 */
async function ownerHeaders() {
  const state = JSON.parse(await readFile(ownerStateFile, 'utf8')) as {
    cookies: { name: string; value: string }[]
  }
  const cookie = state.cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
  return { cookie, origin: urls.admin }
}

/** Типизированный клиент API e2e от имени владельца: поменяется API — тесты не скомпилируются */
export const sites = hc<AppType>(urls.api, { headers: ownerHeaders }).api.sites

type DemoSite = { id: string; name: string }

/** Демо-сайт — первый в базе: его кладёт API при старте, новые сайты встают после него */
export async function findDemoSite(): Promise<DemoSite> {
  const [site] = await (await sites.$get()).json()
  if (!site) throw new Error('В базе e2e нет демо-сайта: API должен был положить его при старте')
  return site
}

/**
 * Возвращает демо-сайт в исходное состояние: на нём только главная, её черновик и
 * опубликованная версия — демо. Страницы, которые создали другие тесты, удаляются.
 * Так каждый тест стартует с одного и того же известного состояния, в каком бы порядке ни шёл
 */
async function resetDemoSite() {
  const site = await findDemoSite()
  const param = { siteId: site.id, slug: MAIN_PAGE_SLUG }
  const page = sites[':siteId'].pages[':slug']
  const saved = await page.$put({ param, json: { title: demoPageTitle, content: demoPage } })
  expect(saved.status, 'сброс черновика демо-страницы').toBe(200)
  const published = await page.publish.$post({ param })
  expect(published.status, 'публикация демо-страницы').toBe(200)

  const list = await sites[':siteId'].pages.$get({ param: { siteId: site.id } })
  if (list.status !== 200) throw new Error(`Список страниц демо-сайта: ${list.status}`)
  for (const { slug } of await list.json()) {
    if (slug === MAIN_PAGE_SLUG) continue
    const deleted = await page.$delete({ param: { siteId: site.id, slug } })
    expect(deleted.status, `удаление страницы ${slug} демо-сайта`).toBe(204)
  }
  return site
}

export const test = base.extend<{ demoSite: DemoSite }>({
  demoSite: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright требует деструктуризацию первого аргумента фикстуры
    async ({}, use) => {
      await use(await resetDemoSite())
    },
    { auto: true },
  ],
})

export { expect }

/** Тексты демо-лендинга, которые видит человек. Записаны явно: тест сверяет с ними экран */
export const demo = {
  pageTitle: 'Ремонт квартир под ключ',
  heroTitle: 'Ремонт квартир под ключ без сюрпризов в смете',
  featuresTitle: 'Почему выбирают нас',
  ctaTitle: 'Узнайте стоимость ремонта за 1 день',
} as const

/** Редактор и его части так, как их видит человек: по ролям и подписям */
export function editor(page: Page) {
  const blockList = page.getByRole('navigation', { name: 'Блоки страницы' })
  const inspector = page.getByRole('complementary', { name: 'Поля блока' })
  return {
    /** Редактор страницы по прямому адресу. По умолчанию — главная демо-сайта */
    open: async (slug: string = MAIN_PAGE_SLUG) => {
      const site = await findDemoSite()
      await page.goto(`/sites/${site.id}/pages/${slug}`)
      await expect(page.getByLabel('Заголовок страницы')).toBeVisible()
    },
    pageTitle: page.getByLabel('Заголовок страницы'),
    status: page.getByRole('status'),
    saveButton: page.getByRole('button', { name: 'Сохранить черновик' }),
    publishButton: page.getByRole('button', { name: 'Опубликовать' }),
    blockList,
    blocks: blockList.getByRole('listitem'),
    block: (name: string) => blockList.getByRole('listitem').filter({ hasText: name }),
    newBlockType: blockList.getByLabel('Тип нового блока'),
    addBlockButton: blockList.getByRole('button', { name: 'Добавить' }),
    inspector,
    field: (label: string) => inspector.getByLabel(label, { exact: true }),
    preview: page.getByTitle('Предпросмотр страницы').contentFrame(),
  }
}

/** Опубликованный сайт: рендерер в dev-режиме берёт свежий снимок из API на каждый запрос */
export async function openSite(page: Page, path = '/') {
  const site = await page.context().newPage()
  await site.goto(`${urls.renderer}${path}`)
  return site
}

/** Экран страниц сайта так, как его видит человек */
export function siteScreen(page: Page) {
  const newPageForm = page.getByRole('form', { name: 'Новая страница' })
  return {
    heading: page.getByRole('heading', { level: 1 }),
    breadcrumbs: page.getByRole('navigation', { name: 'Навигация по разделам' }),
    pages: page.getByRole('table', { name: 'Страницы' }),
    row: (text: string) =>
      page.getByRole('table', { name: 'Страницы' }).getByRole('row').filter({ hasText: text }),
    newPageForm,
    newPage: {
      title: newPageForm.getByLabel('Заголовок'),
      slug: newPageForm.getByLabel('Адрес'),
      template: (label: 'С первым экраном' | 'Пустая') =>
        newPageForm.getByRole('radio', { name: label }),
      submit: newPageForm.getByRole('button', { name: 'Создать страницу' }),
    },
  }
}

/** Считает диалоги confirm и отвечает на них по очереди: true — «ОК», false — «Отмена» */
export function answerDialogs(page: Page, answers: boolean[]) {
  const messages: string[] = []
  page.on('dialog', (dialog) => {
    messages.push(dialog.message())
    return answers.shift() ? dialog.accept() : dialog.dismiss()
  })
  return messages
}

/** Панель «История» редактора так, как её видит человек */
export function historyPanel(page: Page) {
  const panel = page.getByRole('complementary', { name: 'История публикаций' })
  return {
    toggle: page.getByRole('button', { name: 'История', exact: true }),
    panel,
    versions: panel.getByRole('listitem'),
    /** Кнопка версии по номеру: «Версия 1», но не «Версия 10» */
    version: (n: number) => panel.getByRole('button', { name: new RegExp(`^Версия ${n}(?!d)`) }),
    restoreButton: panel.getByRole('button', { name: 'Вернуть в черновик' }),
    showDraftButton: panel.getByRole('button', { name: 'Показать черновик' }),
  }
}

/** Медиатека сайта так, как её видит человек */
export function mediaScreen(page: Page) {
  const grid = page.getByRole('list', { name: 'Картинки сайта' })
  return {
    open: async () => {
      const site = await findDemoSite()
      await page.goto(`/sites/${site.id}/media`)
      await expect(page.getByRole('heading', { level: 1, name: 'Медиатека' })).toBeVisible()
    },
    fileInput: page.getByLabel('Загрузить картинку'),
    status: page.getByRole('status'),
    alert: page.getByRole('alert'),
    grid,
    item: (name: string) => grid.getByRole('listitem').filter({ hasText: name }),
    deleteButton: (name: string) => page.getByRole('button', { name: `Удалить «${name}»` }),
  }
}
