// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { GLOBAL_STYLE_ATTRIBUTE, installGlobalStyle, previewStyleNodes } from './global-style'

describe('глобальный стиль админки', () => {
  it('ставится первым в <head> и при повторе не дублируется', () => {
    document.head.innerHTML = '<style id="module">.a{}</style>'
    installGlobalStyle(document, 'body{}')
    installGlobalStyle(document, 'body{color:red}')
    const styles = document.head.querySelectorAll('style')
    expect(styles).toHaveLength(2)
    expect(styles[0]?.hasAttribute(GLOBAL_STYLE_ATTRIBUTE)).toBe(true)
    expect(styles[0]?.textContent).toBe('body{color:red}')
  })

  it('предпросмотр берёт стили модулей и ссылки, но не глобальный слой', () => {
    document.head.innerHTML =
      '<style id="module">.a{}</style><link rel="stylesheet" id="link"><link rel="icon" id="icon">'
    installGlobalStyle(document, ':root{--color-text:red}')
    const ids = previewStyleNodes(document).map((node) => node.id)
    expect(ids).toEqual(['module', 'link'])
  })
})
