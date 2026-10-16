import { Hono } from 'hono'
import { type AuthEnv, requireOwner } from '../../auth/middleware'
import type { Db } from '../../db/client'
import type { MailDeps } from '../mail/routes'
import { collectStatus, type HostStatus } from './service'

export type StatusDeps = {
  db: Db
  mail: MailDeps
  /** Версия установки (AVERRA_VERSION) и сведения с сервера (файлы состояния, диск) */
  version: string
  host: HostStatus
  publishEnabled: boolean
}

/**
 * Состояние установки — только владельцу админки: версия, бэкапы, обновление, сборки, почта
 * и место на диске. Участнику и токену API (MCP) — 403: это про сервер, а не про сайт.
 * Студия получает то же самое по SSH (cli/status.ts), а не токеном по HTTPS — см. шаг 3.7
 */
export function statusRoutes({ db, mail, version, host, publishEnabled }: StatusDeps) {
  return new Hono<AuthEnv>().get(
    '/',
    requireOwner('Состояние установки видит только владелец'),
    async (c) => {
      const state = mail.runtime.status()
      const status = await collectStatus(db, {
        version,
        host,
        publishEnabled,
        mail: state.enabled ? { enabled: true, reason: null } : state,
      })
      // Состояние меняется (бэкап, сборка), а в нём ничего, что стоит держать в чужом кеше
      c.header('Cache-Control', 'no-store')
      return c.json(status)
    },
  )
}
