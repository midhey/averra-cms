// @vitest-environment happy-dom
import {
  emptyFooterContacts,
  Footer,
  type FooterContacts,
  type FooterInput,
  FooterTone,
  footerPalette,
  type ThemeColorRole,
} from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SiteFooter } from './SiteFooter'
import { siteFooterView } from './view'

/**
 * Текст CSS-модуля подвала: Vitest отдаёт CSS-модули пустыми, поэтому читаем файл. Модули Node —
 * через process.getBuiltinModule: пакет блоков собирается без типов Node. Путь — строкой: URL в
 * окружении happy-dom не тот, что ждёт fs
 */
type NodeModules = {
  'node:fs': { readFileSync: (path: string, encoding: 'utf8') => string }
  'node:url': { fileURLToPath: (url: string) => string }
}
const builtin = <K extends keyof NodeModules>(id: K) =>
  (
    globalThis as unknown as {
      process: { getBuiltinModule: (id: K) => NodeModules[K] }
    }
  ).process.getBuiltinModule(id)
const css = builtin('node:fs').readFileSync(
  builtin('node:url')
    .fileURLToPath(import.meta.url)
    .replace(/[^/\\]+$/, 'SiteFooter.module.css'),
  'utf8',
)

// Подвал сайта: три вида по концепту, обязательные ссылки (политика и «Настройки cookie») в
// каждом, разделы — пункты меню шапки, данные «Организации», форма «Перезвоните мне» без JS и
// только с политикой, скрытый на странице подвал. Палитра CSS — та же, что в схеме

const pages = [
  { slug: 'index', blockIds: ['hero', 'pricing'] },
  { slug: 'raboty', blockIds: [] },
]
const header = {
  menu: [
    { label: 'Цены', page: 'index', block: 'pricing' },
    { label: 'Работы', page: 'raboty' },
    { label: 'Акции', page: 'akcii' },
  ],
}
const contacts: FooterContacts = {
  name: 'ИП Иванов И. И.',
  phone: '+7 (342) 000-00-00',
  email: 'info@remont.ru',
  address: 'Пермь, ул. Ленина, 1',
  inn: '590000000000',
  ogrn: '304590000000000',
  socials: ['https://vk.com/remont', 'https://t.me/remont'],
}
const legal = { policyHref: '/privacy', cookieSettings: true }

type Options = {
  slug?: string
  hideFooter?: boolean
  contacts?: FooterContacts
  legal?: typeof legal | { policyHref: null; cookieSettings: boolean }
  header?: typeof header | null
  formAction?: string | null
}

function viewOf(footer: FooterInput | null, options: Options = {}) {
  return siteFooterView({
    footer: footer && Footer.parse(footer),
    siteName: 'Ремонт у Ивана',
    page: { slug: options.slug ?? 'raboty', content: { hideFooter: options.hideFooter } },
    header: options.header === undefined ? header : options.header,
    pages,
    contacts: options.contacts ?? contacts,
    legal: options.legal ?? legal,
    formAction: options.formAction,
    year: 2026,
  })
}

function render(footer: FooterInput, options: Options = {}) {
  const view = viewOf(footer, options)
  if (!view) throw new Error('Подвала нет')
  document.body.innerHTML = renderToStaticMarkup(<SiteFooter view={view} />)
  const root = document.querySelector('footer')
  if (!root) throw new Error('Нет footer')
  return root
}

const texts = (root: ParentNode, selector: string) =>
  [...root.querySelectorAll(selector)].map((node) => node.textContent?.trim())

