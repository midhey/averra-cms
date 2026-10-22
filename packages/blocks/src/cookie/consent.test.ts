import { describe, expect, it } from 'vitest'
import {
  analyticsCookieNames,
  analyticsIds,
  analyticsStorageKeys,
  CONSENT_MAX_AGE,
  type ConsentConfig,
  choiceCookie,
  cookieDomains,
  createConsent,
  forgetCookies,
  needsNotice,
  readChoice,
} from './consent'

/** Страница для контроллера: cookie как в браузере и журнал того, что он попросил */
function fakePage(initialCookies = '') {
  const jar = new Map<string, string>()
  for (const part of initialCookies.split(';')) {
    const [name, value] = part.split('=')
    if (name?.trim()) jar.set(name.trim(), value?.trim() ?? '')
  }
  const calls: string[] = []
  const loaded: { metrika: string; ga4: string }[] = []
  const settings: { analytics?: boolean } = {}
  const cookies = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  return {
    calls,
    loaded,
    settings,
    cookies,
    ports: {
      readCookies: cookies,
      writeCookie: (cookie: string) => {
        calls.push(`cookie ${cookie}`)
        const [pair] = cookie.split(';')
        const [name, value] = (pair ?? '').split('=')
        if (name) jar.set(name, value ?? '')
      },
      loadAnalytics: (ids: { metrika: string; ga4: string }) => {
        calls.push('load')
        loaded.push(ids)
      },
      forgetAnalytics: () => calls.push('forget'),
      showNotice: () => calls.push('show'),
      hideNotice: () => calls.push('hide'),
      openSettings: (analytics: boolean) => {
        settings.analytics = analytics
        calls.push('open settings')
      },
      closeSettings: () => calls.push('close settings'),
    },
  }
}

const config: ConsentConfig = { mode: 'consent', metrika: '98765432', ga4: '', secure: true }

describe('cookie выбора', () => {
  it('только выбор, на год, на весь сайт; Secure — на https', () => {
    expect(choiceCookie('analytics', true)).toBe(
      `averra_consent=analytics; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax; Secure`,
    )
    expect(choiceCookie('necessary', false)).not.toContain('Secure')
    expect(CONSENT_MAX_AGE).toBe(31_536_000)
  })

  it('читает свой выбор среди чужих cookie, незнакомое значение — выбора нет', () => {
    expect(readChoice('_ym_uid=1; averra_consent=necessary; a=b')).toBe('necessary')
    expect(readChoice('averra_consent=maybe')).toBeUndefined()
    expect(readChoice('')).toBeUndefined()
  })

  it('уведомление: в режиме согласия — пока нет согласия или отказа', () => {
    expect(needsNotice('consent', undefined)).toBe(true)
    expect(needsNotice('consent', 'notice')).toBe(true)
    expect(needsNotice('consent', 'necessary')).toBe(false)
    expect(needsNotice('notice', undefined)).toBe(true)
    expect(needsNotice('notice', 'notice')).toBe(false)
    expect(needsNotice('notice', 'analytics')).toBe(false)
    // Отказ из режима согласия: сайт перешёл на уведомление — отказавшийся должен узнать об этом
    expect(needsNotice('notice', 'necessary')).toBe(true)
  })

  it('номера счётчиков — только проверенные', () => {
    expect(analyticsIds({ metrika: '1);alert(1);(', ga4: 'G-ABC123' })).toEqual({
      metrika: '',
      ga4: 'G-ABC123',
    })
  })
})

