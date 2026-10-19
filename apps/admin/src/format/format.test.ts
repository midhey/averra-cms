import { describe, expect, it } from 'vitest'
import { countRu, pluralRu } from './plural'
import { formatDuration, formatTime, relativeTime } from './time'

const tz = 'Europe/Moscow'
// 19 октября 2026, 15:00 по Москве
const now = new Date('2026-10-19T12:00:00.000Z')

describe('relativeTime', () => {
  it('меньше минуты назад и время из будущего — «только что»', () => {
    expect(relativeTime('2026-10-19T11:59:30.000Z', now, tz)).toBe('только что')
    expect(relativeTime('2026-10-19T12:00:20.000Z', now, tz)).toBe('только что')
  })

  it('минуты и часы назад', () => {
    expect(relativeTime('2026-10-19T11:45:00.000Z', now, tz)).toBe('15 минут назад')
    expect(relativeTime('2026-10-19T11:59:00.000Z', now, tz)).toBe('1 минуту назад')
    expect(relativeTime('2026-10-19T10:00:00.000Z', now, tz)).toBe('2 часа назад')
  })

  it('вчера — по календарю в поясе человека, а не 24 часа назад', () => {
    // 18 октября, 23:30 по Москве
    expect(relativeTime('2026-10-18T20:30:00.000Z', now, tz)).toBe('вчера')
    // 19 октября, 00:30 по Москве — ещё сегодня
    expect(relativeTime('2026-10-18T21:30:00.000Z', now, tz)).toBe('14 часов назад')
  })

  it('раньше — дата, с годом только для прошлых лет', () => {
    expect(relativeTime('2026-10-12T09:00:00.000Z', now, tz)).toBe('12 октября')
    expect(relativeTime('2025-12-30T09:00:00.000Z', now, tz)).toBe('30 декабря 2025 г.')
  })
})

describe('время дня и длительность', () => {
  it('время дня', () => {
    expect(formatTime('2026-10-19T09:14:00.000Z', tz)).toBe('12:14')
  })

  it('секунды и минуты', () => {
    expect(formatDuration(41_200)).toBe('41 с')
    expect(formatDuration(120_000)).toBe('2 мин')
    expect(formatDuration(125_000)).toBe('2 мин 5 с')
    expect(formatDuration(-5)).toBe('0 с')
  })
})

describe('склонение', () => {
  const forms = ['страница', 'страницы', 'страниц'] as const

  it.each([
    [1, 'страница'],
    [2, 'страницы'],
    [4, 'страницы'],
    [5, 'страниц'],
    [11, 'страниц'],
    [12, 'страниц'],
    [21, 'страница'],
    [22, 'страницы'],
    [112, 'страниц'],
    [0, 'страниц'],
  ])('%i — %s', (count, word) => {
    expect(pluralRu(count, forms)).toBe(word)
  })

  it('число и слово', () => {
    expect(countRu(3, forms)).toBe('3 страницы')
  })
})
