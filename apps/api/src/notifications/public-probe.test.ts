import { EventEmitter } from 'node:events'
import { checkServerIdentity, connect, type TLSSocket } from 'node:tls'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeCertificate, probePublicHttps, publicTargets } from './public-probe'

vi.mock('node:tls', () => ({ connect: vi.fn(), checkServerIdentity: vi.fn() }))

const now = new Date('2026-11-16T12:00:00.000Z')
class FakeSocket extends EventEmitter {
  authorized = true
  destroy = vi.fn()
  getPeerCertificate = vi.fn(() => ({
    valid_from: 'Nov 1 00:00:00 2026 GMT',
    valid_to: 'Dec 1 00:00:00 2026 GMT',
    fingerprint256: 'first',
  }))
}
let socket: FakeSocket

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  socket = new FakeSocket()
  vi.mocked(connect).mockReturnValue(socket as unknown as TLSSocket)
  vi.mocked(checkServerIdentity).mockReturnValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('публичные адреса и TLS', () => {
  it('разработка, отсутствие доменов и localhost отключают проверки', () => {
    const prod = {
      NODE_ENV: 'production',
      SITE_URL: 'https://remont.ru',
      ADMIN_URL: 'https://admin.remont.ru',
    }
    expect(publicTargets(prod)).toEqual([
      { target: 'site', url: 'https://remont.ru/' },
      { target: 'admin', url: 'https://admin.remont.ru/api/health' },
    ])
    for (const config of [
      { ...prod, NODE_ENV: 'development' },
      { ...prod, SITE_URL: undefined },
      { ...prod, SITE_URL: 'http://remont.ru' },
      { ...prod, ADMIN_URL: 'https://localhost' },
    ])
      expect(publicTargets(config)).toEqual([])
  })

  it('срок берётся из сертификата, SNI — публичный домен, соединение закрывается', async () => {
    const result = probeCertificate('https://remont.ru')
    socket.emit('secureConnect')
    expect(await result).toEqual({
      certificate: { state: 'valid', expiresAt: '2026-12-01T00:00:00.000Z' },
      fingerprint: 'first',
    })
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'remont.ru', servername: 'remont.ru', port: 443 }),
    )
    expect(checkServerIdentity).toHaveBeenCalledWith('remont.ru', socket.getPeerCertificate())
    expect(socket.destroy).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['untrusted', 'hostname', 'expired', 'future'] as const)(
    'сертификат %s недействителен',
    async (kind) => {
      if (kind === 'untrusted') socket.authorized = false
      if (kind === 'hostname')
        vi.mocked(checkServerIdentity).mockReturnValue(new Error('чужое имя'))
      if (kind === 'expired') vi.setSystemTime(new Date('2027-01-01'))
      if (kind === 'future') vi.setSystemTime(new Date('2026-01-01'))
      const result = probeCertificate('https://remont.ru')
      socket.emit('secureConnect')
      expect((await result).certificate.state).toBe('invalid')
    },
  )

  it.each(['error', 'timeout', 'close'])(
    'сбой %s оставляет срок неизвестным и закрывает сокет',
    async (kind) => {
      const result = probeCertificate('https://remont.ru')
      if (kind === 'timeout') await vi.advanceTimersByTimeAsync(15_000)
      else socket.emit(kind, new Error('сеть'))
      expect(await result).toEqual({
        certificate: { state: 'unknown', expiresAt: null },
        fingerprint: null,
      })
      expect(socket.destroy).toHaveBeenCalledTimes(1)
    },
  )

  it.each([200, 204, 301, 399, 404, 503])(
    'HTTP %i проверяется без перехода по редиректу',
    async (status) => {
      const cancel = vi.fn(async () => {})
      const fetchMock = vi.fn(async () => ({ status, body: { cancel } }))
      vi.stubGlobal('fetch', fetchMock)
      const result = probePublicHttps('https://remont.ru/')
      socket.emit('secureConnect')
      expect(await result).toMatchObject({ available: status < 400, status })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://remont.ru/',
        expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }),
      )
      expect(cancel).toHaveBeenCalledTimes(1)
    },
  )

  it('HTTP не отключает проверку доверия; отказ fetch означает недоступность', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('TLS'))
    vi.stubGlobal('fetch', fetchMock)
    socket.authorized = false
    const result = probePublicHttps('https://remont.ru/')
    socket.emit('secureConnect')
    expect(await result).toMatchObject({
      available: false,
      status: null,
      certificate: { state: 'invalid' },
    })
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('dispatcher')
  })
})
