import {
  demoPage,
  legalPageContent,
  type MediaMap,
  mainHeadingBlock,
  Organization,
  PageContent,
  pageSeoChecks,
} from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Page } from './Page'

const render = (input: unknown, media?: MediaMap) =>
  renderToStaticMarkup(<Page content={PageContent.parse(input)} media={media} />)
const countH1 = (html: string) => html.match(/<h1[\s>]/g)?.length ?? 0

const mediaId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const media: MediaMap = {
  [mediaId]: {
    width: 960,
    height: 640,
    variants: (['avif', 'webp', 'jpeg'] as const).map((format) => ({
      format,
      width: 960,
      height: 640,
      url: `/api/media/${mediaId}/960.${format}`,
    })),
  },
}
const splitHero = (id: string, alt: string) => ({
  id,
  type: 'hero',
  props: { variant: 'split', title: `Блок ${id}`, image: { mediaId, alt } },
})

describe('Page', () => {
  it('рендерит демо-лендинг с одним h1', () => {
    expect(countH1(render(demoPage))).toBe(1)
  })

  it('ставит якоря по id блоков', () => {
    expect(render(demoPage)).toContain('id="contact"')
  })

  it('отдаёт h1 только первому блоку «Первый экран»', () => {
    const html = render({
      blocks: [
        { id: 'a', type: 'hero', props: { title: 'Главный' } },
        { id: 'b', type: 'hero', props: { title: 'Второй' } },
      ],
    })
    expect(countH1(html)).toBe(1)
    expect(html).toMatch(/<h2[^>]*>Второй<\/h2>/)
  })

  it.each([
    [
      'без «Первого экрана»',
      [{ id: 'c', type: 'cta', props: { title: 'Жми', button: { label: 'Да', href: '#c' } } }],
    ],
    [
      '«Первый экран» не первым',
      [
        { id: 'c', type: 'cta', props: { title: 'Жми', button: { label: 'Да', href: '#c' } } },
        { id: 'h', type: 'hero', props: { title: 'Главный' } },
        { id: 'h2', type: 'hero', props: { title: 'Ещё' } },
      ],
    ],
  ])('проверка h1 в редакторе говорит то же, что рисует страница: %s', (_, blocks) => {
    const content = PageContent.parse({ blocks })
    const html = render(content)
    const main = mainHeadingBlock(content.blocks)
    expect(countH1(html)).toBe(main ? 1 : 0)
    if (main?.type === 'hero') expect(html).toContain(`>${main.props.title}</h1>`)
    const site = {
      titleTemplate: '',
      description: '',
      ogImage: null,
      url: null,
      hideFromSearch: false,
    }
    const h1 = pageSeoChecks({ slug: 'a', title: 'А', blocks: content.blocks }, site).find(
      (check) => check.id === 'h1',
    )
    expect(h1?.level).toBe(main ? 'warning' : 'problem')
  })

  it('первый экран split выводит картинку рядом с текстом', () => {
    const html = render({ blocks: [splitHero('a', 'Мастер кладёт плитку')] }, media)
    expect(html).toMatch(/<picture[^>]*>.*<\/picture>/)
    expect(html).toContain('alt="Мастер кладёт плитку"')
  })

  it('картинку первого блока грузит сразу, картинки ниже — лениво', () => {
    const html = render({ blocks: [splitHero('a', 'Первая'), splitHero('b', 'Вторая')] }, media)
    const [first, second] = [...html.matchAll(/<img[^>]*>/g)].map(([tag]) => tag)
    expect(first).toMatch(/loading="eager"/)
    expect(first).toMatch(/fetchPriority="high"/i)
    expect(second).toMatch(/loading="lazy"/)
    expect(second).not.toMatch(/fetchPriority/i)
  })

  it('без справочника медиа страница всё равно рендерится, просто без картинок', () => {
    const html = render({ blocks: [splitHero('a', 'Фото')] })
    expect(html).toContain('Блок a')
    expect(html).not.toContain('<picture')
  })
})

describe('блок «Текст»', () => {
  const textPage = (body: string, title?: string) => ({
    blocks: [{ id: 'about', type: 'text', props: title ? { title, body } : { body } }],
  })

  it('абзацы, список и подзаголовок — своими тегами', () => {
    const html = render(textPage('Абзац\n\n## Подробнее\n- раз\n- два', 'О нас'))
    expect(html).toContain('<h2 class=')
    expect(html).toContain('>О нас</h2>')
    expect(html).toMatch(/<h3[^>]*>Подробнее<\/h3>/)
    expect(html).toContain('<li>раз</li><li>два</li>')
    expect(html).toMatch(/<p>Абзац<\/p>/)
  })

  it('HTML в тексте — текст, а не разметка', () => {
    const html = render(textPage('<img src=x onerror=alert(1)>'))
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('политика из шаблона: один h1 и реквизиты экранированы', () => {
    const content = legalPageContent('privacy', {
      siteName: 'Сайт',
      siteUrl: null,
      organization: Organization.parse({ name: 'ООО «<script>alert(1)</script>»' }),
      metrika: true,
      ga4: false,
      cookieMode: 'consent',
      forms: true,
      telegram: false,
      leadRetentionDays: 180,
      policyPage: '',
      date: '2026-10-22',
    })
    const html = render(content)
    expect(countH1(html)).toBe(1)
    expect(html).not.toContain('<script>')
    expect(html).toContain('ООО «&lt;script&gt;alert(1)&lt;/script&gt;»')
  })
})
