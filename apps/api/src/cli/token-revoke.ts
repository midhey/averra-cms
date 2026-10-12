import { Uuid } from '@cms/schema'
import { z } from 'zod'
import { tokensRepo } from '../modules/tokens/repo'
import { args, CliError, check, openDb, run } from './common'

const usage = `Отозвать токен API:
  pnpm token:revoke --id <id токена>

id видно в выводе pnpm token:create и pnpm token:list.`

await run(async () => {
  const { id } = check(
    z.object({ id: Uuid('Нужен id токена') }),
    args({ id: { type: 'string' } }, usage),
    usage,
  )
  const { db, close } = await openDb()
  try {
    if (!(await tokensRepo(db).revoke(id))) throw new CliError(`Нет токена ${id}`)
    console.log(`Токен ${id} отозван: API его больше не примет`)
  } finally {
    await close()
  }
})
