import { describe, expect, it } from 'vitest'
import { applyCustomBlocks, CustomBlockDraft, starterCustomBlock } from './custom-blocks'
import { customPlaceIssues, readCustomPlace } from './custom-place'
import { Footer, footerLookOf, footerMediaIds, readFooter } from './footer'
import { Header, headerLookOf, headerMediaIds, readHeader, sameHeaderLook } from './header'

// Свои шапка и подвал: место у определения, выбор вида в шапке и подвале (ключ — вид, поля —
// тексты), чтение из базы с запасом на откат, проверка выбора по определениям

const imageId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const headerPlace = starterCustomBlock('my-header', 'Моя шапка', 'header')
const footerPlace = starterCustomBlock('my-footer', 'Мой подвал', 'footer')

describe('место определения', () => {
  it('по умолчанию — блок страницы; у шапки и подвала заняты site и page', () => {
    expect(starterCustomBlock('promo', 'Промо').placement).toBe('block')
    expect(headerPlace.placement).toBe('header')
    const field = (name: string) => [{ type: 'text', name, label: 'Поле' }]
    expect(CustomBlockDraft.safeParse({ ...headerPlace, fields: field('page') }).success).toBe(
      false,
    )
    // У обычного блока такие ключи полей остаются можно: старые определения не ломаются
    const block = starterCustomBlock('promo', 'Промо')
    expect(CustomBlockDraft.safeParse({ ...block, fields: field('site') }).success).toBe(true)
  })

  it('вид шапки на странице — ошибка, а не блок', () => {
    const { issues } = applyCustomBlocks(
      { blocks: [{ id: 'top', type: 'custom:my-header', props: {} }] },
      [headerPlace],
    )
    expect(issues).toEqual([
      {
        path: ['blocks', 0, 'type'],
        message:
          '«Моя шапка» — свой вид шапки сайта, а не блок страницы: его выбирают в «Шапка и подвал». Уберите блок со страницы',
      },
    ])
  })
})

describe('выбор своего вида', () => {
  it('шапка и подвал по умолчанию — стандартные', () => {
    expect(Header.parse({}).custom).toBeNull()
    expect(Footer.parse({}).custom).toBeNull()
  })

  it('ключ — часть вида (владелец), поля — нет (администратор сайта)', () => {
    const a = Header.parse({ custom: { key: 'my-header', props: { tagline: 'А' } } })
    const b = Header.parse({ custom: { key: 'my-header', props: { tagline: 'Б' } } })
    expect(sameHeaderLook(a, b)).toBe(true)
    expect(sameHeaderLook(a, Header.parse({}))).toBe(false)
    expect(headerLookOf(a).custom).toBe('my-header')
    expect(footerLookOf(Footer.parse({ custom: { key: 'my-footer' } })).custom).toBe('my-footer')
  })

  it('картинки полей своего вида — в списке картинок шапки и подвала', () => {
    const custom = { key: 'my-header', props: { logo2: { mediaId: imageId, alt: '' } } }
    expect(headerMediaIds(Header.parse({ custom }))).toEqual([imageId])
    expect(footerMediaIds(Footer.parse({ custom }))).toEqual([imageId])
  })

  it('из базы: незнакомые ключи отброшены, непонятный вид — стандартная шапка', () => {
    expect(readCustomPlace({ key: 'my-header', props: { a: 1 }, later: true })).toEqual({
      key: 'my-header',
      props: { a: 1 },
    })
    const invalid: string[] = []
    expect(
      readHeader({ custom: { key: 'Плохой ключ' } }, (field) => invalid.push(field)).custom,
    ).toBe(null)
    expect(invalid).toEqual(['custom'])
    expect(readFooter({ custom: 'строка' }).custom).toBeNull()
    // Прежние шапки без поля — стандартные
    expect(readHeader({ layout: 'classic' }).custom).toBeNull()
  })

  it('проверка по определениям: нет, не то место, поля не подходят', () => {
    const definitions = [headerPlace, footerPlace]
    expect(customPlaceIssues(null, 'header', definitions)).toEqual([])
    expect(customPlaceIssues({ key: 'gone', props: {} }, 'header', definitions)[0]?.path).toBe(
      'custom.key',
    )
    expect(
      customPlaceIssues({ key: 'my-footer', props: {} }, 'header', definitions)[0]?.message,
    ).toMatch(/«Мой подвал» — не вид шапки/)
    expect(
      customPlaceIssues({ key: 'my-header', props: { tagline: 1 } }, 'header', definitions),
    ).toEqual([{ path: 'custom.props.tagline', message: expect.any(String) }])
    expect(customPlaceIssues({ key: 'my-header', props: {} }, 'header', definitions)).toEqual([])
  })
})
