// @vitest-environment happy-dom
import {
  CustomBlockDraft,
  type CustomBlockDraftInput,
  emptyFooterContacts,
  Footer,
  type FooterInput,
  Header,
  type HeaderInput,
  starterCustomBlock,
} from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { samplePlaceData } from '../custom/place-data'
import { customBlockProblems, renderCustomPlaceHtml } from '../custom/render'
import { siteFooterView } from '../footer/view'
import { headerScriptNeeded, siteHeaderView } from '../header/view'
import { FooterSlot, HeaderSlot, settlePlace } from './CustomPlace'

// Свои шапка и подвал: данные места в шаблоне (меню, кнопка, логотип, «Организация», документы),
// проверка шаблона места, корень Averra с атрибутами для CSS и скрипта, откат на стандартные и
// строка обязательных документов без дублей

const pages = [
  { slug: 'index', blockIds: ['hero', 'pricing'] },
  { slug: 'about', blockIds: [] },
  { slug: 'privacy', blockIds: [] },
]
const menu = [
  { label: 'Цены', page: 'index', block: 'pricing' },
  { label: 'О нас', page: 'about', mobileLabel: 'Мы' },
  { label: 'Telegram', url: 'https://t.me/remont' },
  { label: 'Акции', page: 'akcii' },
]
const organization = {
  ...emptyFooterContacts,
  name: 'ИП Иванов',
  phone: '+7 900 000-00-00',
  inn: '590000000000',
}
const legal = { policyHref: '/privacy', consentHref: '/consent', cookieSettings: true }

const headerDefinition = starterCustomBlock('my-header', 'Моя шапка', 'header')
const footerDefinition = starterCustomBlock('my-footer', 'Мой подвал', 'footer')
const definitions = { 'my-header': headerDefinition, 'my-footer': footerDefinition }

function headerView(input: HeaderInput, page: { slug?: string; shortHeader?: boolean } = {}) {
  return siteHeaderView({
    header: Header.parse({ menu, ...input }),
    siteName: 'Ремонт у Ивана',
    page: {
      slug: page.slug ?? 'about',
      content: { blocks: [], shortHeader: page.shortHeader },
    },
    pages,
    contacts: { phone: '', address: '' },
    organization,
    legal,
    year: 2026,
  })
}

function footerView(input: FooterInput) {
  return siteFooterView({
    footer: Footer.parse(input),
    siteName: 'Ремонт у Ивана',
    page: { slug: 'about', content: {} },
    header: Header.parse({ menu, button: { label: 'Заявка', page: 'index', block: 'pricing' } }),
    pages,
    contacts: organization,
    legal: { policyHref: legal.policyHref, cookieSettings: true },
    consentHref: '/consent',
    year: 2026,
  })
}

const place = (key: string, props: Record<string, unknown> = {}) => ({ custom: { key, props } })

