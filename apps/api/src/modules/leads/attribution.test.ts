import { describe, expect, it } from 'vitest'
import { leadAttribution } from './attribution'

const input = {
  origin: 'https://site.test',
  referer: 'https://site.test/contact?utm_source=ya&utm_campaign=x&secret=1',
  requestUrl: 'https://api.test/api/forms/site/contact/form',
  pagePath: '/contact',
  raw: {},
}

describe('источник из заголовков и скрытых полей', () => {
  it('без JS читает метки Referer своего сайта и сохраняет только его домен', () => {
    expect(leadAttribution(input)).toMatchObject({
      utm_source: 'ya',
      utm_campaign: 'x',
      pageUrl: 'https://site.test/contact',
      referrerDomain: 'site.test',
    })
    expect(JSON.stringify(leadAttribution(input))).not.toContain('secret')
  })

  it('чужой Referer даёт только домен, без меток, пути и запроса', () => {
    expect(
      leadAttribution({ ...input, referer: 'https://search.test/private?utm_source=evil' }),
    ).toMatchObject({
      utm_source: '',
      referrerDomain: 'search.test',
    })
  })

  it('скрытые поля имеют приоритет; адрес страницы и Referer очищаются', () => {
    expect(
      leadAttribution({
        ...input,
        raw: {
          _av_utm_source: ' direct ',
          _av_utm_campaign: 'a\nb',
          _av_referrer: 'https://external.test/secret?q=1',
          _av_page_url: 'https://site.test/contact/?secret=1#fragment',
          other: 'secret',
        },
      }),
    ).toMatchObject({
      utm_source: 'direct',
      utm_campaign: '',
      referrerDomain: 'external.test',
      pageUrl: 'https://site.test/contact/',
    })
  })

  it('не хранит произвольный адрес, credentials, не-HTTP адреса и многострочные метки', () => {
    const parsed = leadAttribution({
      ...input,
      referer: undefined,
      raw: {
        _av_page_url: 'https://other.test/private',
        _av_referrer: 'https://user:password@other.test/path',
        _av_utm_source: 'a\nb',
      },
    })
    expect(parsed).toMatchObject({
      pageUrl: 'https://site.test/contact',
      referrerDomain: '',
      utm_source: '',
    })
  })
})
