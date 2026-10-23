import { type MediaMap, PageContent } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Page } from './Page'

// Блоки лендинга второго шага: работы, отзывы, клиенты, команда, контакты. Ключевая разметка,
// без скриптов (работают без JS), заголовки по порядку

const render = (blocksInput: unknown[], media?: MediaMap) =>
  renderToStaticMarkup(<Page content={PageContent.parse({ blocks: blocksInput })} media={media} />)
const block = (type: string, props: unknown, id = type) => ({ id, type, props })

const photoId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const svgId = '4a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const media: MediaMap = {
  [photoId]: {
    width: 1600,
    height: 1200,
    variants: [
      { format: 'jpeg', width: 800, height: 600, url: `/api/media/${photoId}/800.jpeg` },
      { format: 'jpeg', width: 1600, height: 1200, url: `/api/media/${photoId}/1600.jpeg` },
      { format: 'webp', width: 1600, height: 1200, url: `/api/media/${photoId}/1600.webp` },
    ],
  },
  [svgId]: {
    width: 120,
    height: 40,
    variants: [{ format: 'svg', width: 120, height: 40, url: `/api/media/${svgId}/image.svg` }],
  },
}
const image = { mediaId: photoId, alt: 'Кухня после ремонта' }

describe('«Наши работы»', () => {
  it('фото в figure с подписью, ссылка на самый большой JPEG', () => {
    const html = render(
      [block('gallery', { title: 'Работы', items: [{ image, caption: 'Кухня, 12 м²' }] })],
      media,
    )
    expect(html).toContain(`href="/api/media/${photoId}/1600.jpeg"><picture`)
    expect(html).toMatch(
      /<figure[^>]*>.*alt="Кухня после ремонта".*<\/a><figcaption[^>]*>Кухня, 12 м²<\/figcaption><\/figure>/s,
    )
    expect(html).toContain('data-aspect="landscape"')
    expect(html).not.toContain('<script')
  })

  it('без ссылки по флажку; фото нет — плашка, скрытая от диктора', () => {
    const html = render(
      [block('gallery', { linkToFull: false, items: [{ image }, { caption: 'Скоро' }] })],
      media,
    )
    expect(html).not.toContain('<a ')
    expect(html).toMatch(/<span [^>]*aria-hidden="true"><\/span><figcaption/)
  })

  it('sizes по колонкам: с 64rem — треть или четверть экрана, а не половина', () => {
    const sizesOf = (columns: number) =>
      /<img[^>]* sizes="([^"]+)"/.exec(
        render([block('gallery', { columns, items: [{ image }] })], media),
      )?.[1]
    expect(sizesOf(3)).toBe(
      '(min-width: 72rem) 24rem, (min-width: 64rem) 33.3vw, (min-width: 40rem) 50vw, 100vw',
    )
    expect(sizesOf(2)).toBe('(min-width: 72rem) 36rem, (min-width: 40rem) 50vw, 100vw')
  })
})

describe('«Отзывы»', () => {
  it('цитата в blockquote, автор — в figcaption вне цитаты, абзацы по пустой строке', () => {
    const html = render(
      [
        block('reviews', {
          items: [
            {
              quote: 'Сделали за месяц.\n\nРекомендую.',
              name: 'Анна',
              caption: 'Ремонт ванной',
              photo: { mediaId: photoId, alt: 'Анна' },
            },
          ],
        }),
      ],
      media,
    )
    expect(html).toMatch(
      /<blockquote[^>]*><p>Сделали за месяц.<\/p><p>Рекомендую.<\/p><\/blockquote><figcaption/,
    )
    expect(html).toContain('>Анна</span>')
    expect(html).toContain('>Ремонт ванной</span>')
    expect(html).toContain('alt="Анна"')
    expect(html).not.toContain('<h')
  })
})

describe('«Клиенты»', () => {
  it('SVG-логотип с alt-названием; без логотипа — название текстом', () => {
    const html = render(
      [
        block('clients', {
          title: 'Нам доверяют',
          tone: 'mono',
          items: [{ name: 'ООО «Стройка»', logo: { mediaId: svgId } }, { name: 'Бюро «Дом»' }],
        }),
      ],
      media,
    )
    expect(html).toContain(`src="/api/media/${svgId}/image.svg"`)
    expect(html).toContain('alt="ООО «Стройка»"')
    expect(html).toMatch(/<li[^>]*><span[^>]*>Бюро «Дом»<\/span><\/li>/)
    expect(html).toContain('data-tone="mono"')
  })
})

