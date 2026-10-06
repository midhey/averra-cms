import { demoPage, PageContent } from '@cms/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Page } from './Page'

const render = (input: unknown) => renderToStaticMarkup(<Page content={PageContent.parse(input)} />)
const countH1 = (html: string) => html.match(/<h1[\s>]/g)?.length ?? 0

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
})
