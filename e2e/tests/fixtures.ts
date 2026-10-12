import type { AppType } from '@cms/api'
import { demoPage, demoPageTitle } from '@cms/schema'
import { test as base, expect, type Page } from '@playwright/test'
import { hc } from 'hono/client'
import { urls } from '../urls'

const sites = hc<AppType>(urls.api).api.sites

/**
 * Возвращает демо-страницу в исходное состояние: черновик и опубликованная версия — демо.
 * Так каждый тест стартует с одного и того же известного состояния, в каком бы порядке ни шёл
 */
async function resetDemoPage() {
  const [site] = await (await sites.$get()).json()
  if (!site) throw new Error('В базе e2e нет демо-сайта: API должен был положить его при старте')
  const param = { siteId: site.id, slug: 'index' }
  const page = sites[':siteId'].pages[':slug']
  const saved = await page.$put({ param, json: { title: demoPageTitle, content: demoPage } })
  expect(saved.status, 'сброс черновика демо-страницы').toBe(200)
  const published = await page.publish.$post({ param })
  expect(published.status, 'публикация демо-страницы').toBe(200)
}

export const test = base.extend<{ demoPage: undefined }>({
  demoPage: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright требует деструктуризацию первого аргумента фикстуры
    async ({}, use) => {
      await resetDemoPage()
      await use(undefined)
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
    open: async () => {
      await page.goto('/')
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
export async function openSite(page: Page) {
  const site = await page.context().newPage()
  await site.goto(urls.renderer)
  return site
}
