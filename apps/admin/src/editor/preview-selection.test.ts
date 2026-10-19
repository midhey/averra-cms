// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { blockIdAt, previewSelectionCss } from './preview-selection'

const colors = { selection: '#2b44c7', hover: 'rgb(140, 138, 131)' }

describe('previewSelectionCss', () => {
  it('рамка у выбранного блока по его id и пунктир при наведении у остальных', () => {
    const css = previewSelectionCss({ selectedId: 'hero-1', scale: 1, colors, interactive: true })
    expect(css).toContain('main > section[id="hero-1"], main > section[id="hero-1"]:hover')
    expect(css).toContain('main > section[id]:hover')
    expect(css).toContain('--averra-selection: #2b44c7')
    expect(css).toContain('--averra-outline: 2px')
  })

  it('ужатый предпросмотр получает рамку толще: после масштаба она снова около 2 px', () => {
    const css = previewSelectionCss({ selectedId: 'hero-1', scale: 0.5, colors, interactive: true })
    expect(css).toContain('--averra-outline: 4px')
  })

  it('без выбранного блока — только наведение', () => {
    const css = previewSelectionCss({ selectedId: null, scale: 1, colors, interactive: true })
    expect(css).not.toContain('solid')
    expect(css).toContain(':hover')
  })

  it('id, который не проходит схему блока, в CSS не попадает', () => {
    const css = previewSelectionCss({
      selectedId: 'x"] { color: red } [id="',
      scale: 1,
      colors,
      interactive: true,
    })
    expect(css).not.toContain('color: red')
    expect(css).not.toContain('solid')
  })

  it('цвет, который закрыл бы правило, заменяется безопасным', () => {
    const css = previewSelectionCss({
      selectedId: null,
      scale: 1,
      colors: { selection: 'red; } body { display: none', hover: '' },
      interactive: true,
    })
    expect(css).not.toContain('display: none')
    expect(css).toContain('--averra-selection: currentcolor')
  })

  it('в версии из истории подсветки и выбора нет', () => {
    expect(
      previewSelectionCss({ selectedId: 'hero-1', scale: 1, colors, interactive: false }),
    ).toBe('')
  })
})

describe('blockIdAt', () => {
  it('находит блок, внутри которого щёлкнули, если он есть в черновике', () => {
    document.body.innerHTML =
      '<main><section id="hero-1"><h1><span id="inner">Текст</span></h1></section><section id="old"></section></main>'
    const ids = new Set(['hero-1'])
    expect(blockIdAt(document.getElementById('inner'), ids)).toBe('hero-1')
    expect(blockIdAt(document.getElementById('old'), ids)).toBeNull()
    expect(blockIdAt(document.querySelector('main'), ids)).toBeNull()
    expect(blockIdAt(null, ids)).toBeNull()
  })
})
