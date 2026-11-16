import { Footer, form, PageContent, readSiteSettings } from '@averra/schema'
import { describe, expect, it, vi } from 'vitest'
import { leadAttributionNeeded } from './lead-attribution'
import { oncePerBuild } from './once-per-build'

const page = (slug: string, content: unknown = { blocks: [] }) => ({
  slug,
  content: PageContent.parse(content),
})
const formPage = (hidden = false, window = false) =>
  page('contact', {
    blocks: [{ id: 'lead', type: 'form', props: form.example, hidden }],
    ...(window ? { window: {} } : {}),
  })
const input = (pages = [page('index')], footer: ReturnType<typeof Footer.parse> | null = null) => ({
  pages,
  site: {
    name: 'Сайт',
    header: null,
    footer,
    settings: readSiteSettings({ cookies: { policyPage: 'privacy' } }),
  },
  customBlocks: {},
  media: {},
})

describe('скрипт меток для всего сайта', () => {
  it('без форм не нужен ни одной странице, включая скрытые блоки', () => {
    expect(leadAttributionNeeded(input([]))).toBe(false)
    expect(leadAttributionNeeded(input([page('index'), page('about')]))).toBe(false)
    expect(leadAttributionNeeded(input([page('index'), formPage(true)]))).toBe(false)
  })

  it('форма на другой опубликованной странице включает скрипт и на главной без формы', async () => {
    const snapshot = input([page('index'), formPage()])
    const decide = vi.fn(() => leadAttributionNeeded(snapshot))
    const load = oncePerBuild(async () => ({ ...snapshot, hasLeadForms: decide() }), false)
    for (const slug of ['index', 'contact', '404']) {
      const data = await load()
      expect(data.hasLeadForms, slug).toBe(true)
    }
    expect(snapshot.pages[0]?.content.blocks).toEqual([])
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('учитывает форму страницы-окна, а скрытую форму окна — нет', () => {
    expect(leadAttributionNeeded(input([page('index'), formPage(false, true)]))).toBe(true)
    expect(leadAttributionNeeded(input([page('index'), formPage(true, true)]))).toBe(false)
  })

  it('форма большого подвала доступна только с опубликованной политикой', () => {
    const footer = Footer.parse({ layout: 'big' })
    expect(leadAttributionNeeded(input([page('index')], footer))).toBe(false)
    expect(leadAttributionNeeded(input([page('index'), page('privacy')], footer))).toBe(true)
    expect(
      leadAttributionNeeded(
        input([page('index'), page('privacy')], Footer.parse({ layout: 'simple' })),
      ),
    ).toBe(false)
  })

  it('если подвал скрыт на всех опубликованных страницах, формы на сайте нет', () => {
    const pages = ['index', 'privacy'].map((slug) => page(slug, { blocks: [], hideFooter: true }))
    expect(leadAttributionNeeded(input(pages, Footer.parse({ layout: 'big' })))).toBe(false)
    expect(
      leadAttributionNeeded(input([...pages, page('about')], Footer.parse({ layout: 'big' }))),
    ).toBe(true)
  })

  it('свой подвал заменяет форму, а недоступный свой вид возвращает стандартную форму', () => {
    const snapshot = input(
      [page('index'), page('privacy')],
      Footer.parse({ layout: 'big', custom: { key: 'own-footer', props: {} } }),
    )
    expect(leadAttributionNeeded(snapshot)).toBe(true)
    expect(
      leadAttributionNeeded({
        ...snapshot,
        customBlocks: {
          'own-footer': {
            key: 'own-footer',
            title: 'Свой подвал',
            placement: 'footer',
            fields: [],
            template: '<p>Свой подвал</p>',
            css: '',
          },
        },
      }),
    ).toBe(false)
  })
})
