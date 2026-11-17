import { stat } from 'node:fs/promises'
import { expect, test } from './fixtures'

test('в настройках скачивается непустой шаблон сайта', async ({ page, demoSite }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Настройки сайта' })).toBeVisible()
  expect(demoSite.id).toBeTruthy()
  const waiting = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать шаблон сайта' }).click()
  const download = await waiting
  expect(download.suggestedFilename()).toMatch(/template.*\.zip$/)
  const path = await download.path()
  if (!path) throw new Error('Скачанный архив не найден')
  expect((await stat(path)).size).toBeGreaterThan(100)
})

test('обзор показывает вычисляемый список «Что заполнить»', async ({ page, demoSite }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: demoSite.name, exact: true })).toBeVisible()
  const checklist = page.getByRole('region', { name: 'Что заполнить' })
  await expect(checklist).toBeVisible()
  await expect(checklist.getByRole('link', { name: 'Организация и реквизиты' })).toHaveAttribute(
    'href',
    '/seo',
  )
  await expect(
    checklist.getByRole('link', { name: 'Документы — подставить своё' }),
  ).toHaveAttribute('href', '/pages')
  await expect(checklist.getByRole('link', { name: 'Почта (SMTP)' })).toHaveAttribute(
    'href',
    '/mail',
  )
  // SITE_URL уже задан в окружении e2e: этот пункт заполнен, даже когда адрес SEO пуст.
  await expect(checklist.getByRole('link', { name: 'Домен', exact: true })).toHaveCount(0)
})
