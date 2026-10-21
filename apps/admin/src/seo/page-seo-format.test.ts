import type { SeoCheck } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import { adviceText, checkPageSeo, clip, normalizedSeo, sortedChecks } from './page-seo-format'

const mediaId = '11111111-1111-4111-8111-111111111111'

describe('SEO страницы для сохранения', () => {
  it('пустые строки, пробелы и снятый флажок — как будто полей нет', () => {
    expect(
      normalizedSeo({ title: '  ', description: '', canonical: ' ', noindex: false }),
    ).toBeUndefined()
    expect(normalizedSeo({ title: 'Цены', image: { mediaId }, noindex: true })).toEqual({
      title: 'Цены',
      image: { mediaId },
      noindex: true,
    })
  })

  it('ошибки — по полям, как у API; без ошибок — данные после схемы', () => {
    const bad = checkPageSeo({ canonical: 'http://example.ru/', description: 'а'.repeat(301) })
    expect(bad.seo).toBeUndefined()
    expect(Object.keys(bad.errors).toSorted()).toEqual(['canonical', 'description'])
    expect(checkPageSeo({ title: ' Цены ' })).toEqual({ seo: { title: 'Цены' }, errors: {} })
    expect(checkPageSeo({})).toEqual({ seo: undefined, errors: {} })
  })
})

describe('обрезка, как в выдаче', () => {
  it('короткое — как есть, длинное — по слову с многоточием', () => {
    expect(clip('Цены', 60)).toBe('Цены')
    expect(clip('а'.repeat(60), 60)).toBe('а'.repeat(60))
    const cut = clip('Ремонт квартир под ключ в Твери и области с гарантией три года', 40)
    expect(cut).toBe('Ремонт квартир под ключ в Твери и…')
    expect([...cut].length).toBeLessThanOrEqual(40)
  })

  it('без пробелов рядом с пределом — режет по букве', () => {
    expect(clip('а'.repeat(80), 20)).toBe(`${'а'.repeat(19)}…`)
  })
})

describe('проверки на экране', () => {
  it('сначала важное, потом что поправить, потом что хорошо', () => {
    const checks: SeoCheck[] = [
      { id: 'title', level: 'good', title: 'А' },
      { id: 'description', level: 'warning', title: 'Б' },
      { id: 'h1', level: 'problem', title: 'В' },
    ]
    expect(sortedChecks(checks).map((check) => check.level)).toEqual(['problem', 'warning', 'good'])
  })

  it('число советов словами', () => {
    expect([1, 2, 5, 21].map(adviceText)).toEqual(['1 совет', '2 совета', '5 советов', '21 совет'])
  })
})
