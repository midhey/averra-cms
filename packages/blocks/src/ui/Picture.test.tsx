import type { MediaFile, MediaMap } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Picture } from './Picture'

const mediaId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'

const variants = (formats: MediaFile['variants'][number]['format'][], widths: number[]) =>
  formats.flatMap((format) =>
    widths.map((width) => ({
      format,
      width,
      height: width / 2,
      url: `/api/media/${mediaId}/${width}.${format}`,
    })),
  )

const jpegFile: MediaFile = {
  width: 1200,
  height: 600,
  variants: variants(['avif', 'webp', 'jpeg'], [960, 480, 1200]),
}

const lowerAttributes = (html: string) =>
  html.replace(/ ([a-zA-Z]+)=/g, (_, name: string) => ` ${name.toLowerCase()}=`)

// Имена атрибутов HTML не зависят от регистра, а React пишет их как в JSX (srcSet): сравниваем
// их в нижнем регистре
const render = (media: MediaMap, priority = false) =>
  lowerAttributes(
    renderToStaticMarkup(
      <Picture
        image={{ mediaId, alt: 'Бригада на объекте' }}
        media={media}
        sizes="100vw"
        priority={priority}
      />,
    ),
  )

describe('Picture', () => {
  it('отдаёт AVIF и WebP источниками, а исходный формат — картинкой, у всех ширины по возрастанию', () => {
    const html = render({ [mediaId]: jpegFile })
    const srcset = (format: string) =>
      [480, 960, 1200].map((w) => `/api/media/${mediaId}/${w}.${format} ${w}w`).join(', ')
    expect(html).toContain(`<source type="image/avif" srcset="${srcset('avif')}" sizes="100vw"/>`)
    expect(html).toContain(`<source type="image/webp" srcset="${srcset('webp')}" sizes="100vw"/>`)
    expect(html).toMatch(new RegExp(`<img[^>]* srcset="${srcset('jpeg')}"`))
    // AVIF идёт первым: браузер берёт первый источник, который понимает
    expect(html.indexOf('image/avif')).toBeLessThan(html.indexOf('image/webp'))
  })

  it('у картинки размеры исходника, alt, sizes и самый большой запасной вариант в src', () => {
    const html = render({ [mediaId]: jpegFile })
    expect(html).toMatch(/<img[^>]* width="1200" height="600"/)
    expect(html).toContain('alt="Бригада на объекте"')
    expect(html).toContain(`src="/api/media/${mediaId}/1200.jpeg"`)
    expect(html).toMatch(/<img[^>]* sizes="100vw"/)
  })

  it('по умолчанию грузится лениво, картинка первого экрана — сразу и в первую очередь', () => {
    const lazy = render({ [mediaId]: jpegFile })
    expect(lazy).toContain('loading="lazy"')
    expect(lazy).not.toContain('fetchpriority')

    const eager = render({ [mediaId]: jpegFile }, true)
    expect(eager).toContain('loading="eager"')
    expect(eager).toContain('fetchpriority="high"')
  })

  it('исходник WebP: запасной формат — WebP, отдельного источника WebP нет', () => {
    const html = render({ [mediaId]: { ...jpegFile, variants: variants(['avif', 'webp'], [480]) } })
    expect(html).toContain('type="image/avif"')
    expect(html).not.toContain('type="image/webp"')
    expect(html).toContain(`src="/api/media/${mediaId}/480.webp"`)
  })

  it('картинки нет в справочнике — ничего не выводит', () => {
    expect(render({})).toBe('')
  })

  it('SVG — одним файлом без источников и srcset, с размерами и alt', () => {
    const url = `/api/media/${mediaId}/image.svg`
    const html = render({
      [mediaId]: {
        width: 120,
        height: 40,
        variants: [{ format: 'svg', width: 120, height: 40, url }],
      },
    })
    expect(html).not.toContain('<source')
    expect(html).not.toContain('srcset')
    expect(html).toMatch(
      /<img[^>]* src="[^"]+image.svg" width="120" height="40" alt="Бригада на объекте"/,
    )
  })
})
