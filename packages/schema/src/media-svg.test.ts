import { describe, expect, it } from 'vitest'
import { svgAllowedAt } from './media-svg'

// Где в странице можно SVG — по пометке x-allow-svg в схеме поля (Logo)

const content = { blocks: [{ type: 'clients' }, { type: 'hero' }, { type: 'gallery' }] }

describe('svgAllowedAt', () => {
  it('логотип клиента — да', () => {
    expect(svgAllowedAt(content, ['blocks', 0, 'props', 'items', 3, 'logo', 'mediaId'])).toBe(true)
  })

  it('фото блоков, SEO-картинка и пути мимо схемы — нет', () => {
    expect(svgAllowedAt(content, ['blocks', 1, 'props', 'image', 'mediaId'])).toBe(false)
    expect(svgAllowedAt(content, ['blocks', 2, 'props', 'items', 0, 'image', 'mediaId'])).toBe(
      false,
    )
    expect(svgAllowedAt(content, ['seo', 'image', 'mediaId'])).toBe(false)
    expect(svgAllowedAt(content, ['blocks', 9, 'props', 'items', 0, 'logo', 'mediaId'])).toBe(false)
    expect(svgAllowedAt(content, ['blocks', 0, 'props', 'nope', 'mediaId'])).toBe(false)
  })
})
