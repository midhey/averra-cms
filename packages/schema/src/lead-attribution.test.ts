import { describe, expect, it } from 'vitest'
import { LeadAttribution, LeadSummaryQuery, UTM_KEYS } from './lead-attribution'

describe('источник заявки', () => {
  it('обрезает метки, удаляет многострочные значения и неизвестные поля', () => {
    const parsed = LeadAttribution.parse({
      utm_source: `  ${'я'.repeat(250)}  `,
      utm_medium: 'a\nb',
      utm_campaign: 'a\u0000b',
      utm_content: 'a\u2028b',
      utm_term: ['не строка'],
      unknown: 'секрет',
    })
    expect(parsed.utm_source).toHaveLength(200)
    expect(UTM_KEYS.slice(1).map((key) => parsed[key])).toEqual(['', '', '', ''])
    expect(parsed).not.toHaveProperty('unknown')
    expect(LeadAttribution.parse({}).pageUrl).toBe('')
  })

  it('период сводки — только 7, 30 или 90 дней', () => {
    expect(LeadSummaryQuery.parse({}).days).toBe('30')
    expect(LeadSummaryQuery.safeParse({ days: '8' }).success).toBe(false)
  })
})
