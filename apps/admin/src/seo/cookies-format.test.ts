import { defaultCookieText } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import {
  legalPageOf,
  type PageListItem,
  policyOptions,
  policyProblem,
  previewAnalytics,
} from './cookies-format'

const pages: PageListItem[] = [
  { slug: 'index', title: 'Главная', publishedAt: '2026-10-01T10:00:00Z' },
  { slug: '404', title: 'Страница не найдена', publishedAt: null },
  { slug: 'privacy', title: 'Политика конфиденциальности', publishedAt: null },
  { slug: 'consent', title: 'Согласие', publishedAt: '2026-10-02T10:00:00Z' },
]

describe('предпросмотр без счётчиков', () => {
  it('образец с Метрикой: подсказка текста совпадает с предпросмотром, без пустых скобок', () => {
    const none = { metrika: '', ga4: '' }
    expect(previewAnalytics(none)).toEqual({ metrika: '1', ga4: '' })
    expect(defaultCookieText('consent', previewAnalytics(none))).toContain('(Яндекс Метрика)')
    const real = { metrika: '', ga4: 'G-ABC123' }
    expect(previewAnalytics(real)).toBe(real)
  })
})

describe('страница политики', () => {
  it('варианты: «не выбрана» и страницы сайта без 404', () => {
    expect(policyOptions(pages, '')).toEqual([
      { value: '', label: 'Не выбрана' },
      { value: 'index', label: 'Главная — /' },
      { value: 'privacy', label: 'Политика конфиденциальности — /privacy' },
      { value: 'consent', label: 'Согласие — /consent' },
    ])
  })

  it('удалённая выбранная страница остаётся в списке с пометкой', () => {
    expect(policyOptions(pages, 'old-policy').at(-1)).toEqual({
      value: 'old-policy',
      label: '/old-policy — страницы нет',
    })
  })

  it('говорит, почему ссылки на сайте не будет', () => {
    expect(policyProblem(pages, '')).toMatch(/не выбрана/)
    expect(policyProblem(pages, 'privacy')).toMatch(/ещё не опубликована/)
    expect(policyProblem(pages, 'old')).toMatch(/Страницы \/old на сайте нет/)
    expect(policyProblem(pages, 'consent')).toBeUndefined()
  })

  it('шаблон документа уже создан — находим его страницу', () => {
    expect(legalPageOf(pages, 'privacy')?.title).toBe('Политика конфиденциальности')
    expect(legalPageOf(pages.slice(0, 2), 'consent')).toBeUndefined()
  })
})
