import { MailAddress } from '@averra/schema'
import { z } from 'zod'
import { loadConfig } from '../config'
import { sendTestMail } from '../mail/send-test-mail'
import { args, CliError, check, run } from './common'

const usage = 'Как запустить: pnpm mail:test --to anna@example.ru'

// Письмо уходит напрямую, без очереди и базы: команда работает и при запущенном pnpm dev
await run(async () => {
  const { to } = check(
    z.object({ to: MailAddress }),
    args({ to: { type: 'string' } }, usage),
    usage,
  )
  // Как у остальных команд: сеть команда не слушает, поэтому учебный режим ей не опасен.
  // На своём компьютере без SMTP_* письмо ляжет в файловый ящик, на сервере уйдёт по SMTP
  const config = loadConfig({ dev: true })
  const sent = await sendTestMail(config.mail, to, (line) => console.log(line))
  if (!sent) throw new CliError('Проверочное письмо не отправлено')
})
