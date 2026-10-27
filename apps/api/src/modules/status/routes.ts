import {
  type AdminUpdateMode,
  pendingStale,
  UpdateRequestInput,
  updateActivity,
  updateBlock,
} from '@averra/schema'
import { Hono } from 'hono'
import { type AuthEnv, forbidden, requireInstallation, requireOwner } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { conflict } from '../../errors'
import { toMailLine } from '../../mail/templates/line'
import { type NotificationDeps, notifyDepsOf } from '../../notifications/deps'
import { notify } from '../../notifications/notify'
import { installationLabel } from '../../notifications/watch'
import { validate } from '../../validate'
import type { MailDeps } from '../mail/routes'
import { sitesRepo } from '../sites/repo'
import { collectStatus, type HostStatus, releaseState } from './service'

export type StatusDeps = {
  db: Db
  mail: MailDeps
  notifications: NotificationDeps
  /** Версия установки (AVERRA_VERSION) и сведения с сервера (файлы состояния, диск, заявки) */
  version: string
  host: HostStatus
  publishEnabled: boolean
  log: (message: string) => void
  /** Адреса для служебного уведомления «запрошено обновление»: ссылка и название установки */
  adminUrl: string
  siteUrl?: string | undefined
}

/** Почему обновить из админки нельзя — словами, что делать */
const unavailable: Record<Exclude<AdminUpdateMode, 'ready'>, string> = {
  'no-host':
    'Обновление из админки работает только на сервере, установленном install.sh. Обновите установку по SSH: averra.sh update --version <версия>',
  disabled:
    'Обновление из админки выключено на сервере (ADMIN_UPDATE=off): установку обновляет студия по SSH',
  'no-watcher':
    'Заявки из админки на этом сервере некому забирать (нет systemd или служба заявок выключена): установку обновляет студия по SSH',
  'no-requests':
    'У API нет папки заявок или права писать в неё: обновите установку по SSH (averra.sh update) — новая версия поставит папку сама',
}

const updateUnavailable = (message: string) => ({
  error: { code: 'update_unavailable', message },
})

/**
 * Состояние установки — только владельцу админки: версия, бэкапы, обновление, сборки, почта
 * и место на диске. Участнику и токену API (MCP) — 403: это про сервер, а не про сайт.
 * Студия получает то же самое по SSH (cli/status.ts), а не токеном по HTTPS — документация:
 * Решения → Состояние для студии — по SSH.
 *
 * «Обновить до X» — тоже здесь: API только кладёт файл-заявку, обновляет хост (averra.sh
 * update-request) — Решения → Обновление из админки
 */
export function statusRoutes({
  db,
  mail,
  notifications,
  version,
  host,
  publishEnabled,
  log,
  adminUrl,
  siteUrl,
}: StatusDeps) {
  return new Hono<AuthEnv>()
    .get('/', requireOwner('Состояние установки видит только владелец'), async (c) => {
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
    })
    .post(
      '/update',
      requireInstallation(db, 'installation.update'),
      validate('json', UpdateRequestInput),
      async (c) => {
        const { actor } = c.var
        // requireInstallation пропускает только владельца-человека; тип об этом не знает
        if (actor.kind !== 'user') return c.json(forbidden('Нужен вход владельца'), 403)
        const { version: target } = c.req.valid('json')
        const now = new Date()
        const [hostRelease, update] = await Promise.all([host.release(), host.update()])
        const release = releaseState(hostRelease, version)
        if (release.mode !== 'ready') {
          return c.json(updateUnavailable(unavailable[release.mode]), 409)
        }
        const activity = updateActivity({ update: update.last, release }, now)
        if (activity !== 'idle') {
          return c.json(
            conflict(
              activity === 'running'
                ? `Уже идёт обновление до ${update.last?.to ?? 'новой версии'}: дождитесь его итога`
                : 'Заявка на обновление уже отправлена: сервер вот-вот начнёт',
            ),
            409,
          )
        }
        const block = updateBlock({ update: update.last, release })
        if (block === 'rollback-failed') {
          return c.json(
            updateUnavailable(
              'Прошлое обновление кончилось неудачным откатом: сначала установку чинит студия, дальше она обновляет её по SSH',
            ),
            409,
          )
        }
        if (block === 'breaking') {
          return c.json(
            updateUnavailable(
              `Версия ${release.available} требует шага на сервере: её ставит студия по SSH`,
            ),
            409,
          )
        }
        if (!release.available) {
          return c.json(conflict(`Новой версии нет: установлена ${version}`), 409)
        }
        if (target !== release.available) {
          return c.json(
            conflict(
              `Доступна версия ${release.available}, а не ${target}: обновите страницу состояния`,
            ),
            409,
          )
        }
        const requestedAt = now.toISOString()
        // Прежнюю заявку хост не забрал за отведённое время: новая её заменяет
        const written = await host.requestUpdate(
          { version: target, requestedAt, requestedBy: actor.user.id },
          { replaceStale: pendingStale(release, now) },
        )
        if (written === 'exists') {
          return c.json(conflict('Заявка на обновление уже отправлена: сервер вот-вот начнёт'), 409)
        }
        if (written === 'no-dir') {
          return c.json(updateUnavailable(unavailable['no-requests']), 409)
        }
        // Кто запросил — в журнал API и студии уведомлением: заявка сама несёт только id
        log(
          `Обновление ${version} → ${target} запросил владелец ${actor.user.name} <${actor.user.email}>`,
        )
        await notifyStudio({
          db,
          mail,
          notifications,
          log,
          adminUrl,
          siteUrl,
          data: {
            from: version,
            to: target,
            by: actor.user.name,
            byEmail: actor.user.email,
            requestedAt,
          },
        })
        c.header('Cache-Control', 'no-store')
        return c.json({ version: target, requestedAt }, 202)
      },
    )
}

/**
 * Служебное уведомление «запрошено обновление» студии. Заявка уже лежит: сбой уведомления её не
 * отменяет, а только пишется в журнал
 */
async function notifyStudio({
  db,
  mail,
  notifications,
  log,
  adminUrl,
  siteUrl,
  data,
}: Omit<StatusDeps, 'version' | 'host' | 'publishEnabled'> & {
  data: { from: string; to: string; by: string; byEmail: string; requestedAt: string }
}) {
  try {
    const site = await sitesRepo(db).installationSite()
    const { queued } = await db.transaction((tx) =>
      notify(tx, notifyDepsOf(mail, notifications), {
        event: 'update.requested',
        data: {
          installation: installationLabel(site?.name ?? 'Averra', siteUrl),
          url: `${adminUrl}/status`,
          from: toMailLine(data.from, 128, '?'),
          to: data.to,
          by: toMailLine(data.by, 100, 'владелец'),
          byEmail: data.byEmail,
          requestedAt: data.requestedAt,
        },
        now: new Date(data.requestedAt),
      }),
    )
    if (queued > 0) {
      mail.wake()
      notifications.wake()
    }
  } catch (error) {
    log(`Уведомление «запрошено обновление» не поставлено: ${(error as Error).message}`)
  }
}