describe('siteFooterView', () => {
  it('подвал не публиковали или страница его скрыла — null: внизу прежняя полоса', () => {
    expect(viewOf(null)).toBeNull()
    expect(viewOf({ layout: 'columns' }, { hideFooter: true })).toBeNull()
  })

  it('разделы — пункты меню шапки на опубликованное, текущий отмечен; у простого — нет', () => {
    const view = viewOf({ layout: 'columns' })
    expect(view?.sections).toEqual([
      { label: 'Цены', href: '/#pricing', current: false },
      { label: 'Работы', href: '/raboty/', current: true },
    ])
    expect(viewOf({ layout: 'simple' })?.sections).toEqual([])
    expect(viewOf({ layout: 'columns', sections: false })?.sections).toEqual([])
    expect(viewOf({ layout: 'columns' }, { header: null })?.sections).toEqual([])
  })

  it('реквизиты и «©»: название организации, совпадающее с сайтом, второй раз не пишем', () => {
    expect(viewOf({})?.copyright).toBe('© 2026 Ремонт у Ивана')
    expect(viewOf({})?.requisites).toEqual([
      'ИП Иванов И. И.',
      'ИНН 590000000000',
      'ОГРНИП 304590000000000',
    ])
    expect(viewOf({}, { contacts: { ...contacts, name: 'Ремонт у Ивана' } })?.requisites).toEqual([
      'ИНН 590000000000',
      'ОГРНИП 304590000000000',
    ])
  })

  it('форма — только в большом и только с опубликованной политикой', () => {
    expect(viewOf({ layout: 'big' })?.callback).toMatchObject({
      title: 'Остались вопросы?',
      policyHref: '/privacy',
    })
    expect(viewOf({ layout: 'columns' })?.callback).toBeNull()
    expect(
      viewOf({ layout: 'big' }, { legal: { policyHref: null, cookieSettings: true } })?.callback,
    ).toBeNull()
  })

  it('страницы нет в базе (стандартная 404) — формы нет: API заявку с неё не примет', () => {
    const view = viewOf({ layout: 'big' }, { formAction: null })
    expect(view?.layout).toBe('big')
    expect(view?.callback).toBeNull()
    expect(view?.legal.policyHref).toBe('/privacy')
  })
})

describe('SiteFooter', () => {
  it('простой: одна строка — «©», реквизиты, политика и «Настройки cookie»', () => {
    const root = render({ layout: 'simple' })
    expect(root.dataset.layout).toBe('simple')
    expect(texts(root, 'p')).toEqual([
      '© 2026 Ремонт у Ивана · ИП Иванов И. И. · ИНН 590000000000 · ОГРНИП 304590000000000',
    ])
    expect(root.querySelector('nav')).toBeNull()
    expect(root.querySelector('a[href="/privacy"]')?.textContent).toBe(
      'Политика конфиденциальности',
    )
    const cookie = root.querySelector<HTMLButtonElement>('button[data-consent-open]')
    expect(cookie?.textContent).toBe('Настройки cookie')
    // Без JS кнопка скрыта: её показывает скрипт cookie-уведомления
    expect(cookie?.hidden).toBe(true)
  })

  it('с колонками: о компании, разделы в nav с подписью, контакты, соцсети', () => {
    const root = render({ layout: 'columns', about: 'Ремонт квартир под ключ' })
    expect(texts(root, 'h2')).toEqual(['Разделы', 'Контакты', 'Мы в соцсетях'])
    expect(root.textContent).toContain('Ремонт квартир под ключ')
    const nav = root.querySelector('nav')
    expect(nav?.getAttribute('aria-label')).toBe('Разделы сайта')
    expect(texts(nav ?? root, 'a')).toEqual(['Цены', 'Работы'])
    expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe('Работы')
    const address = root.querySelector('address')
    expect(address?.querySelector('a[href="tel:+73420000000"]')?.textContent).toBe(
      '+7 (342) 000-00-00',
    )
    expect(address?.querySelector('a[href="mailto:info@remont.ru"]')).not.toBeNull()
    expect(address?.textContent).toContain('Пермь, ул. Ленина, 1')
    // Соцсеть: видна короткая подпись, диктор слышит и её, и название сети
    const vk = root.querySelector('a[href="https://vk.com/remont"]')
    expect(vk?.querySelector('[aria-hidden="true"]')?.textContent).toBe('VK')
    expect(vk?.textContent).toContain('VK — ВКонтакте')
    expect(root.querySelector('a[href="/privacy"]')).not.toBeNull()
    expect(root.querySelector('button[data-consent-open]')).not.toBeNull()
    expect(root.querySelector('form')).toBeNull()
  })

  it('пустые колонки не выводятся: без «Организации» и меню — только название', () => {
    const root = render({ layout: 'columns' }, { contacts: emptyFooterContacts, header: null })
    expect(texts(root, 'h2')).toEqual([])
    expect(root.textContent).toContain('Ремонт у Ивана')
  })

  it('большой: форма в API без JS — телефон, согласие с политикой, ловушка, якорь успеха', () => {
    const action = 'https://cms.example.ru/api/forms/site/raboty/~footer'
    const root = render(
      { layout: 'big', tone: 'accent', callback: { title: 'Есть вопросы?' } },
      { formAction: action },
    )
    expect(root.dataset.tone).toBe('accent')
    expect(texts(root, 'h2')).toEqual(['Есть вопросы?', 'Разделы', 'Контакты'])
    const form = root.querySelector('form')
    expect(form?.getAttribute('method')).toBe('post')
    expect(form?.getAttribute('action')).toBe(action)
    const phone = root.querySelector<HTMLInputElement>('input[name="phone"]')
    expect(phone?.type).toBe('tel')
    expect(phone?.required).toBe(true)
    expect(root.querySelector(`label[for="${phone?.id}"]`)?.textContent).toBe('Телефон')
    const consent = root.querySelector<HTMLInputElement>('input[name="consent"]')
    expect(consent?.required).toBe(true)
    expect(consent?.value).toBe('yes')
    expect(root.querySelector(`label[for="${consent?.id}"] a`)?.getAttribute('href')).toBe(
      '/privacy',
    )
    expect(root.querySelector('input[name="website"]')).not.toBeNull()
    expect(root.querySelector('button[type="submit"]')?.textContent).toBe('Перезвоните мне')
    expect(root.querySelector('[id="~footer-sent"]')?.getAttribute('role')).toBe('status')
    // Соцсети большого подвала — в колонке контактов
    expect(root.querySelector('address + ul a[href="https://t.me/remont"]')).not.toBeNull()
    // Обязательные ссылки — и здесь
    expect(root.querySelector('a[href="/privacy"]')).not.toBeNull()
    expect(root.querySelector('button[data-consent-open]')).not.toBeNull()
  })

  it('id формы подвала не совпадают с id блоков страницы', () => {
    const root = render({ layout: 'big' })
    for (const element of root.querySelectorAll('[id]')) {
      expect(element.id.startsWith('~footer')).toBe(true)
    }
  })

  it('без опубликованной политики и в режиме уведомления — нет ни ссылки, ни кнопки', () => {
    const root = render(
      { layout: 'columns' },
      { legal: { policyHref: null, cookieSettings: false } },
    )
    expect(root.querySelector('a[href="/privacy"]')).toBeNull()
    expect(root.querySelector('button')).toBeNull()
  })
})

