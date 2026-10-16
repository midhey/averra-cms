import { collectStatus } from '../modules/status/service'
import { diskTargets, hostStatus } from '../status/host'
import { statusLines } from '../status/lines'
import { args, openDb, queuedMailTransport, run } from './common'

const usage = `Состояние установки: версия, база, бэкапы, обновление, сборки, почта, место на диске.
  node dist/server/status.js [--json]

На сервере её зовёт deploy/averra.sh status (студия — по SSH, pnpm fleet status). --json — тот же
ответ, что GET /api/status у владельца в админке. Базу только читает: миграций не применяет.
Код выхода 0, даже если есть проблемы: их список — в ответе`

await run(async () => {
  const values = args({ json: { type: 'boolean' } }, usage)
  const { db, config, close } = await openDb({ migrate: false })
  try {
    // Почта — как её решает API (окружение, потом SMTP из админки), но без провайдера:
    // команда ничего не шлёт. База не ответила — почту не узнать, это скажет состояние базы
    const mail = await queuedMailTransport(db, config).catch(() => ({
      transport: 'off' as const,
      reason: 'Не узнать: база не отвечает',
    }))
    const status = await collectStatus(db, {
      version: config.AVERRA_VERSION,
      host: hostStatus({ stateDir: config.STATE_DIR, disks: diskTargets(config) }),
      publishEnabled: config.PUBLISH_DIR !== undefined,
      mail:
        mail.transport === 'off'
          ? { enabled: false, reason: mail.reason }
          : { enabled: true, reason: null },
    })
    console.log(values.json ? JSON.stringify(status) : statusLines(status).join('\n'))
  } finally {
    await close()
  }
})
