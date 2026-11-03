import { openDb, run } from './common'
import { grantRights, parseTokenGrant } from './token-args'

await run(async () => {
  const { id, rights } = parseTokenGrant()
  const { db, close } = await openDb()
  try {
    console.log(await grantRights(db, id, rights))
  } finally {
    await close()
  }
})
