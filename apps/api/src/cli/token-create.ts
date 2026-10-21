import { Uuid } from '@averra/schema'
import { z } from 'zod'
import { tokensRepo } from '../modules/tokens/repo'
import { UserEmail, usersRepo } from '../modules/users/repo'
import { args, CliError, check, openDb, resolveSite, run } from './common'

const usage = `Выпустить токен API (права редактора на сайте установки), например для MCP:
  pnpm token:create --name mcp [--by <почта владельца>] [--site <id сайта>]

Токен показывается один раз. --by нужен, только если владельцев несколько. --site не нужен:
в установке один сайт. Он только для старых баз, где сайтов несколько.`

const Args = z.object({
  site: Uuid('Нужен id сайта').optional(),
  name: z.string().trim().min(1).max(80),
  by: UserEmail.optional(),
})

await run(async () => {
  const { site, name, by } = check(
    Args,
    args({ site: { type: 'string' }, name: { type: 'string' }, by: { type: 'string' } }, usage),
    usage,
  )
  const { db, auth, close } = await openDb()
  try {
    const found = await resolveSite(db, site)

    const users = usersRepo(db, auth)
    const author = by ? await users.findByEmail(by) : await soleOwner(users)
    if (!author) throw new CliError(`Нет пользователя ${by}`)

    const { id, token } = await tokensRepo(db).create({
      siteId: found.id,
      name,
      createdBy: author.id,
    })
    console.log(`Токен «${name}» для сайта «${found.name}», id токена ${id}.`)
    console.log('Он показывается один раз: в базе остаётся только его хеш.')
    console.log('Для MCP положи эту строку в apps/mcp/.env:\n')
    console.log(`CMS_API_TOKEN=${token}\n`)
    console.log(`Отозвать: pnpm token:revoke --id ${id}`)
  } finally {
    await close()
  }
})

/** Кто выпускает токен, если --by не указан: единственный владелец */
async function soleOwner(users: ReturnType<typeof usersRepo>) {
  const owners = await users.owners()
  if (owners.length === 0) throw new CliError('Сначала создай владельца: pnpm user:create')
  if (owners.length > 1) throw new CliError(`Владельцев несколько: укажи --by <почта>\n\n${usage}`)
  return owners[0]
}
