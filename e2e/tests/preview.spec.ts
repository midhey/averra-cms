import { defaultHeader, demoPage, demoPageTitle } from '@averra/schema'
import { urls } from '../urls'
import { expect, sites, test } from './fixtures'

test('@smoke заказчик видит черновики без входа; навигация, формы и отзыв ссылки', async ({
  page,
  browser,
  demoSite,
}) => {
  const draft = structuredClone(demoPage)
  const hero = draft.blocks.find((block) => block.type === 'hero')
  if (hero?.type !== 'hero') throw new Error('В демо нет первого экрана')
  hero.props.title = 'Правка только для заказчика'
  const param = { siteId: demoSite.id, slug: 'index' }
  expect(
    (
      await sites[':siteId'].pages[':slug'].$put({
        param,
        json: { title: demoPageTitle, content: draft },
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await sites[':siteId'].pages.$post({
        param: { siteId: demoSite.id },
        json: { slug: 'preview-about', title: 'О нас в черновике' },
      })
    ).status,
  ).toBe(201)
  expect(
    (
      await sites[':siteId'].header.$put({
        param: { siteId: demoSite.id },
        json: {
          ...defaultHeader,
          menu: [{ label: 'О нас в черновике', page: 'preview-about' }],
        },
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await sites[':siteId'].script.$put({
        param: { siteId: demoSite.id },
        json: {
          script: 'document.body.dataset.previewScriptRan = "yes"',
          origins: [],
        },
      })
    ).status,
  ).toBe(200)

  await page.goto('/')
  const region = page.getByRole('region', { name: 'Предпросмотр для заказчика' })
  await expect(region.getByLabel('Срок ссылки')).toHaveValue('3')
  await region.getByLabel('Для кого').fill('Проверка заказчика')
  await region.getByRole('button', { name: 'Создать ссылку на черновики' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ссылка на черновики' })
  const link = await dialog.getByLabel('Ссылка для заказчика').inputValue()
  await dialog.getByRole('button', { name: 'Ссылка сохранена' }).click()

  const clean = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const customer = await clean.newPage()
    const requests: string[] = []
    customer.on('request', (request) => {
      if (request.method() === 'POST') requests.push(request.url())
    })
    const response = await customer.goto(link)
    expect(response?.headers()['referrer-policy']).toBe('no-referrer')
    await expect(
      customer.getByText('Черновик сайта, не опубликовано', { exact: false }),
    ).toBeVisible()
    const frame = customer.frameLocator('iframe[title="Черновик сайта"]')
    await expect(frame.getByRole('heading', { name: 'Правка только для заказчика' })).toBeVisible()
    expect(await clean.cookies()).toEqual([])
    await expect(customer.locator('iframe')).toHaveAttribute(
      'sandbox',
      'allow-top-navigation-by-user-activation',
    )
    await expect(frame.locator('script')).toHaveCount(0)
    await expect(frame.locator('body')).not.toHaveAttribute('data-preview-script-ran')
    // Формы отключает document.ts (unit-тест), а рамке без allow-forms их и не отправить: на демо-странице формы нет
    expect(requests).toEqual([])

    // Опубликованный снимок по-прежнему не содержит черновую правку.
    const published = await customer.request.get(`${urls.api}/api/site/snapshot`)
    expect(await published.text()).not.toContain('Правка только для заказчика')
    await frame.getByRole('link', { name: 'О нас в черновике', exact: true }).first().click()
    await expect(customer).toHaveURL(`${link}preview-about/`)
    await expect(customer.locator('iframe')).toBeVisible()
    await expect(customer).toHaveTitle('О нас в черновике — черновик сайта')
    // Якорь внутри черновика работает в самой рамке
    await customer.goto(link)
    await frame.getByRole('link', { name: 'Рассчитать стоимость' }).click()
    await expect(frame.locator('#contact')).toBeInViewport()

    await region.getByRole('button', { name: 'Отозвать', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Отозвать ссылку?' })
      .getByRole('button', { name: 'Отозвать', exact: true })
      .click()
    await expect(region.getByText('Ссылка отозвана:', { exact: false })).toBeVisible()
    await customer.goto(link)
    await expect(customer.getByRole('alert')).toContainText('ссылка истекла, отозвана')
    await expect(customer.locator('iframe')).toHaveCount(0)
  } finally {
    await clean.close()
  }
})
