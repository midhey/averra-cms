import { tokensRepo } from '../modules/tokens/repo'
import { usersRepo } from '../modules/users/repo'
import { CliError, openDb, resolveSite, run } from './common'
import { parseTokenCreate, tokenCreateUsage } from './token-args'

await run(async () => {
  const { site, name, by, blocksDraft } = parseTokenCreate()
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
      blocksDraft,
    })
    console.log(`Токен «${name}» для сайта «${found.name}», id токена ${id}.`)
    console.log('Он показывается один раз: в базе остаётся только его хеш.')
    if (blocksDraft) console.log('Право на черновики своих блоков: включено.')
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
  if (owners.length > 1)
    throw new CliError(`Владельцев несколько: укажи --by <почта>\n\n${tokenCreateUsage}`)
  return owners[0]
}
