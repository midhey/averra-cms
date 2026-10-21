import { Uuid } from '@averra/schema'
import { z } from 'zod'
import { MemberRole, UserEmail, usersRepo } from '../modules/users/repo'
import { args, CliError, check, openDb, resolveSite, run } from './common'

const usage = `Дать участнику доступ к сайту установки:
  pnpm member:add --email anna@example.ru --role editor|client [--site <id сайта>]

editor — правит и публикует; client — только правит черновики. Повторный вызов меняет роль.
--site не нужен: в установке один сайт. Он только для старых баз, где сайтов несколько.`

const Args = z.object({
  email: UserEmail,
  site: Uuid('Нужен id сайта').optional(),
  role: MemberRole,
})

await run(async () => {
  const { email, site, role } = check(
    Args,
    args({ email: { type: 'string' }, site: { type: 'string' }, role: { type: 'string' } }, usage),
    usage,
  )
  const { db, auth, close } = await openDb()
  try {
    const users = usersRepo(db, auth)
    const user = await users.findByEmail(email)
    if (!user) {
      throw new CliError(`Нет пользователя ${email}. Создай: pnpm user:create --role member …`)
    }
    if (user.role === 'owner') throw new CliError(`${email} — владелец, ему и так открыт сайт`)
    const found = await resolveSite(db, site)
    await users.addMember(found.id, user.id, role)
    console.log(`${user.name} <${email}> — ${role} на сайте «${found.name}»`)
  } finally {
    await close()
  }
})
