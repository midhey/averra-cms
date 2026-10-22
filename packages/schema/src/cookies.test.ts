import { describe, expect, it } from 'vitest'
import {
  analyticsDescription,
  CookieSettings,
  cookieNoticeShown,
  cookieNoticeText,
  defaultCookieText,
} from './cookies'
import { readSiteSettings, SiteSettingsPatch } from './site-settings'

const metrika = { metrika: '98765432', ga4: '' }
const both = { metrika: '98765432', ga4: 'G-ABC123' }

describe('CookieSettings', () => {
  it('по умолчанию — согласие до аналитики, карточка в углу, текст и политика пусты', () => {
    expect(CookieSettings.parse({})).toEqual({
      mode: 'consent',
      look: 'card',
      text: '',
      policyPage: '',
    })
  })

  it('старые настройки без группы cookies читаются умолчаниями', () => {
    expect(readSiteSettings({ analytics: metrika }).cookies.mode).toBe('consent')
  })

  it('незнакомый вид из более новой версии — группа читается умолчаниями', () => {
    const fields: string[] = []
    const settings = readSiteSettings({ cookies: { look: 'popup' } }, (field) => fields.push(field))
    expect(settings.cookies.look).toBe('card')
    expect(fields).toEqual(['cookies'])
  })

  it('PATCH проверяет режим, вид, длину текста и адрес политики', () => {
    const result = SiteSettingsPatch.safeParse({
      cookies: { mode: 'silent', look: 'popup', text: 'а'.repeat(401), policyPage: '/privacy' },
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'cookies.mode',
      'cookies.look',
      'cookies.text',
      'cookies.policyPage',
    ])
    expect(SiteSettingsPatch.parse({ cookies: { policyPage: 'privacy' } }).cookies).toEqual({
      mode: 'consent',
      look: 'card',
      text: '',
      policyPage: 'privacy',
    })
  })
})

describe('текст уведомления', () => {
  it('уведомление только при счётчике', () => {
    expect(cookieNoticeShown({ metrika: '', ga4: '' })).toBe(false)
    expect(cookieNoticeShown({ metrika: '', ga4: 'G-ABC123' })).toBe(true)
  })

  it('по умолчанию называет сервисы, которые на сайте есть', () => {
    expect(defaultCookieText('consent', metrika)).toBe(
      'Необходимые cookie нужны, чтобы сайт работал. Аналитические (Яндекс Метрика) включим только с вашего согласия.',
    )
    expect(defaultCookieText('consent', both)).toContain('(Яндекс Метрика и Google Analytics)')
    expect(defaultCookieText('notice', both)).toContain(
      'и Яндекс Метрику и Google Analytics, чтобы',
    )
    expect(analyticsDescription({ metrika: '', ga4: 'G-ABC123' })).toBe(
      'Google Analytics: посещения и источники переходов.',
    )
  })

  it('без счётчиков — общими словами, без пустых скобок и висящих запятых', () => {
    const none = { metrika: '', ga4: '' }
    expect(defaultCookieText('consent', none)).toBe(
      'Необходимые cookie нужны, чтобы сайт работал. Аналитические включим только с вашего согласия.',
    )
    expect(defaultCookieText('notice', none)).toContain('и сервисы аналитики, чтобы')
    for (const mode of ['consent', 'notice'] as const) {
      expect(defaultCookieText(mode, none)).not.toMatch(/\(\)|и ,/)
    }
  })

  it('свой текст главнее', () => {
    const cookies = CookieSettings.parse({ text: '  Свой текст  ' })
    expect(cookieNoticeText(cookies, metrika)).toBe('Свой текст')
  })
})
