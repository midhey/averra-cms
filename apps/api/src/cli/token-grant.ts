import { openDb, run } from './common'
import { grantBlocksDraft, parseTokenGrant } from './token-args'

await run(async () => {
  const { id, allowed } = parseTokenGrant()
  const { db, close } = await openDb()
  try {
    console.log(await grantBlocksDraft(db, id, allowed))
  } finally {
    await close()
  }
})
