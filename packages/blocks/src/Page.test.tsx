import { demoPage, type MediaMap, PageContent } from '@cms/schema'
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
