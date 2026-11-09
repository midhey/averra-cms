import { describe, expect, it } from 'vitest'
import { siteCsp } from './csp'

/** Директивы строки CSP: имя → значения */
const directives = (csp: string) =>
  Object.fromEntries(
    csp.split('; ').map((part) => {
      const [name = '', ...values] = part.split(' ')
      return [name, values]
    }),
  )

describe('siteCsp', () => {
  it('без интеграций: скрипты только с сайта, без inline и eval', () => {
    const csp = directives(siteCsp({ metrika: '', ga4: '', origins: [] }))
    expect(csp['script-src']).toEqual(["'self'"])
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['base-uri']).toEqual(["'self'"])
    expect(csp['form-action']).toEqual(["'self'"])
    expect(csp['frame-ancestors']).toEqual(["'self'"])
    expect(csp['default-src']).toEqual(["'self'"])
    // Площадки видео — всегда: блок «Видео» ставит их плеер по клику
    expect(csp['frame-src']).toContain('https://www.youtube-nocookie.com')
    expect(csp['frame-src']).toContain('https://rutube.ru')
    expect(csp['frame-src']).toContain('https://vkvideo.ru')
  })

  it("ни в одной директиве скриптов нет 'unsafe-inline' и 'unsafe-eval'", () => {
    const csp = siteCsp({ metrika: '12345678', ga4: 'G-ABCDEF', origins: ['https://w.example.ru'] })
    const script = directives(csp)['script-src'] ?? []
    expect(script).not.toContain("'unsafe-inline'")
    expect(script).not.toContain("'unsafe-eval'")
    expect(csp).not.toContain('unsafe-eval')
    // Стили — да: тема и CSS блоков лежат в <style> страницы
    expect(directives(csp)['style-src']).toContain("'unsafe-inline'")
  })

  it('Метрика: скрипт, картинки, запросы, фрейм и интерфейс карты кликов', () => {
    const csp = directives(siteCsp({ metrika: '12345678', ga4: '', origins: [] }))
    expect(csp['script-src']).toEqual(
      expect.arrayContaining(['https://mc.yandex.ru', 'https://yastatic.net']),
    )
    expect(csp['connect-src']).toEqual(
      expect.arrayContaining(['https://mc.yandex.ru', 'wss://mc.yandex.ru']),
    )
    expect(csp['img-src']).toContain('https://mc.yandex.ru')
    expect(csp['frame-ancestors']).toContain('https://metrika.yandex.ru')
    expect(csp['script-src']).not.toContain('https://*.googletagmanager.com')
  })

  it('GA4: свои домены, без Метрики', () => {
    const csp = directives(siteCsp({ metrika: '', ga4: 'G-ABCDEF', origins: [] }))
    expect(csp['script-src']).toEqual(["'self'", 'https://*.googletagmanager.com'])
    expect(csp['connect-src']).toContain('https://*.google-analytics.com')
    expect(csp['script-src']).not.toContain('https://mc.yandex.ru')
  })

  it('домены владельца — во всех директивах загрузки, но не в form-action и frame-ancestors', () => {
    const origin = 'https://widget.example.ru'
    const csp = directives(siteCsp({ metrika: '', ga4: '', origins: [origin] }))
    for (const name of [
      'script-src',
      'style-src',
      'img-src',
      'font-src',
      'connect-src',
      'frame-src',
    ]) {
      expect(csp[name], name).toContain(origin)
    }
    expect(csp['form-action']).not.toContain(origin)
    expect(csp['frame-ancestors']).not.toContain(origin)
  })

  it('адрес API в dev — для картинок и форм (и формы в окне), не для скриптов', () => {
    const csp = directives(
      siteCsp({ metrika: '', ga4: '', origins: [], apiOrigin: 'http://localhost:4000' }),
    )
    expect(csp['img-src']).toContain('http://localhost:4000')
    expect(csp['form-action']).toContain('http://localhost:4000')
    expect(csp['connect-src']).toContain('http://localhost:4000')
    expect(csp['script-src']).toEqual(["'self'"])
  })
})
