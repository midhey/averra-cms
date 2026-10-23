import { describe, expect, it } from 'vitest'
import { catalogEntry } from '../editor/catalog'
import {
  emptyValue,
  enumAppearance,
  enumLabel,
  fieldKind,
  isMonospace,
  type JsonSchema,
} from './json-schema'

const field = (schema: JsonSchema, key: string): JsonSchema => {
  const child = schema.properties?.[key]
  if (!child) throw new Error(`Нет поля ${key}`)
  return child
}

describe('fieldKind', () => {
  it('подбирает поле формы по схеме блока', () => {
    const hero = catalogEntry('hero').schema
    expect(fieldKind(field(hero, 'variant'))).toBe('select')
    expect(fieldKind(field(hero, 'title'))).toBe('text')
    expect(fieldKind(field(hero, 'subtitle'))).toBe('textarea')
    expect(fieldKind(field(hero, 'button'))).toBe('object')
    expect(fieldKind(field(field(hero, 'button'), 'href'))).toBe('text')
    expect(fieldKind(field(catalogEntry('features').schema, 'items'))).toBe('list')
    // Картинка — объект, но со своим виджетом: выбор из медиатеки и alt
    expect(fieldKind(field(hero, 'image'))).toBe('image')
  })

  it('поля блока «Форма»: флажок «Обязательное», тип с русскими подписями, варианты списком', () => {
    const fields = field(catalogEntry('form').schema, 'fields')
    expect(fieldKind(fields)).toBe('list')
    const item = fields.items ?? {}
    expect(fieldKind(field(item, 'required'))).toBe('checkbox')
    expect(fieldKind(field(item, 'type'))).toBe('select')
    expect(field(item, 'type')['x-enum-titles']).toMatchObject({ phone: 'Телефон' })
    expect(fieldKind(field(item, 'options'))).toBe('list')
    expect(emptyValue(item)).toEqual({ name: '', type: 'name', label: '' })
  })

  it('список строк — тоже карточки: «Что входит» у тарифа', () => {
    const plan = field(catalogEntry('pricing').schema, 'plans').items ?? {}
    const features = field(plan, 'features')
    expect(fieldKind(features)).toBe('list')
    expect(emptyValue(features.items ?? {})).toBe('')
    expect(fieldKind(field(plan, 'featured'))).toBe('checkbox')
    expect(fieldKind({ type: 'array', items: { type: 'number' } })).toBe('unsupported')
  })
})

describe('emptyValue', () => {
  it('заполняет обязательные поля и берёт значения по умолчанию', () => {
    const hero = catalogEntry('hero').schema
    expect(emptyValue(field(hero, 'button'))).toEqual({ label: '', href: '' })
    expect(emptyValue(field(hero, 'variant'))).toBe('centered')
  })
})

describe('enumAppearance и isMonospace', () => {
  it('вариант оформления — карточки, короткий выбор — сегменты, длинный — список', () => {
    const hero = catalogEntry('hero').schema
    expect(enumAppearance(field(hero, 'variant'))).toBe('cards')
    expect(enumAppearance(field(catalogEntry('features').schema, 'columns'))).toBe('segments')
    const item = field(catalogEntry('form').schema, 'fields').items ?? {}
    expect(enumAppearance(field(item, 'type'))).toBe('select')
  })

  it('без миниатюры у одного из значений — не карточки', () => {
    const schema: JsonSchema = {
      enum: ['a', 'b'],
      'x-enum-sketches': { a: 'centered' },
    }
    expect(enumAppearance(schema)).toBe('segments')
  })

  it('длинные подписи не лезут в сегменты, даже если вариантов мало', () => {
    const schema: JsonSchema = {
      enum: ['a', 'b'],
      'x-enum-titles': { a: 'Очень длинная подпись', b: 'Б' },
    }
    expect(enumAppearance(schema)).toBe('select')
  })

  it('подпись варианта — из x-enum-titles, иначе значение', () => {
    const variant = field(catalogEntry('hero').schema, 'variant')
    expect(enumLabel(variant, 'split')).toBe('С картинкой')
    expect(enumLabel({ enum: [2, 3] }, 3)).toBe('3')
  })

  it('ссылка — моноширинным, обычный текст — нет', () => {
    const hero = catalogEntry('hero').schema
    expect(isMonospace(field(field(hero, 'button'), 'href'))).toBe(true)
    expect(isMonospace(field(hero, 'title'))).toBe(false)
  })
})
