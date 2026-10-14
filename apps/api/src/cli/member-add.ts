import { Uuid } from '@averra/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { sites } from '../db/schema'
import { MemberRole, UserEmail, usersRepo } from '../modules/users/repo'
import { args, CliError, check, openDb, run } from './common'

const usage = `Дать участнику доступ к сайту:
  pnpm member:add --email anna@example.ru --site <id сайта> --role editor|client

editor — правит и публикует; client — только правит черновики. Повторный вызов меняет роль.`

const Args = z.object({ email: UserEmail, site: Uuid('Нужен id сайта'), role: MemberRole })

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
    if (user.role === 'owner') throw new CliError(`${email} — владелец, ему открыты все сайты`)
    const [found] = await db.select({ name: sites.name }).from(sites).where(eq(sites.id, site))
    if (!found) throw new CliError(`Нет сайта ${site}`)
    await users.addMember(site, user.id, role)
    console.log(`${user.name} <${email}> — ${role} на сайте «${found.name}»`)
  } finally {
    await close()
  }
})