describe('данные своего вида', () => {
  it('меню — только на опубликованное, с текущим пунктом, подписью телефона и новой вкладкой', () => {
    const view = headerView(place('my-header'))
    const site = view?.custom?.data.site
    expect(site?.menu).toEqual([
      {
        label: 'Цены',
        mobile_label: null,
        href: '/#pricing',
        current: false,
        new_tab: false,
        window: false,
      },
      {
        label: 'О нас',
        mobile_label: 'Мы',
        href: '/about/',
        current: true,
        new_tab: false,
        window: false,
      },
      {
        label: 'Telegram',
        mobile_label: null,
        href: 'https://t.me/remont',
        current: false,
        new_tab: true,
        window: false,
      },
    ])
    expect(site?.organization).toMatchObject({
      name: 'ИП Иванов',
      phone_href: 'tel:+79000000000',
      email: null,
      requisites: ['ИП Иванов', 'ИНН 590000000000'],
    })
    expect(site?.legal).toEqual({
      policy_href: '/privacy',
      consent_href: '/consent',
      cookie_settings: true,
    })
    expect(site?.logo).toEqual({ image: null, mark: null, text: 'Ремонт у Ивана' })
    expect(site?.copyright).toBe('© 2026 Ремонт у Ивана')
    expect(view?.custom?.data.page).toEqual({ slug: 'about', short: false, home: false })
  })

  it('«Минимум» прячет меню стандартной шапки, а своей — нет', () => {
    const view = headerView({ ...place('my-header'), layout: 'minimal' })
    expect(view?.menu).toEqual([])
    expect(view?.custom?.data.site.menu).toHaveLength(3)
  })

  it('служебная страница: page.short, без меню и кнопки', () => {
    const view = headerView(
      { ...place('my-header'), button: { label: 'Заявка', page: 'index' } },
      { slug: 'privacy', shortHeader: true },
    )
    expect(view?.custom?.data.page).toEqual({ slug: 'privacy', short: true, home: false })
    expect(view?.custom?.data.site.menu).toEqual([])
    expect(view?.custom?.data.site.button).toBeNull()
  })

  it('стандартная шапка — без своего вида; скрипт нужен своей шапке с меню', () => {
    expect(headerView({})?.custom).toBeNull()
    const custom = headerView({ ...place('my-header'), layout: 'minimal' })
    expect(headerScriptNeeded(custom)).toBe(true)
  })

  it('подвал получает меню и кнопку шапки, документы и логотип', () => {
    const view = footerView(place('my-footer'))
    expect(view?.custom?.data.site.menu.map((item) => item.label)).toEqual([
      'Цены',
      'О нас',
      'Telegram',
    ])
    expect(view?.custom?.data.site.button?.href).toBe('/#pricing')
    // Согласие выключено в подвале — обязательной ссылкой его нет, а в данных шаблона оно есть
    expect(view?.custom?.legal.consentHref).toBeNull()
    expect(view?.custom?.data.site.legal.consent_href).toBe('/consent')
    expect(footerView({ ...place('my-footer'), consent: true })?.custom?.legal.consentHref).toBe(
      '/consent',
    )
  })
})

describe('проверка шаблона места', () => {
  it('заготовки шапки и подвала — без ошибок', () => {
    for (const definition of [headerDefinition, footerDefinition]) {
      const errors = customBlockProblems(definition).filter((one) => one.level === 'error')
      expect(errors, definition.key).toEqual([])
    }
  })

  it('опечатка в данных места и site в обычном блоке — ошибки', () => {
    const typo = { ...headerDefinition, template: '<p>{{ site.manu }} {{ page.shrt }}</p>' }
    const messages = customBlockProblems(typo).map((one) => one.message)
    expect(messages).toContain(
      'Нет данных «site.manu»: есть site.name, site.home, site.menu, site.button, site.logo, site.organization, site.legal, site.year, site.copyright',
    )
    expect(messages.some((one) => one.startsWith('Нет данных «page.shrt»'))).toBe(true)
    const block = CustomBlockDraft.parse({
      ...starterCustomBlock('promo', 'Промо'),
      template: '<p>{{ site.name }}</p>',
    })
    expect(customBlockProblems(block).map((one) => one.message)).toContain(
      'Нет поля «site»: ключи полей — title, text',
    )
  })

  it('опечатка глубже первого уровня — тоже ошибка, и в цикле по site.menu', () => {
    const typo = {
      ...headerDefinition,
      template: [
        '<p>{{ site.organization.phon }} {{ site.logo.imgae }} {{ site.legal.policy }}</p>',
        '{% for item in site.menu %}<a href="{{ item.hreff }}">{{ item.label }}</a>{% endfor %}',
        '{% for one in site.organization.socials %}{{ one.lable }}{% endfor %}',
        '<p>{{ site.menu.first.label }} {{ site.menu.size }} {{ site.button.new_tab }}</p>',
      ].join('\n'),
    }
    const messages = customBlockProblems(typo)
      .filter((one) => one.level === 'error')
      .map((one) => one.message.split(':')[0])
    expect(messages).toEqual([
      'Нет данных «site.organization.phon»',
      'Нет данных «site.logo.imgae»',
      'Нет данных «site.legal.policy»',
      'Нет данных «item.hreff»',
      'Нет данных «one.lable»',
    ])
  })

  it('CSS подвала не прячет строку документов: правило по ней — ошибка', () => {
    const hiding = {
      ...footerDefinition,
      css: '[data-legal-footer] { display: none; }\n:scope [data-legal-footer] a { opacity: 0 }\n[data-legal-footer] { color: inherit; gap: 1rem }',
    }
    const errors = customBlockProblems(hiding).filter(
      (one) => one.level === 'error' && one.part === 'css',
    )
    expect(errors.map((one) => one.line)).toEqual([1, 2])
    expect(errors[0]?.message).toMatch(/прячет строку документов/)
    // У шапки строки документов нет — правило ничего не значит
    expect(
      customBlockProblems({ ...headerDefinition, css: hiding.css }).filter(
        (one) => one.level === 'error',
      ),
    ).toEqual([])
  })

  it('кнопка заготовки шапки открывается в новой вкладке по new_tab', () => {
    const data = samplePlaceData()
    if (!data.site.button) throw new Error('нет кнопки')
    data.site.button.new_tab = true
    const html = renderCustomPlaceHtml(headerDefinition, {}, data, {
      id: 'site-header',
      media: {},
      priority: false,
    })
    expect(html).toMatch(/<a class="button" href="[^"]*" target="_blank" rel="noopener">/)
  })

  it('кнопка и пункты меню заготовки — с data-av-window по флажку «Открывать в окне»', () => {
    const data = samplePlaceData()
    if (!data.site.button) throw new Error('нет кнопки')
    const render = () =>
      renderCustomPlaceHtml(headerDefinition, {}, data, {
        id: 'site-header',
        media: {},
        priority: false,
      })
    expect(render()).not.toContain('data-av-window')
    data.site.button.window = true
    for (const item of data.site.menu) item.window = true
    const html = render()
    expect(html).toMatch(/<a class="button"[^>]* data-av-window[^>]*>/)
    // Пункт меню — и в строке меню, и в меню телефона
    expect(html.match(/<a class="(?:panel-)?link"[^>]* data-av-window/g)?.length).toBe(
      data.site.menu.length * 2,
    )
  })

  it('меню шапки без <details> — предупреждение', () => {
    const flat = {
      ...headerDefinition,
      template:
        '<nav><ul>{% for item in site.menu %}<li><a href="{{ item.href }}">{{ item.label }}</a></li>{% endfor %}</ul></nav>',
    }
    const warning = customBlockProblems(flat).find((one) => one.level === 'warning')
    expect(warning?.message).toMatch(/^Меню без <details>/)
  })

  it('рендер на данных: экранирование и очистка как у блока', () => {
    const data = samplePlaceData()
    data.site.name = '<img src=x onerror=alert(1)>'
    const html = renderCustomPlaceHtml(
      { ...footerDefinition, template: '<p class="name">{{ site.name }}</p>' },
      {},
      data,
      { id: 'site-footer', media: {}, priority: false },
    )
    expect(html).toBe('<p class="name">&lt;img src=x onerror=alert(1)&gt;</p>')
  })
})

