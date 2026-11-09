import {
  CustomBlockKey,
  defaultTheme,
  Header,
  PageContent,
  Theme,
  video as videoBlock,
} from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { compileCustomCss } from '../custom/css'
import { SiteHeader } from '../header/SiteHeader'
import { siteHeaderView } from '../header/view'
import { Page } from '../Page'
import { themeBackgroundCss } from '../ui/theme-background'
import { compileWindowCss, windowCssForPage } from './css'
import { windowsAndBehaviors } from './needed'
import { SiteWindows } from './SiteWindows'
import { siteWindowView } from './view'

// Окна сайта: какие окна кладёт сборка, разметка окна, ссылки в окно у встроенных кнопок и шапки,
// CSS окон темы; поведения встроенных блоков и фон-картинка темы

const form = {
  id: 'form',
  type: 'form',
  props: {
    title: 'Запись',
    fields: [{ name: 'name', type: 'name', label: 'Имя', required: true }],
    policyUrl: '/privacy',
  },
}

const page = (slug: string, content: unknown, title = slug) => ({
  slug,
  title,
  content: PageContent.parse(content),
})

const hero = (href: string, window?: boolean) => ({
  id: 'hero',
  type: 'hero',
  props: { title: 'Привет', button: { label: 'Записаться', href, ...(window && { window }) } },
})

const zapis = page('zapis', { blocks: [form], window: { title: 'Запись на урок' } }, 'Запись')
const ceny = page('ceny', { blocks: [form], window: {} }, 'Цены')

const needed = (
  content: unknown,
  options: Partial<Parameters<typeof windowsAndBehaviors>[0]> = {},
) =>
  windowsAndBehaviors({
    page: { slug: 'index', content: PageContent.parse(content) },
    pages: [zapis, ceny, page('index', { blocks: [] })],
    chromeLinks: [],
    customBlocks: {},
    ownKeys: [],
    ...options,
  })

