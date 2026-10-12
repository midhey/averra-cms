import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { hero } from './blocks'
import {
  collectMediaRefs,
  fileSizeLimitHint,
  fileTooLargeMessage,
  formatBytes,
  Image,
} from './media'
import { PageContent } from './page'

const mediaId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const otherId = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'

describe('Image', () => {
  it('принимает картинку с описанием и обрезает пробелы в alt', () => {
    expect(Image.parse({ mediaId, alt: '  Бригада на объекте ' })).toEqual({
      mediaId,
      alt: 'Бригада на объекте',
    })
  })

  it.each([
    ['пустой alt', { mediaId, alt: '' }],
    ['alt из пробелов', { mediaId, alt: '   ' }],
    ['alt длиннее 200', { mediaId, alt: 'я'.repeat(201) }],
    ['без alt', { mediaId }],
    ['кривой id', { mediaId: '../../etc/passwd', alt: 'Файл' }],
    ['лишнее поле', { mediaId, alt: 'Фото', src: 'https://example.com/a.jpg' }],
  ])('не принимает: %s', (_, value) => {
    expect(Image.safeParse(value).success).toBe(false)
  })

  it('id в заглавных буквах приводится к строчным: в базе и ссылках одно написание', () => {
    expect(Image.parse({ mediaId: mediaId.toUpperCase(), alt: 'Фото' }).mediaId).toBe(mediaId)
  })

  it('объясняет, зачем нужен alt', () => {
    expect(Image.safeParse({ mediaId, alt: '' }).error?.issues[0]?.message).toMatch(/диктор/)
  })

  it('несёт пометку для конструктора форм и в обязательном, и в необязательном поле', () => {
    expect(z.toJSONSchema(Image)).toMatchObject({ 'x-widget': 'image' })
    expect(z.toJSONSchema(hero.props, { io: 'input' })).toMatchObject({
      properties: { image: { 'x-widget': 'image', title: 'Картинка' } },
    })
  })
})

describe('hero с картинкой', () => {
  const props = (extra: object) => ({ title: 'Ремонт', ...extra })

  it('в варианте split без картинки — ошибка у поля image', () => {
    const result = hero.props.safeParse(props({ variant: 'split' }))
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['image'], message: expect.stringMatching(/split/) }),
    ])
  })

  it('в варианте split с картинкой проходит', () => {
    const image = { mediaId, alt: 'Фото' }
    expect(hero.props.safeParse(props({ variant: 'split', image })).success).toBe(true)
  })

  it('в остальных вариантах картинка не нужна', () => {
    expect(hero.props.safeParse(props({ variant: 'centered' })).success).toBe(true)
    expect(hero.props.safeParse(props({ variant: 'left' })).success).toBe(true)
  })

  it.each(['centered', 'left'])(
    'в варианте %s картинки быть не должно: её не видно, а удалить её из медиатеки не дали бы',
    (variant) => {
      const image = { mediaId, alt: 'Фото' }
      expect(hero.props.safeParse(props({ variant, image })).error?.issues).toEqual([
        expect.objectContaining({
          path: ['image'],
          message: expect.stringMatching(/только в варианте split/),
        }),
      ])
    },
  )

  it('ошибку split видно и при проверке всей страницы — с путём до поля блока', () => {
    const page = { blocks: [{ id: 'hero', type: 'hero', props: props({ variant: 'split' }) }] }
    expect(PageContent.safeParse(page).error?.issues[0]?.path).toEqual([
      'blocks',
      0,
      'props',
      'image',
    ])
  })
})

describe('collectMediaRefs', () => {
  it('находит каждую ссылку на картинку с путём до неё, повторы тоже', () => {
    const content = {
      blocks: [
        { id: 'a', type: 'hero', props: { title: 'А', image: { mediaId, alt: 'Фото' } } },
        { id: 'b', type: 'cta', props: { title: 'Б' } },
        { id: 'c', type: 'hero', props: { title: 'В', image: { mediaId: otherId, alt: 'x' } } },
        { id: 'd', type: 'hero', props: { title: 'Г', image: { mediaId, alt: 'Снова' } } },
      ],
    }
    expect(collectMediaRefs(content)).toEqual([
      { mediaId, path: ['blocks', 0, 'props', 'image', 'mediaId'] },
      { mediaId: otherId, path: ['blocks', 2, 'props', 'image', 'mediaId'] },
      { mediaId, path: ['blocks', 3, 'props', 'image', 'mediaId'] },
    ])
  })

  it('страница без картинок — пустой список', () => {
    expect(
      collectMediaRefs({ blocks: [{ id: 'a', type: 'hero', props: { title: 'А' } }] }),
    ).toEqual([])
  })
})

describe('сообщения о размере файла', () => {
  it('единица — по величине: маленький лимит не становится «0 МБ»', () => {
    expect(fileTooLargeMessage(2048)).toBe('Файл больше 2 КБ. Уменьшите картинку и загрузите снова')
    expect(fileSizeLimitHint(10 * 1024 * 1024)).toBe('Не больше 10 МБ')
    expect(fileSizeLimitHint(500)).toBe('Не больше 500 Б')
  })

  it('formatBytes: байты, килобайты и мегабайты с одной цифрой после запятой', () => {
    expect(formatBytes(820)).toBe('820 Б')
    expect(formatBytes(14 * 1024)).toBe('14 КБ')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2,5 МБ')
  })
})