describe('режим согласия', () => {
  it('до выбора — уведомление и никаких счётчиков', () => {
    const page = fakePage()
    createConsent(config, page.ports).start()
    expect(page.calls).toEqual(['show'])
    expect(page.loaded).toEqual([])
  })

  it('«Принять все» — запоминает выбор, прячет уведомление и только тогда грузит счётчик', () => {
    const page = fakePage()
    const consent = createConsent(config, page.ports)
    consent.start()
    consent.acceptAll()
    expect(page.calls).toEqual([
      'show',
      `cookie averra_consent=analytics; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax; Secure`,
      'close settings',
      'hide',
      'load',
    ])
    expect(page.loaded).toEqual([{ metrika: '98765432', ga4: '' }])
  })

  it('сохранённое согласие — счётчик сразу, уведомления нет', () => {
    const page = fakePage('averra_consent=analytics')
    createConsent(config, page.ports).start()
    expect(page.calls).toEqual(['load'])
  })

  it('«Только необходимые» — счётчика нет ни сейчас, ни после перезагрузки', () => {
    const page = fakePage()
    const consent = createConsent(config, page.ports)
    consent.start()
    consent.necessaryOnly()
    expect(page.loaded).toEqual([])
    const again = fakePage(page.cookies())
    createConsent(config, again.ports).start()
    expect(again.calls).toEqual([])
  })

  it('окно настроек открывается снова с текущим выбором и сохраняет новый', () => {
    const page = fakePage('averra_consent=necessary')
    const consent = createConsent(config, page.ports)
    consent.start()
    consent.openSettings()
    expect(page.settings.analytics).toBe(false)
    consent.saveSettings(true)
    expect(consent.choice).toBe('analytics')
    expect(page.loaded).toHaveLength(1)
    consent.openSettings()
    expect(page.settings.analytics).toBe(true)
  })

  it('счётчик грузится один раз', () => {
    const page = fakePage('averra_consent=analytics')
    const consent = createConsent(config, page.ports)
    consent.start()
    consent.acceptAll()
    consent.saveSettings(true)
    expect(page.loaded).toHaveLength(1)
  })

  it('отзыв согласия после загрузки — стереть cookie счётчиков и перезагрузить', () => {
    const page = fakePage('averra_consent=analytics')
    const consent = createConsent(config, page.ports)
    consent.start()
    consent.saveSettings(false)
    expect(page.calls.at(-1)).toBe('forget')
    expect(consent.choice).toBe('necessary')
  })

  it('отказ до загрузки — перезагружать нечего', () => {
    const page = fakePage()
    const consent = createConsent(config, page.ports)
    consent.start()
    consent.saveSettings(false)
    expect(page.calls).not.toContain('forget')
  })

  it('неверный номер счётчика — грузить нечего даже после согласия', () => {
    const page = fakePage()
    const consent = createConsent({ ...config, metrika: 'abc' }, page.ports)
    consent.acceptAll()
    expect(page.loaded).toEqual([])
  })

  it('«Понятно» из режима уведомления — не согласие: сайт спросит снова', () => {
    const page = fakePage('averra_consent=notice')
    createConsent(config, page.ports).start()
    expect(page.calls).toEqual(['show'])
  })
})

describe('режим уведомления', () => {
  const notice: ConsentConfig = { ...config, mode: 'notice' }

  it('счётчики вставляет страница, скрипт только показывает уведомление', () => {
    const page = fakePage()
    const consent = createConsent(notice, page.ports)
    consent.start()
    consent.acknowledge()
    expect(page.loaded).toEqual([])
    expect(consent.choice).toBe('notice')
    const again = fakePage(page.cookies())
    createConsent(notice, again.ports).start()
    expect(again.calls).toEqual([])
  })

  it('согласие из режима согласия засчитывается: человек уже ответил «да»', () => {
    const page = fakePage('averra_consent=analytics')
    createConsent(notice, page.ports).start()
    expect(page.calls).toEqual([])
  })

  it('отказ из режима согласия — уведомление снова: счётчики теперь работают без спроса', () => {
    const page = fakePage('averra_consent=necessary')
    const consent = createConsent(notice, page.ports)
    consent.start()
    expect(page.calls).toEqual(['show'])
    consent.acknowledge()
    expect(consent.choice).toBe('notice')
    const again = fakePage(page.cookies())
    createConsent(notice, again.ports).start()
    expect(again.calls).toEqual([])
  })
})

describe('cookie счётчиков', () => {
  it('находит cookie Метрики, GA и меток gtag', () => {
    expect(
      analyticsCookieNames('_ym_uid=1; _ym_d=2; _ga=3; _ga_ABC=4; _gid=5; _gcl_au=7; other=6'),
    ).toEqual(['_ym_uid', '_ym_d', '_ga', '_ga_ABC', '_gid', '_gcl_au'])
  })

  it('ключи хранилища: _ym_uid Метрики в localStorage тоже стирается', () => {
    expect(
      analyticsStorageKeys(['_ym_uid', '_ym98765432_lsid', '_gcl_ls', 'averra_draft', 'theme']),
    ).toEqual(['_ym_uid', '_ym98765432_lsid', '_gcl_ls'])
  })

  it('стирает на хосте и всех родительских доменах', () => {
    expect(cookieDomains('www.remont.example.ru')).toEqual([
      '',
      'www.remont.example.ru',
      'remont.example.ru',
      'example.ru',
    ])
    expect(cookieDomains('localhost')).toEqual(['', 'localhost'])
    expect(cookieDomains('127.0.0.1')).toEqual(['', '127.0.0.1'])
    expect(forgetCookies('_ym_uid=1; averra_consent=necessary', 'example.ru')).toEqual([
      '_ym_uid=; Max-Age=0; Path=/',
      '_ym_uid=; Max-Age=0; Path=/; Domain=example.ru',
    ])
  })
})
