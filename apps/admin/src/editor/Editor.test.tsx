// @vitest-environment happy-dom
import { demoPage as demoInput, demoPageTitle, PAGE_MAX_BLOCKS, PageContent } from '@averra/schema'
import { defaultTheme } from '@averra/tokens'
import { act, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '../test/render-with-router'
import { Editor, type EditorPage, type EditorSite } from './Editor'

// Как отдаёт API: значения по умолчанию уже подставлены
const demoPage = PageContent.parse(demoInput)

const site: EditorSite = {
  id: 'd0000000-0000-4000-8000-000000000001',
  name: 'Ремонт у Ивана',
  theme: defaultTheme,
  access: 'owner',
}

const published: EditorPage = {
  slug: 'index',
  title: demoPageTitle,
  draft: demoPage,
  publishedTitle: demoPageTitle,
  published: demoPage,
  publishedAt: '2026-10-12T10:30:00.000Z',
}

/** Узкий экран или нет: matchMedia отвечает по этому флагу на любой запрос ширины */
let narrow = false

beforeEach(() => {
  narrow = false
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: query.includes('width') ? narrow : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  // Медиатека сайта пустая; другие запросы тест подменяет сам
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ items: [], maxBytes: 1024 })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const blockList = () => screen.getByRole('navigation', { name: 'Блоки страницы' })
const status = () => within(screen.getByRole('region', { name: 'Страница' })).getByRole('status')

describe('полоса редактора', () => {
  it('«Назад к сайту» ведёт на обзор, название сайта и заголовок страницы на виду', async () => {
    await renderWithRouter(<Editor site={site} page={published} />)
    const back = screen.getByRole('link', { name: 'Назад к сайту' })
    expect(back.getAttribute('href')).toBe(`/sites/${site.id}`)
    expect(screen.getByRole('region', { name: 'Страница' }).textContent).toContain(site.name)
    expect((screen.getByLabelText('Заголовок страницы') as HTMLInputElement).value).toBe(
      demoPageTitle,
    )
  })

  it('плашка: опубликовано → правка → несохранённые правки', async () => {
    const user = userEvent.setup()
    await renderWithRouter(<Editor site={site} page={published} />)
    expect(status().textContent).toBe('Опубликовано')
    await user.type(screen.getByLabelText('Заголовок страницы'), '!')
    expect(status().textContent).toBe('Есть несохранённые правки')
  })

  it('плашка различает «не публиковали» и «правки не на сайте»', async () => {
    await renderWithRouter(
      <Editor
        site={site}
        page={{ ...published, published: null, publishedTitle: null, publishedAt: null }}
      />,
    )
    expect(status().textContent).toBe('Черновик сохранён · не опубликован')
    cleanup()
    await renderWithRouter(<Editor site={site} page={{ ...published, title: 'Новое название' }} />)
    expect(status().textContent).toBe('Сохранено · правки не опубликованы')
  })

  it('после сохранения плашка берёт состояние из ответа API', async () => {
    const user = userEvent.setup()
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        return Response.json({ ...published, title: body.title, draft: body.content })
      }
      return Response.json({ items: [], maxBytes: 1024 })
    })
    vi.stubGlobal('fetch', fetch)
    await renderWithRouter(<Editor site={site} page={published} />)
    const save = screen.getByRole('button', { name: 'Сохранить' })
    // Без правок сохранять нечего: кнопка недоступна, но остаётся в порядке Tab
    expect(save.getAttribute('aria-disabled')).toBe('true')

    await user.type(screen.getByLabelText('Заголовок страницы'), '!')
    expect(save.getAttribute('aria-disabled')).toBeNull()
    await user.click(save)
    // Ответ API: черновик новее опубликованного
    await vi.waitFor(() => expect(status().textContent).toBe('Сохранено · правки не опубликованы'))
    // Следующая правка снимает итог: дальше плашка говорит о черновике
    await user.type(screen.getByLabelText('Заголовок страницы'), '{Backspace}')
    expect(status().textContent).toBe('Есть несохранённые правки')
  })

  it('клиенту нет «Опубликовать»', async () => {
    await renderWithRouter(<Editor site={{ ...site, access: 'client' }} page={published} />)
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Опубликовать' })).toBeNull()
  })
})

