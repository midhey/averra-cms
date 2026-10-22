import { CookieSettings, type StoredSiteSettings } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CookieNotice, LegalFooter } from './CookieNotice'
import { cookieNoticeView } from './view'

type Settings = Pick<StoredSiteSettings, 'cookies' | 'analytics'>

const settings = (
  cookies: object = {},
  analytics = { metrika: '98765432', ga4: '' },
): Settings => ({
  cookies: CookieSettings.parse(cookies),
  analytics,
})

function renderNotice(input: Settings, published: string[] = ['index', 'privacy']) {
  const { notice, footer } = cookieNoticeView(input, published)
  return {
    notice: notice ? renderToStaticMarkup(<CookieNotice {...notice} />) : '',
    footer: renderToStaticMarkup(<LegalFooter {...footer} />),
  }
}

const buttonClasses = (html: string) =>
  [
    ...html.matchAll(
      /<button type="button" class="([^"]+)" data-consent-action="(all|necessary)"/g,
    ),
  ].map((match) => match[1])

describe('CookieNotice', () => {
  it('без счётчиков уведомления нет: сайт не ставит cookie', () => {
    const html = renderNotice(settings({}, { metrika: '', ga4: '' }))
    expect(html.notice).toBe('')
    expect(html.footer).not.toContain('Настройки cookie')
  })

  it('по умолчанию — согласие, карточка в углу; скрыто до скрипта', () => {
    const { notice } = renderNotice(settings({ policyPage: 'privacy' }))
    expect(notice).toMatch(
      /^<div class="[^"]+" data-cookie-consent="" data-mode="consent" data-look="card" data-metrika="98765432" hidden="">/,
    )
    expect(notice).toContain('<section class=')
    expect(notice).toContain('Яндекс Метрика')
    expect(notice).toContain('href="/privacy"')
    expect(notice).toContain('Только необходимые')
    expect(notice).toContain('Принять все')
    expect(notice).toContain('Настроить')
  })

  it('кнопки «Принять все» и «Только необходимые» — одного вида', () => {
    const { notice } = renderNotice(settings())
    const classes = buttonClasses(notice)
    expect(classes.length).toBeGreaterThanOrEqual(2)
    expect(new Set(classes).size).toBe(1)
  })

  it('окно настроек: заголовок, переключатель — настоящий флажок, «Закрыть»', () => {
    const { notice } = renderNotice(settings())
    expect(notice).toContain('<dialog class=')
    expect(notice).toContain('aria-labelledby="cookie-settings-title"')
    expect(notice).toMatch(/<input type="checkbox" role="switch" [^>]*name="analytics"/)
    expect(notice).toContain('aria-label="Закрыть"')
  })

  it('три вида: плашка — section с иконкой, карточка — section, окно — dialog', () => {
    const bar = renderNotice(settings({ look: 'bar' })).notice
    expect(bar).toContain('data-look="bar"')
    expect(bar).toMatch(/<section[^>]+data-look="bar"/)
    expect(bar).toContain('<svg')
    const card = renderNotice(settings({ look: 'card' })).notice
    expect(card).toMatch(/<section[^>]+data-look="card"/)
    const modal = renderNotice(settings({ look: 'modal' })).notice
    expect(modal).toMatch(/<dialog[^>]+data-look="modal"[^>]+data-consent-notice=""/)
    expect(modal).not.toContain('<section')
  })

  it('режим уведомления: «Понятно», без окна настроек и без номеров счётчиков', () => {
    const { notice, footer } = renderNotice(settings({ mode: 'notice', look: 'bar' }))
    expect(notice).toContain('Понятно')
    expect(notice).not.toContain('Принять все')
    expect(notice).not.toContain('data-consent-settings')
    expect(notice).not.toContain('data-metrika')
    expect(notice).toContain('Яндекс Метрику, чтобы понимать')
    expect(footer).not.toContain('Настройки cookie')
  })

  it('свой текст — как текст, а не HTML', () => {
    const { notice } = renderNotice(settings({ text: 'Мы <b>любим</b> cookie' }))
    expect(notice).toContain('Мы &lt;b&gt;любим&lt;/b&gt; cookie')
  })

  it('неопубликованная политика — ссылки нет', () => {
    const { notice, footer } = renderNotice(settings({ policyPage: 'privacy' }), ['index'])
    expect(notice).not.toContain('Политика конфиденциальности')
    expect(footer).not.toContain('Политика конфиденциальности')
  })

  it('подвал: политика видна и без JS, «Настройки cookie» — только со скриптом', () => {
    const { footer } = renderNotice(settings({ policyPage: 'privacy' }))
    expect(footer).toContain('<footer')
    expect(footer).toContain('<a href="/privacy"')
    expect(footer).toMatch(/data-consent-open=""[^>]*hidden=""/)
  })

  it('политика без счётчиков — подвал с политикой', () => {
    const { footer } = renderNotice(settings({ policyPage: 'privacy' }, { metrika: '', ga4: '' }))
    expect(footer).toContain('Политика конфиденциальности')
  })

  it('предпросмотр: видно сразу, окно по центру — открытым', () => {
    const view = cookieNoticeView(settings({ look: 'modal' }), [])
    if (!view.notice) throw new Error('нет уведомления')
    const html = renderToStaticMarkup(<CookieNotice {...view.notice} preview />)
    expect(html).not.toMatch(/^<div[^>]+hidden/)
    expect(html).toMatch(/<dialog[^>]+open=""/)
    expect(html).toContain('data-modal-open=""')
  })
})
