import { afterAll, describe, expect, it } from 'vitest'
import { prepareRequest } from '../../client-ip'
import { createTestApi } from '../../testing'

// Приём заявок за Caddy (установка на сервере): форма сайта шлёт заявку на свой же домен
// (/api/forms/… от корня сайта, CMS_LINKS=relative), Caddy домена сайта передаёт этот путь в API
// с настоящим Host, Origin и Referer браузера и ставит X-Forwarded-For. API здесь видит запрос так
// же: адрес — домен сайта, сокет — loopback (Caddy на том же сервере), TRUST_PROXY=true

const api = await createTestApi({
  leadLimits: {
    perIp: { max: 1, windowMs: 60_000 },
    perSite: { max: 100, windowMs: 60_000 },
    perSiteDailyBytes: 1024 * 1024,
    smallLeadBytes: 8 * 1024,
  },
})
afterAll(api.close)
const owner = await api.loginAs('owner')

const SITE = 'https://remont.example.ru'
/** Адрес контейнера Caddy в сети Docker Compose: для API это адрес сокета */
const CADDY_SOCKET = '172.18.0.3'

const created = await api.app.request('/api/sites', {
  method: 'POST',
  headers: { ...owner.headers, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Ремонт' }),
})
const { id: siteId } = (await created.json()) as { id: string }
for (const slug of ['index', 'o-nas']) {
  await api.app.request(`/api/sites/${siteId}/pages/${slug}`, {
    method: 'PUT',
    headers: { ...owner.headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: slug,
      content: {
        blocks: [
          {
            id: 'lead',
            type: 'form',
            props: {
              title: 'Заявка',
              fields: [{ name: 'name', type: 'name', label: 'Имя', required: true }],
              policyUrl: '/privacy',
            },
          },
        ],
      },
    }),
  })
  await api.app.request(`/api/sites/${siteId}/pages/${slug}/publish`, {
    method: 'POST',
    headers: owner.headers,
  })
}

/**
 * Отправка формы со страницы slug сайта через Caddy. Форма и страница — один источник, поэтому
 * Referer у браузера полный (с путём). clientIp — что Caddy поставил в X-Forwarded-For
 */
function viaProxy(slug: string, clientIp: string, trustProxy = true) {
  const path = slug === 'index' ? '/' : `/${slug}/`
  const request = new Request(`${SITE}/api/forms/${siteId}/${slug}/lead`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: SITE,
      referer: `${SITE}${path}`,
      'x-forwarded-for': clientIp,
    },
    body: new URLSearchParams({ name: 'Анна', consent: 'yes' }),
  })
  const prepared = prepareRequest(request, CADDY_SOCKET, { trustProxy, loopbackOnly: false })
  if (prepared instanceof Response) throw new Error('prepareRequest отказал')
  return api.app.fetch(prepared)
}

describe('форма сайта через прокси домена сайта', () => {
  it('303 обратно на ту же страницу того же домена, с якорем «Спасибо»', async () => {
    const res = await viaProxy('o-nas', '203.0.113.10')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${SITE}/o-nas/#lead-sent`)
  })

  it('лимит по IP считается по X-Forwarded-For от Caddy, а не по адресу Caddy', async () => {
    expect((await viaProxy('index', '203.0.113.20')).status).toBe(303)
    // Тот же посетитель — сверх лимита (1 в минуту в этом тесте)
    expect((await viaProxy('index', '203.0.113.20')).status).toBe(429)
    // Другой посетитель за тем же Caddy — свой счётчик
    expect((await viaProxy('index', '203.0.113.21')).status).toBe(303)
  })

  it('без TRUST_PROXY все посетители за прокси были бы одним IP — поэтому в compose он включён', async () => {
    expect((await viaProxy('index', '198.51.100.1', false)).status).toBe(303)
    expect((await viaProxy('index', '198.51.100.2', false)).status).toBe(429)
  })
})
