import { describe, expect, it } from 'vitest'
import { catalogEntry } from '../editor/catalog'
import { emptyValue, fieldKind, type JsonSchema } from './json-schema'

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
})

describe('emptyValue', () => {
  it('заполняет обязательные поля и берёт значения по умолчанию', () => {
    const hero = catalogEntry('hero').schema
    expect(emptyValue(field(hero, 'button'))).toEqual({ label: '', href: '' })
    expect(emptyValue(field(hero, 'variant'))).toBe('centered')
  })
})
