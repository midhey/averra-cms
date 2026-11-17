import { describe, expect, it } from 'vitest'
import { NewPreviewLink, PreviewToken } from './preview'

describe('ссылка на черновики', () => {
  it('срок 3 дня по умолчанию; только 1, 3 или 7 дней', () => {
    expect(NewPreviewLink.parse({ name: '  Заказчик  ' })).toEqual({ name: 'Заказчик', days: 3 })
    expect(NewPreviewLink.safeParse({ name: 'Заказчик', days: 365 }).success).toBe(false)
    expect(NewPreviewLink.safeParse({ name: ' ' }).success).toBe(false)
    expect(NewPreviewLink.safeParse({ name: 'Заказчик', admin: true }).success).toBe(false)
    expect(PreviewToken.safeParse('cms_123').success).toBe(false)
  })
})