describe('свои шапка и подвал на странице', () => {
  it('шапка — корень Averra с данными для CSS и скрипта, шаблон внутри обёртки', () => {
    const view = headerView({ ...place('my-header', { tagline: 'с 2010 года' }), condense: true })
    if (!view) throw new Error('нет шапки')
    const html = renderToStaticMarkup(
      <HeaderSlot view={view} media={{}} definitions={definitions} />,
    )
    expect(html).toContain('href="#content">К содержимому</a>')
    expect(html).toContain('data-header-sentinel="far"')
    expect(html).toMatch(
      /<header class="[^"]*" data-site-header="" data-custom-block="my-header" data-custom-place="header" data-sticky="" data-condense="">/,
    )
    expect(html).toContain('<div data-custom-block-root="">')
    expect(html).toContain('<span class="tagline">с 2010 года</span>')
    expect(html).toContain('href="/about/" aria-current="page"')
    expect(html).toContain('<details class="menu">')
  })

  it('своего вида нет — стандартная шапка; в предпросмотре — причина', () => {
    const view = headerView(place('gone'))
    if (!view) throw new Error('нет шапки')
    const problems: string[] = []
    const html = renderToStaticMarkup(
      <HeaderSlot
        view={view}
        media={{}}
        definitions={definitions}
        onCustomError={(message) => problems.push(message)}
      />,
    )
    expect(html).not.toContain('data-custom-block')
    expect(html).toContain('data-header-menu')
    expect(problems).toEqual([
      'Своего вида шапки «gone» нет на сайте: его не опубликовали или удалили',
    ])
    const preview = renderToStaticMarkup(
      <HeaderSlot view={view} media={{}} definitions={definitions} preview />,
    )
    expect(preview).toContain('role="alert"')
    // Вид подвала на месте шапки — тоже стандартная
    const wrong = headerView(place('my-footer'))
    if (!wrong) throw new Error('нет шапки')
    expect(
      renderToStaticMarkup(<HeaderSlot view={wrong} media={{}} definitions={definitions} />),
    ).not.toContain('data-custom-block')
  })

  it('подвал без ссылок на документы — строка документов Averra после шаблона', () => {
    const view = footerView({ ...place('my-footer'), consent: true })
    if (!view) throw new Error('нет подвала')
    const html = renderToStaticMarkup(
      <FooterSlot view={view} media={{}} definitions={definitions} />,
    )
    const legal = html.slice(html.indexOf('data-legal-footer'))
    expect(html.indexOf('data-custom-block-root')).toBeLessThan(html.indexOf('data-legal-footer'))
    expect(legal).toMatch(/<a class="[^"]*" href="\/privacy">Политика конфиденциальности<\/a>/)
    expect(legal).toContain('href="/consent">Согласие на обработку персональных данных</a>')
    expect(legal).toContain('data-consent-open=""')
  })

  it('ссылку, которую шаблон вывел сам, Averra второй раз не пишет', () => {
    const own: CustomBlockDraftInput = {
      ...footerDefinition,
      template:
        '<p><a href="{{ site.legal.policy_href }}">Политика</a> <a href="{{ site.legal.consent_href }}">Согласие</a></p>',
    }
    const view = footerView({ ...place('my-footer'), consent: true })
    if (!view) throw new Error('нет подвала')
    const html = renderToStaticMarkup(
      <FooterSlot
        view={view}
        media={{}}
        definitions={{ 'my-footer': CustomBlockDraft.parse(own) }}
      />,
    )
    expect(html.match(/href="\/privacy"/g)).toHaveLength(1)
    expect(html.match(/href="\/consent"/g)).toHaveLength(1)
    // Осталась только кнопка cookie: без JS строка скрыта, её показывает скрипт уведомления
    expect(html).toMatch(/<div class="[^"]*" data-legal-footer="" hidden="">/)
  })

  it('ссылку текстом, спрятанную или пустую Averra не считает выведенной', () => {
    const templates = [
      '<p>Пишите href="{{ site.legal.policy_href }}"</p>',
      '<a href="{{ site.legal.policy_href }}" hidden>Политика</a>',
      '<a href="{{ site.legal.policy_href }}" aria-hidden="true">Политика</a>',
      '<div hidden><a href="{{ site.legal.policy_href }}">Политика</a></div>',
      '<a href="{{ site.legal.policy_href }}"> </a>',
    ]
    const view = footerView(place('my-footer'))
    if (!view) throw new Error('нет подвала')
    for (const template of templates) {
      const own = CustomBlockDraft.parse({ ...footerDefinition, template })
      const html = renderToStaticMarkup(
        <FooterSlot view={view} media={{}} definitions={{ 'my-footer': own }} />,
      )
      const legal = html.slice(html.indexOf('data-legal-footer'))
      expect(legal, template).toContain('href="/privacy">Политика конфиденциальности</a>')
    }
  })

  it('settlePlace решает до вёрстки: невыводимый вид — без custom, выводимый — с готовым HTML', () => {
    const good = headerView(place('my-header'))
    const bad = headerView(place('my-footer'))
    if (!good || !bad) throw new Error('нет шапки')
    const problems: string[] = []
    const settledBad = settlePlace(bad, 'header', definitions, {}, [], (one) => problems.push(one))
    expect(settledBad.view.custom).toBeNull()
    expect(settledBad.html).toBeUndefined()
    expect(problems).toHaveLength(1)
    const settled = settlePlace(good, 'header', definitions, {})
    expect(settled.view.custom?.key).toBe('my-header')
    // Готовый HTML слот выводит как есть, второй раз шаблон не рендерит
    const html = renderToStaticMarkup(
      <HeaderSlot view={settled.view} media={{}} definitions={{}} html={settled.html} />,
    )
    expect(html).toContain('data-custom-block="my-header"')
  })

  it('подвал, который не вывести, — стандартный с теми же документами', () => {
    const view = footerView(place('gone'))
    if (!view) throw new Error('нет подвала')
    const html = renderToStaticMarkup(
      <FooterSlot view={view} media={{}} definitions={definitions} />,
    )
    expect(html).toContain('data-site-footer=""')
    expect(html).not.toContain('data-custom-block')
    expect(html).toContain('href="/privacy"')
  })
})