describe('палитра подвала', () => {
  /** Переменные палитры из правила с селектором selector: --footer-text → text и так далее */
  function paletteOf(selector: string) {
    const start = css.indexOf(`${selector} {`)
    const body = css.slice(start, css.indexOf('}', start))
    const roles: Record<string, string> = {}
    for (const match of body.matchAll(/--footer-([\w-]+):\s*var\(--color-([\w-]+)\)/g)) {
      const part = (match[1] ?? '').replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())
      const role = (match[2] ?? '').replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())
      roles[part] = role
    }
    return roles
  }

  const names: Record<string, string> = {
    bg: 'background',
    text: 'text',
    muted: 'muted',
    focus: 'focus',
    buttonBg: 'buttonBackground',
    buttonText: 'buttonText',
  }

  it('CSS красит подвал теми же ролями, что схема (footerPalette)', () => {
    const selectors: Record<FooterTone, string> = {
      surface: '.footer',
      accent: '.footer[data-tone="accent"]',
    }
    for (const tone of FooterTone.options) {
      const fromCss = paletteOf(selectors[tone])
      const expected: Record<string, ThemeColorRole> = {}
      for (const [cssName, part] of Object.entries(names)) {
        expected[cssName] = footerPalette[tone][part as keyof (typeof footerPalette)[FooterTone]]
      }
      const { line: _line, ...parts } = fromCss
      expect(parts, tone).toEqual(expected)
    }
  })

  it('вне палитры подвал не берёт цветов темы напрямую — только --footer-*', () => {
    const outside = css
      .split('\n')
      .filter((line) => line.includes('var(--color-') && !line.trim().startsWith('--footer-'))
    expect(outside).toEqual([])
  })
})