describe('«Команда»', () => {
  it('имя — заголовком пункта, должность под ним; без фото — плашка', () => {
    const html = render([
      block('team', {
        title: 'Команда',
        photoShape: 'round',
        members: [{ name: 'Иван Петров', role: 'Прораб' }],
      }),
    ])
    expect(html).toContain('<ul role="list"')
    expect(html).toMatch(/<h2[^>]*>Команда<\/h2>/)
    expect(html).toMatch(/<h3[^>]*>Иван Петров<\/h3><p[^>]*>Прораб<\/p>/)
    expect(html).toContain('data-shape="round"')
    expect(html).toContain('aria-hidden="true"')
  })

  // sizes — как сетка в CSS: иначе браузер возьмёт вариант мельче колонки или крупнее нужного
  const sizesOf = (props: Record<string, unknown>) =>
    /<img[^>]* sizes="([^"]+)"/.exec(
      render([block('team', { ...props, members: [{ name: 'Иван', photo: image }] })], media),
    )?.[1]

  it('sizes фото по колонкам: две — половина экрана и на планшете; круглое — 10rem', () => {
    expect(sizesOf({ columns: 2 })).toBe('(min-width: 72rem) 36rem, 50vw')
    expect(sizesOf({ columns: 3 })).toBe(
      '(min-width: 72rem) 24rem, (min-width: 40rem) 33.3vw, 50vw',
    )
    expect(sizesOf({ columns: 4 })).toBe(
      '(min-width: 72rem) 18rem, (min-width: 64rem) 25vw, (min-width: 40rem) 33.3vw, 50vw',
    )
    expect(sizesOf({ columns: 4, photoShape: 'round' })).toBe('10rem')
  })
})

describe('«Контакты»', () => {
  it('address со списком: tel: из цифр, mailto:, адрес, часы, ссылка на Яндекс Карты', () => {
    const html = render([
      block('contacts', {
        title: 'Контакты',
        phone: '+7 (342) 000-00-00',
        email: 'info@example.ru',
        address: 'Пермь, Ленина, 50',
        hours: 'Пн–Сб, 9:00–19:00',
      }),
    ])
    expect(html).toMatch(/<address[^>]*><dl/)
    expect(html).toMatch(/<dt[^>]*>Телефон<\/dt>/)
    expect(html).toContain('href="tel:+73420000000"')
    expect(html).toContain('href="mailto:info@example.ru"')
    expect(html).toContain('>Пн–Сб, 9:00–19:00</dd>')
    expect(html).toContain(
      `href="https://yandex.ru/maps/?text=${encodeURIComponent('Пермь, Ленина, 50')}"`,
    )
    expect(html).toContain('>Открыть на карте</a>')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<script')
  })

  it('2ГИС по координатам и картинка карты; без адреса и координат — без ссылки', () => {
    const withMap = render(
      [
        block('contacts', {
          phone: '+7 900 123-45-67',
          mapService: '2gis',
          coordinates: '58.0105, 56.2502',
          mapImage: { mediaId: photoId, alt: 'Схема проезда' },
          tone: 'plain',
        }),
      ],
      media,
    )
    expect(withMap).toContain('href="https://2gis.ru/geo/56.2502,58.0105"')
    expect(withMap).toContain('data-map="image"')
    expect(withMap).toContain('alt="Схема проезда"')
    const noMap = render([block('contacts', { email: 'info@example.ru' })])
    expect(noMap).not.toContain('Открыть на карте')
    expect(noMap).not.toContain('Телефон')
  })

  it('адрес — заглушка из примера: адрес виден, а ссылки на поиск по «[Город…]» нет', () => {
    const html = render([block('contacts', { address: '[Город, улица, дом, офис]' })])
    expect(html).toContain('[Город, улица, дом, офис]')
    expect(html).not.toContain('Открыть на карте')
  })
})
