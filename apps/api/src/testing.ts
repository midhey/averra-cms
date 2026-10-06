import { createApp } from './app'
import { createDb } from './db/client'
import { migrateDb } from './db/migrate'
import { seedDemo } from './db/seed'

/** API на базе в памяти с демо-сайтом — для тестов, в том числе других пакетов */
export async function createTestApi() {
  const { db, close } = createDb()
  await migrateDb(db)
  await seedDemo(db)
  return { app: createApp({ db, log: () => {} }), close }
}
