import { isIP } from 'node:net'
import { checkServerIdentity, connect } from 'node:tls'
import { isLoopbackHost } from '../loopback'
import type { PublicProbe, PublicReading, PublicTarget } from './public-watch'

const TIMEOUT_MS = 15_000

/** Адреса задаёт окружение установки, а не пользовательский ввод или редирект сайта */
export function publicTargets(config: {
  NODE_ENV: string
  SITE_URL?: string | undefined
  ADMIN_URL: string
}): PublicTarget[] {
  if (config.NODE_ENV !== 'production' || !config.SITE_URL) return []
  const site = new URL(config.SITE_URL)
  const admin = new URL(config.ADMIN_URL)
  if ([site, admin].some((url) => url.protocol !== 'https:' || isLoopbackHost(url.hostname)))
    return []
  return [
    { target: 'site', url: new URL('/', site).href },
    { target: 'admin', url: new URL('/api/health', admin).href },
  ]
}

/** TLS без HTTP и без передачи данных: читаем сертификат даже у просроченного сервера */
export function probeCertificate(
  url: string,
): Promise<Pick<PublicReading, 'certificate' | 'fingerprint'>> {
  const { hostname, port } = new URL(url)
  const host = hostname.replace(/^\[|\]$/g, '')
  return new Promise((resolve) => {
    let finished = false
    const socket = connect({
      host,
      port: port ? Number(port) : 443,
      ...(isIP(host) ? {} : { servername: host }),
      // Только диагностическое соединение: HTTP ниже всегда проверяет доверие обычным fetch.
      // authorized и имя проверяем явно: иначе self-signed и чужой домен выглядели бы здоровыми.
      rejectUnauthorized: false,
    })
    const timer = setTimeout(() => done({ state: 'unknown', expiresAt: null }, null), TIMEOUT_MS)
    function done(certificate: PublicReading['certificate'], fingerprint: string | null) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket.destroy()
      resolve({ certificate, fingerprint })
    }
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate()
      const expires = Date.parse(cert.valid_to)
      const starts = Date.parse(cert.valid_from)
      const valid =
        socket.authorized &&
        !checkServerIdentity(host, cert) &&
        Number.isFinite(expires) &&
        Number.isFinite(starts) &&
        starts <= Date.now() &&
        expires > Date.now()
      done(
        {
          state: valid ? 'valid' : 'invalid',
          expiresAt: Number.isFinite(expires) ? new Date(expires).toISOString() : null,
        },
        cert.fingerprint256 ?? null,
      )
    })
    socket.once('error', () => done({ state: 'unknown', expiresAt: null }, null))
    socket.once('close', () => done({ state: 'unknown', expiresAt: null }, null))
  })
}

export const probePublicHttps: PublicProbe = async (url) => {
  const [http, tls] = await Promise.all([
    (async () => {
      try {
        const response = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        await response.body?.cancel()
        return {
          available: response.status >= 200 && response.status < 400,
          status: response.status,
        }
      } catch {
        return { available: false, status: null }
      }
    })(),
    probeCertificate(url),
  ])
  return { ...http, ...tls }
}
