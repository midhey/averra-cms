import {
  defaultFooter,
  defaultHeader,
  FOOTER_LOOK_FIELDS,
  footerLookOf,
  HEADER_LOOK_FIELDS,
  headerLookOf,
  LOOK_LOCKED_CODE,
} from '@averra/schema'
import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../errors'
import { adoptFooterLook, adoptHeaderLook, isLookConflict } from './look-conflict'

describe('вид сменил владелец', () => {
  it('403 с кодом вида — конфликт вида, другие отказы (в том числе другой 403) — нет', () => {
    expect(isLookConflict(new ApiRequestError(403, 'нет', [], LOOK_LOCKED_CODE))).toBe(true)
    expect(isLookConflict(new ApiRequestError(403, 'нет', [], 'forbidden'))).toBe(false)
    expect(isLookConflict(new ApiRequestError(403, 'нет'))).toBe(false)
    expect(isLookConflict(new ApiRequestError(409, 'нет'))).toBe(false)
    expect(isLookConflict(new Error('сеть'))).toBe(false)
  })

  it('шапка: вид с сервера, тексты свои', () => {
    const mine = { ...defaultHeader, brand: 'text' as const, logoText: 'Мои правки' }
    const fresh = { ...defaultHeader, layout: 'minimal' as const, sticky: !defaultHeader.sticky }
    const merged = adoptHeaderLook(mine, fresh)
    expect(headerLookOf(merged)).toEqual(headerLookOf(fresh))
    expect(merged.logoText).toBe('Мои правки')
    expect(merged.brand).toBe('text')
  })

  it('переносится каждое поле вида, какое знает схема, и список полный', () => {
    // Список полей — один для проверки владельца и переноса вида: поле вне него не пропустить
    expect(Object.keys(headerLookOf(defaultHeader))).toEqual([...HEADER_LOOK_FIELDS, 'custom'])
    expect(Object.keys(footerLookOf(defaultFooter))).toEqual([...FOOTER_LOOK_FIELDS, 'custom'])
    for (const key of HEADER_LOOK_FIELDS) {
      const fresh = { ...defaultHeader, [key]: 'probe' } as unknown as typeof defaultHeader
      expect(adoptHeaderLook(defaultHeader, fresh)[key]).toBe('probe')
    }
    for (const key of FOOTER_LOOK_FIELDS) {
      const fresh = { ...defaultFooter, [key]: 'probe' } as unknown as typeof defaultFooter
      expect(adoptFooterLook(defaultFooter, fresh)[key]).toBe('probe')
    }
  })

  it('подвал: вид с сервера, тексты свои', () => {
    const mine = { ...defaultFooter, divider: !defaultFooter.divider }
    const fresh = { ...defaultFooter, layout: 'big' as const }
    const merged = adoptFooterLook(mine, fresh)
    expect(footerLookOf(merged)).toEqual(footerLookOf(fresh))
  })
})