describe('какие окна нужны странице', () => {
  it('кнопка с «Открывать в окне» на страницу-окно — это окно и скрипт поведений', () => {
    const result = needed({ blocks: [hero('/zapis', true)] })
    expect(result.windows.map((window) => window.slug)).toEqual(['zapis'])
    expect(result.behaviors).toBe(true)
  })

  it('без флажка, на обычную страницу или на саму себя — окна и скрипта нет', () => {
    for (const content of [
      { blocks: [hero('/zapis/')] },
      { blocks: [hero('/o-nas/', true)] },
      { blocks: [hero('https://t.me/x', true)] },
    ]) {
      const result = needed(content)
      expect(result.windows).toEqual([])
      expect(result.behaviors).toBe(false)
    }
    const self = windowsAndBehaviors({
      page: { slug: 'zapis', content: zapis.content },
      pages: [zapis],
      chromeLinks: [{ href: '/zapis/', window: true }],
      customBlocks: {},
      ownKeys: [],
    })
    expect(self.windows).toEqual([])
  })

  it('ссылки шапки и подвала с window — тоже окна', () => {
    const result = needed({ blocks: [] }, { chromeLinks: [{ href: '/ceny/', window: true }] })
    expect(result.windows.map((window) => window.slug)).toEqual(['ceny'])
  })

  it('свой шаблон с data-av-window — все окна сайта; с data-av-reveal — только скрипт', () => {
    const custom = (template: string) => ({
      promo: { key: 'promo', title: 'П', fields: [], template, css: '' },
    })
    const all = needed(
      { blocks: [] },
      { customBlocks: custom('<a href="/zapis/" data-av-window>З</a>'), ownKeys: ['promo'] },
    )
    expect(all.windows.map((window) => window.slug).sort()).toEqual(['ceny', 'zapis'])
    const reveal = needed(
      { blocks: [] },
      { customBlocks: custom('<p data-av-reveal>т</p>'), ownKeys: ['promo'] },
    )
    expect(reveal.windows).toEqual([])
    expect(reveal.behaviors).toBe(true)
  })

  it('своя шапка: окна — по готовому HTML; заготовка без флажка не тянет окна и скрипт', () => {
    // Шаблон заготовки содержит data-av-window всегда, а HTML — только у пункта с флажком
    const none = needed({ blocks: [] }, { placeHtml: ['<header><a href="/zapis/">З</a></header>'] })
    expect(none.windows).toEqual([])
    expect(none.behaviors).toBe(false)
    const flagged = needed(
      { blocks: [] },
      { placeHtml: ['<header><a href="/zapis/" data-av-window>З</a></header>'] },
    )
    expect(flagged.windows.map((window) => window.slug).sort()).toEqual(['ceny', 'zapis'])
    expect(needed({ blocks: [] }, { placeHtml: ['<p data-av-reveal>т</p>'] }).behaviors).toBe(true)
  })

  it('главная окном не бывает, даже если в данных у неё window', () => {
    const result = windowsAndBehaviors({
      page: { slug: 'o-nas', content: PageContent.parse({ blocks: [hero('/', true)] }) },
      pages: [page('index', { blocks: [form], window: {} })],
      chromeLinks: [{ href: '/', window: true }],
      customBlocks: {},
      ownKeys: [],
    })
    expect(result.windows).toEqual([])
  })

  it('блок «Видео» в окне — странице нужен скрипт плеера; без видео — нет', () => {
    const video = { id: 'clip', type: 'video', props: videoBlock.example }
    const result = windowsAndBehaviors({
      page: { slug: 'index', content: PageContent.parse({ blocks: [hero('/zapis/', true)] }) },
      pages: [page('zapis', { blocks: [video], window: {} })],
      chromeLinks: [],
      customBlocks: {},
      ownKeys: [],
    })
    expect(result.video).toBe(true)
    expect(needed({ blocks: [hero('/zapis/', true)] }).video).toBe(false)
    expect(needed({ blocks: [video] }).video).toBe(true)
  })

  it('окно из окна: ссылка внутри окна добавляет второе окно', () => {
    const withLink = page('zapis', {
      blocks: [form, { ...hero('/ceny/', true), id: 'more' }],
      window: {},
    })
    const result = windowsAndBehaviors({
      page: { slug: 'index', content: PageContent.parse({ blocks: [hero('/zapis/', true)] }) },
      pages: [withLink, ceny],
      chromeLinks: [],
      customBlocks: {},
      ownKeys: [],
    })
    expect(result.windows.map((window) => window.slug)).toEqual(['zapis', 'ceny'])
  })

  it('«Появление при прокрутке» и плавный FAQ встроенных блоков — скрипт без окон', () => {
    const features = {
      id: 'f',
      type: 'features',
      props: { items: [{ title: 'А' }], reveal: 'up' },
    }
    expect(needed({ blocks: [features] }).behaviors).toBe(true)
    expect(
      needed({ blocks: [{ ...features, props: { items: [{ title: 'А' }], reveal: 'none' } }] })
        .behaviors,
    ).toBe(false)
    const faq = {
      id: 'q',
      type: 'faq',
      props: { items: [{ question: 'В?', answer: 'О' }], smooth: true },
    }
    expect(needed({ blocks: [faq] }).behaviors).toBe(true)
  })
})

describe('разметка окна', () => {
  const view = siteWindowView(zapis, (slug) => (id) => `/api/forms/s/${slug}/${id}`)
  if (!view) throw new Error('нет окна')
  const html = renderToStaticMarkup(<SiteWindows windows={[view]} metrika="777" />)

  it('закрытый <dialog> с адресом, заголовком, «Закрыть» и формой с адресом приёма страницы-окна', () => {
    expect(html).toMatch(/<dialog[^>]+data-site-window="zapis"/)
    expect(html).not.toMatch(/<dialog[^>]+\bopen\b/)
    expect(html).toContain('aria-labelledby="w-zapis~title"')
    expect(html).toContain('<h2 id="w-zapis~title"')
    expect(html).toContain('aria-label="Закрыть окно"')
    expect(html).toContain('data-site-window-backdrop=""')
    expect(html).toContain('data-site-window-metrika="777"')
    // id блока с префиксом окна, адрес приёма — исходный id
    expect(html).toContain('id="w-zapis-form"')
    expect(html).toContain('action="/api/forms/s/zapis/form"')
    // В окне нет main и h1: они у страницы под окном
    expect(html).not.toContain('<main')
    expect(html).not.toContain('<h1')
  })

  it('без заголовка окна — имя окна по названию страницы', () => {
    const plain = siteWindowView(ceny)
    if (!plain) throw new Error('нет окна')
    const markup = renderToStaticMarkup(<SiteWindows windows={[plain]} />)
    expect(markup).toContain('aria-label="Цены"')
    expect(markup).not.toContain('data-site-window-metrika')
  })

  it('страница без настройки «Окно» — не окно', () => {
    expect(siteWindowView(page('o-nas', { blocks: [] }))).toBeNull()
  })
})

