// @vitest-environment happy-dom
import { defaultFooter, Header, PageContent } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { type ChromeInput, siteChrome } from './site-chrome'

it('предпросмотр шапки и подвала исключает ссылки на скрытые якоря и возвращает их при показе', () => {
  const content = PageContent.parse({
    blocks: [{ id: 'offer', type: 'hero', hidden: true, props: { title: 'Акция' } }],
  })
  const input: ChromeInput = {
    header: Header.parse({ menu: [{ label: 'Сезонная акция', page: 'index', block: 'offer' }] }),
    footer: { ...defaultFooter, layout: 'columns', sections: true },
    siteName: 'Пример',
    page: { slug: 'index', content },
    pages: [{ slug: 'index', blocks: content.blocks }],
    contacts: { phone: '', address: '' },
    organization: { name: '', phone: '', email: '', address: '', inn: '', ogrn: '', socials: [] },
    legal: { policyHref: null, consentHref: null, cookieSettings: false },
    customBlocks: {},
    media: {},
  }
  const hidden = siteChrome(input)
  expect(
    renderToStaticMarkup(
      <>
        {hidden.before}
        {hidden.extra}
      </>,
    ),
  ).not.toContain('Сезонная акция')
  const visible = {
    ...content,
    blocks: content.blocks.map((block) => ({ ...block, hidden: false })),
  }
  const shown = siteChrome({
    ...input,
    page: { slug: 'index', content: visible },
    pages: [{ slug: 'index', blocks: visible.blocks }],
  })
  expect(renderToStaticMarkup(shown.before)).toContain('Сезонная акция')
  expect(renderToStaticMarkup(shown.extra)).toContain('Сезонная акция')
})
