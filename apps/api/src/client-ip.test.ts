import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { afterAll, describe, expect, it } from 'vitest'
import { isLoopbackAddress, prepareRequest, serverFetch } from './client-ip'
import { createTestApi, testOrigins } from './testing'

const request = () =>
  new Request('http://localhost:4000/api/health', {
    headers: { 'x-forwarded-for': '198.51.100.7' },
  })

describe('адрес клиента', () => {
  it('без доверенного прокси X-Forwarded-For заменяется адресом соединения', () => {
    const prepared = prepareRequest(request(), '203.0.113.5', {
      trustProxy: false,
      loopbackOnly: false,
    })
    expect(prepared).toBeInstanceOf(Request)
    expect((prepared as Request).headers.get('x-forwarded-for')).toBe('203.0.113.5')
  })

  it('с доверенным прокси заголовок остаётся как есть', () => {
    const prepared = prepareRequest(request(), '127.0.0.1', {
      trustProxy: true,
      loopbackOnly: false,
    })
    expect((prepared as Request).headers.get('x-forwarded-for')).toBe('198.51.100.7')
  })

  it('на учебном секрете отвечает только соединениям с этого компьютера', async () => {
    const options = { trustProxy: false, loopbackOnly: true }
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(prepareRequest(request(), address, options)).toBeInstanceOf(Request)
    }
    for (const address of ['203.0.113.5', '::ffff:203.0.113.5', '10.0.0.1', undefined]) {
      const refused = prepareRequest(request(), address, options) as Response
      expect(refused).toBeInstanceOf(Response)
      expect(refused.status).toBe(403)
      const body = (await refused.json()) as { error: { message: string } }
      expect(body.error.message).toMatch(/AUTH_SECRET/)
    }
    // Адрес — от сокета, а не из заголовка, который пишет клиент
    const forged = new Request('http://localhost/api/health', {
      headers: { 'x-forwarded-for': '127.0.0.1' },
    })
    expect(
      prepareRequest(forged, '203.0.113.5', { trustProxy: true, loopbackOnly: true }),
    ).toBeInstanceOf(Response)
  })

  it('на учебном секрете не отвечает и на чужое имя в Host, даже с 127.0.0.1', () => {
    const options = { trustProxy: true, loopbackOnly: true }
    // Так приходит запрос через прокси на том же сервере (Caddy оставляет Host) и при подмене DNS
    const proxied = new Request('http://cms.example.ru/api/health')
    expect((prepareRequest(proxied, '127.0.0.1', options) as Response).status).toBe(403)
    for (const host of ['localhost:4000', '127.0.0.1:4000', '[::1]:4000', 'admin.localhost']) {
      const local = new Request(`http://${host}/api/health`)
      expect(prepareRequest(local, '127.0.0.1', options)).toBeInstanceOf(Request)
    }
    // Со своим секретом имя в Host не важно
    const open = { trustProxy: true, loopbackOnly: false }
    expect(prepareRequest(proxied, '127.0.0.1', open)).toBeInstanceOf(Request)
  })

  it('isLoopbackAddress не путает похожие адреса', () => {
    expect(isLoopbackAddress('127.10.0.1')).toBe(true)
    expect(isLoopbackAddress('1127.0.0.1')).toBe(false)
    expect(isLoopbackAddress('::12')).toBe(false)
  })
})

describe('настоящий сервер без прокси', async () => {
  const api = await createTestApi()
  const owner = await api.createUser('owner')
  const server = serve({
    fetch: serverFetch(api.app, { trustProxy: false, loopbackOnly: true }),
    port: 0,
    hostname: '127.0.0.1',
  })
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await api.close()
  })

  it('подмена X-Forwarded-For не обходит лимит попыток входа', async () => {
    const statuses: number[] = []
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: testOrigins.admin,
          // Каждая попытка «с нового IP»: без перезаписи лимит бы не сработал
          'x-forwarded-for': `198.51.100.${attempt}`,
        },
        body: JSON.stringify({ email: owner.email, password: 'wrong-password-1' }),
      })
      statuses.push(res.status)
    }
    expect(statuses).toEqual([401, 401, 401, 429])
  })
})
