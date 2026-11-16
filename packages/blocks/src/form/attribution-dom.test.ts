// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://site.test/"}
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startLeadAttribution } from './attribution-dom'

beforeEach(() => {
  document.body.innerHTML = '<form method="post" action="/api/forms/site/index/form"></form>'
  window.sessionStorage.clear()
  window.history.replaceState(null, '', 'https://site.test/')
  Object.defineProperty(document, 'referrer', { configurable: true, value: '' })
})

const value = (key: string) =>
  document.querySelector<HTMLInputElement>(`input[name="_av_${key}"]`)?.value

describe('метки заявки в обычной POST-форме', () => {
  it('сохраняет кампанию при переходе на другую страницу и передаёт адрес без запроса', () => {
    window.history.replaceState(
      null,
      '',
      'https://site.test/?utm_source=ya&utm_campaign=x&email=secret#top',
    )
    Object.defineProperty(document, 'referrer', { value: 'https://search.test/path?q=private' })
    startLeadAttribution()
    expect(value('utm_source')).toBe('ya')
    expect(value('referrer')).toBe('https://search.test/')
    window.history.replaceState(null, '', '/contacts?private=1')
    Object.defineProperty(document, 'referrer', { value: 'https://site.test/' })
    startLeadAttribution()
    expect(value('utm_source')).toBe('ya')
    expect(value('utm_campaign')).toBe('x')
    expect(value('page_url')).toBe('https://site.test/contacts')
    expect(window.sessionStorage.getItem('averra_lead_attribution')).not.toContain('private')
    expect(document.querySelectorAll('[name="_av_utm_source"]')).toHaveLength(1)
  })

  it('новая кампания заменяет старые метки, лишние параметры не сохраняются', () => {
    window.history.replaceState(null, '', '/?utm_source=old&utm_campaign=old')
    startLeadAttribution()
    window.history.replaceState(null, '', '/?utm_source=new&unknown=secret')
    startLeadAttribution()
    expect(value('utm_source')).toBe('new')
    expect(value('utm_campaign')).toBe('')
    expect(window.sessionStorage.getItem('averra_lead_attribution')).not.toContain('secret')
  })

  it('работает с запрещённым sessionStorage и проверяет метки', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Запрещено')
    })
    window.history.replaceState(null, '', `/?utm_source=${'a'.repeat(300)}&utm_campaign=a%0Ab`)
    startLeadAttribution()
    expect(value('utm_source')).toHaveLength(200)
    expect(value('utm_campaign')).toBe('')
    spy.mockRestore()
  })

  it('прямой заход и форма, добавленная позднее: скрытые поля готовы до обработчика отправки', () => {
    startLeadAttribution()
    expect(value('referrer')).toBe('')
    const form = document.createElement('form')
    form.method = 'post'
    form.action = '/api/forms/site/window/form'
    document.body.append(form)
    let pageUrl = ''
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      pageUrl = form.querySelector<HTMLInputElement>('[name="_av_page_url"]')?.value ?? ''
    })
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(pageUrl).toBe('https://site.test/')
  })
})
