// @vitest-environment happy-dom
import { defaultTheme, demoPage, PageContent } from '@averra/schema'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SandboxPreview } from './SandboxPreview'

afterEach(cleanup)

const content = PageContent.parse(demoPage)
const script = { label: 'x', file: 'x.js' }

function frameDoc(ui: React.ReactElement) {
  const view = render(ui)
  return { view, srcdoc: () => view.container.querySelector('iframe')?.getAttribute('srcdoc') }
}

describe('SandboxPreview', () => {
  it('перерисовка с теми же данными (новые объекты) не меняет документ рамки', () => {
    const props = () => ({
      content,
      theme: defaultTheme,
      media: {},
      device: 'desktop' as const,
      scripts: [{ ...script }],
      before: <header>шапка</header>,
    })
    const { view, srcdoc } = frameDoc(<SandboxPreview {...props()} />)
    const first = srcdoc()
    expect(first).toContain('шапка')
    view.rerender(<SandboxPreview {...props()} />)
    expect(srcdoc()).toBe(first)
  })

  it('правка содержимого — другой документ', () => {
    const base = {
      content,
      theme: defaultTheme,
      media: {},
      device: 'desktop' as const,
      scripts: [],
    }
    const { view, srcdoc } = frameDoc(<SandboxPreview {...base} before={<i>раз</i>} />)
    const first = srcdoc()
    view.rerender(<SandboxPreview {...base} before={<i>два</i>} />)
    expect(srcdoc()).not.toBe(first)
  })
})