describe('блоки', () => {
  it('«Добавить блок» — окно с каталогом: блок встаёт после выбранного и выбран', async () => {
    const user = userEvent.setup()
    await renderWithRouter(<Editor site={site} page={published} />)
    await user.click(within(blockList()).getByRole('button', { name: 'Добавить блок' }))
    const dialog = screen.getByRole('dialog', { name: 'Добавить блок' })
    // У каждого блока каталога — название, описание и пример
    const option = within(dialog).getByRole('button', { name: /^Призыв к действию/ })
    expect(option.textContent).toContain('подтолкнуть к следующему шагу')
    expect(option.textContent).toContain('Пример: «Готовы начать?»')
    expect(dialog.textContent).toContain('Блок встанет после')

    await user.click(option)
    const items = within(blockList()).getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[1]?.textContent).toContain('Призыв к действиюГотовы начать?')
    expect(
      within(items[1] as HTMLElement)
        .getByRole('button', { name: /^Призыв к действию/ })
        .getAttribute('aria-current'),
    ).toBe('true')
    expect(screen.getByRole('heading', { level: 2, name: 'Призыв к действию' })).toBeTruthy()
  })

  it('стрелки и удаление — только у выбранного блока', async () => {
    const user = userEvent.setup()
    await renderWithRouter(<Editor site={site} page={published} />)
    const [first, second] = within(blockList()).getAllByRole('listitem') as HTMLElement[]
    expect(within(first as HTMLElement).getByRole('button', { name: 'Удалить блок' })).toBeTruthy()
    expect(within(second as HTMLElement).queryByRole('button', { name: 'Удалить блок' })).toBeNull()
    await user.click(within(second as HTMLElement).getByRole('button', { name: /^Преимущества/ }))
    expect(within(second as HTMLElement).getByRole('button', { name: 'Удалить блок' })).toBeTruthy()
  })

  it(`на пределе ${PAGE_MAX_BLOCKS} блоков «Добавить блок» недоступна, но в фокусе и с пояснением`, async () => {
    const user = userEvent.setup()
    const hero = demoPage.blocks[0]
    if (!hero) throw new Error('В демо-странице нет блоков')
    const full: EditorPage = {
      ...published,
      draft: {
        blocks: Array.from({ length: PAGE_MAX_BLOCKS }, (_, index) => ({
          ...hero,
          id: `block-${index}`,
        })),
      },
    }
    await renderWithRouter(<Editor site={site} page={full} />)
    const add = within(blockList()).getByRole('button', { name: 'Добавить блок' })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    // Не disabled: кнопка остаётся в порядке Tab, и диктор прочитает пояснение
    expect((add as HTMLButtonElement).disabled).toBe(false)
    const description = document.getElementById(add.getAttribute('aria-describedby') ?? '')
    expect(description?.textContent).toContain('больше не поместится')
    await user.click(add)
    expect(screen.queryByRole('dialog', { name: 'Добавить блок' })).toBeNull()
  })
})

describe('заголовок страницы', () => {
  it('поле похоже на текст, но видно, что его можно править: карандаш и подсказка', async () => {
    await renderWithRouter(<Editor site={site} page={published} />)
    const input = screen.getByLabelText('Заголовок страницы')
    expect(input.getAttribute('title')).toMatch(/изменить/)
    const pencil = input.nextElementSibling
    expect(pencil?.tagName.toLowerCase()).toBe('svg')
    expect(pencil?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('узкий экран', () => {
  it('колонки — вкладки; выбор блока открывает «Поля» и ставит фокус на вкладку', async () => {
    narrow = true
    const user = userEvent.setup()
    await renderWithRouter(<Editor site={site} page={published} />)
    const tabs = screen.getByRole('tablist', { name: 'Части редактора' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Блоки', 'Предпросмотр', 'Поля'])
    const fieldsTab = within(tabs).getByRole('tab', { name: 'Поля' })
    const fieldsPanel = document.getElementById(fieldsTab.getAttribute('aria-controls') ?? '')
    expect(fieldsPanel?.hidden).toBe(true)
    // На телефоне предпросмотр начинается с телефона, переключатель — над ним
    const previewTab = within(tabs).getByRole('tab', { name: 'Предпросмотр' })
    const preview = document.getElementById(previewTab.getAttribute('aria-controls') ?? '')
    if (!preview) throw new Error('Нет панели предпросмотра')
    expect(
      (within(preview).getByRole('radio', { hidden: true, name: 'Телефон' }) as HTMLInputElement)
        .checked,
    ).toBe(true)

    await user.click(within(blockList()).getByRole('button', { name: /^Преимущества/ }))
    expect(fieldsTab.getAttribute('aria-selected')).toBe('true')
    expect(fieldsPanel?.hidden).toBe(false)
    expect(document.activeElement).toBe(fieldsTab)
    expect(screen.getByRole('heading', { level: 2, name: 'Преимущества' })).toBeTruthy()

    // Переставить и удалить блок можно, не уходя со вкладки «Блоки»: действия у каждого блока
    await user.click(within(tabs).getByRole('tab', { name: 'Блоки' }))
    const items = within(blockList()).getAllByRole('listitem') as HTMLElement[]
    for (const item of items) {
      expect(within(item).getByRole('button', { name: 'Поднять блок' })).toBeTruthy()
      expect(within(item).getByRole('button', { name: 'Удалить блок' })).toBeTruthy()
    }
    const last = items.at(-1) as HTMLElement
    const lastName = within(last).getAllByRole('button')[1]?.textContent
    await user.click(within(last).getByRole('button', { name: 'Поднять блок' }))
    expect(within(tabs).getByRole('tab', { name: 'Блоки' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    const moved = within(blockList()).getAllByRole('listitem').at(-2) as HTMLElement
    expect(within(moved).getAllByRole('button')[1]?.textContent).toBe(lastName)

    // Открытая история живёт во вкладке полей и называет её
    await user.click(screen.getByRole('button', { name: 'История' }))
    expect(fieldsTab.textContent).toBe('История')
  })

  it('на широком экране вкладок нет, переключатель ширины — в полосе', async () => {
    await renderWithRouter(<Editor site={site} page={published} />)
    expect(screen.queryByRole('tablist')).toBeNull()
    const banner = screen.getByRole('banner')
    await act(async () => {})
    expect(
      (within(banner).getByRole('radio', { name: 'Десктоп' }) as HTMLInputElement).checked,
    ).toBe(true)
  })
})