describe('ссылки в окно', () => {
  it('кнопка блока с window — data-av-window, без него — нет', () => {
    const html = (window?: boolean) =>
      renderToStaticMarkup(
        <Page content={PageContent.parse({ blocks: [hero('/zapis/', window)] })} />,
      )
    expect(html(true)).toMatch(/<a[^>]+href="\/zapis\/"[^>]+data-av-window=""/)
    expect(html()).not.toContain('data-av-window')
  })

  it('пункт меню и кнопка шапки с window — data-av-window', () => {
    const view = siteHeaderView({
      header: Header.parse({
        menu: [{ label: 'Запись', page: 'zapis', window: true }],
        button: { label: 'Записаться', page: 'zapis', window: true },
      }),
      siteName: 'Сайт',
      page: { slug: 'index', content: { blocks: [] } },
      pages: [
        { slug: 'index', blockIds: [] },
        { slug: 'zapis', blockIds: [] },
      ],
      contacts: { phone: '', address: '' },
    })
    if (!view) throw new Error('нет шапки')
    expect(view.menu[0]?.window).toBe(true)
    expect(view.button?.window).toBe(true)
    const html = renderToStaticMarkup(<SiteHeader view={view} media={{}} />)
    expect(html.match(/data-av-window=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('внешней ссылке шапки окно не поставить', () => {
    const result = Header.safeParse({
      menu: [{ label: 'TG', url: 'https://t.me/x', window: true }],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['menu', 0, 'window'])
  })

  it('появление при прокрутке у карточек и плавный FAQ — атрибутами поведений', () => {
    const html = renderToStaticMarkup(
      <Page
        content={PageContent.parse({
          blocks: [
            {
              id: 'f',
              type: 'features',
              props: { items: [{ title: 'А' }, { title: 'Б' }], reveal: 'up' },
            },
            {
              id: 'q',
              type: 'faq',
              props: { items: [{ question: 'В?', answer: 'О' }], smooth: true },
            },
          ],
        })}
      />,
    )
    expect(html.match(/data-av-reveal="up"/g)).toHaveLength(2)
    expect(html).toContain('--av-reveal-order:1')
    expect(html).toMatch(/<details[^>]+data-av-details=""/)
  })
})

describe('CSS окон и фон темы', () => {
  it('CSS окон — внутри окна, :scope — само окно, «> section» — блоки окна', () => {
    const { css, problems } = compileWindowCss(
      ':scope { border-radius: 2rem } .title { color: var(--color-accent) } > section h2 { margin: 0 } :scope > section, :scope:focus-visible { padding: 0 }',
    )
    expect(problems).toEqual([])
    // Специфичность 0,2,1 — выше вида окна по умолчанию (.window[data-surface] — 0,2,0)
    expect(css).toContain('dialog[data-site-window][data-site-window] {')
    expect(css).toContain('dialog[data-site-window][data-site-window] .title')
    expect(css).toContain(
      'dialog[data-site-window][data-site-window] [data-site-window-content] > section h2',
    )
    expect(css).toContain(
      'dialog[data-site-window][data-site-window] [data-site-window-content] > section, dialog[data-site-window][data-site-window]:focus-visible',
    )
  })

  it('блоки окна — прямые дети содержимого окна: «> section» их находит', () => {
    const view = siteWindowView(zapis)
    if (!view) throw new Error('нет окна')
    const html = renderToStaticMarkup(<SiteWindows windows={[view]} />)
    expect(html).toMatch(/data-site-window-content=""><section/)
    expect(html).toMatch(/<h2 id="w-zapis~title"[^>]*tabindex="-1"[^>]*data-site-window-title=""/)
  })

  it('CSS окон: @keyframes не совпадут со своим блоком «window», тексты ошибок — про окно', () => {
    const { css } = compileWindowCss(
      '@keyframes pop { to { opacity: 1 } } :scope { animation: pop 1s }',
    )
    expect(css).toContain('@keyframes site_window--pop')
    expect(css).toContain('animation: site_window--pop 1s')
    const own = compileCustomCss('@keyframes pop { to { opacity: 1 } }', 'window').css
    expect(own).not.toContain('site_window--pop')
    expect(CustomBlockKey.safeParse('site_window').success).toBe(false)

    const messages = compileWindowCss(
      'body { color: var(--color-text) }\n.a { position: fixed; z-index: 50 }',
    ).problems.map((problem) => problem.message)
    expect(messages).toContain('body — это вся страница: в окне берите :scope')
    expect(messages.some((message) => message.includes('внутри окна берите relative'))).toBe(true)
    expect(messages.join(' ')).not.toMatch(/блок/)
  })

  it('ошибка CSS окон — со строкой, и на страницу такой CSS не попадает', () => {
    const bad = '.a { color: red }\nbody { position: fixed }'
    expect(compileWindowCss(bad).problems.some((problem) => problem.level === 'error')).toBe(true)
    expect(windowCssForPage(bad, {})).toBe('')
    expect(windowCssForPage('.a { color: var(--color-text) }', {})).toContain('[data-site-window]')
  })

  it('фон-картинка темы — правило body по варианту из справочника; нет картинки — пусто', () => {
    const mediaId = '7b0c2a54-0d7b-4b1e-9a6f-3f1f4e2a9c11'
    const theme = Theme.parse({ ...defaultTheme, background: { mediaId, size: 'tile' } })
    const media = {
      [mediaId]: {
        alt: '',
        width: 200,
        height: 200,
        variants: [{ url: '/media/x/a.png', width: 200, height: 200, format: 'png' as const }],
      },
    }
    expect(themeBackgroundCss(theme, media as never)).toBe(
      'body{background-image:url("/media/x/a.png");background-repeat:repeat}',
    )
    expect(
      themeBackgroundCss({ background: { mediaId, size: 'cover' } }, media as never),
    ).toContain('background-size:cover')
    // iOS не умеет fixed у фона: там картинка — на закреплённом body::before
    const cover = themeBackgroundCss({ background: { mediaId, size: 'cover' } }, media as never)
    expect(cover).toContain('@supports (-webkit-touch-callout:none)')
    expect(cover).toContain(
      'body::before{content:"";position:fixed;top:0;right:0;bottom:0;left:0;z-index:-1',
    )
    // Узор повторяется и на iOS без обходов
    expect(themeBackgroundCss(theme, media as never)).not.toContain('@supports')
    expect(themeBackgroundCss(theme, {})).toBe('')
    expect(themeBackgroundCss(defaultTheme, media as never)).toBe('')
  })

  it('фон-картинка: кавычка и \\ в адресе экранированы, «</style» не закрывает <style>', () => {
    const mediaId = '7b0c2a54-0d7b-4b1e-9a6f-3f1f4e2a9c11'
    const theme = Theme.parse({ ...defaultTheme, background: { mediaId, size: 'tile' } })
    const url = '/media/x/a"b\\c</style><script>.png'
    const media = {
      [mediaId]: {
        alt: '',
        width: 200,
        height: 200,
        variants: [{ url, width: 200, height: 200, format: 'png' as const }],
      },
    }
    const css = themeBackgroundCss(theme, media as never)
    expect(css).toContain('url("/media/x/a\\"b\\\\c')
    expect(css).not.toMatch(/<\/style/i)
    expect(css).toContain('\\3c /style')
  })
})
