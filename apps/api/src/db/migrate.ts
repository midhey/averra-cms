import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { Db } from './client'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

/** Применяет миграции из apps/api/drizzle. Новые генерирует команда pnpm db:generate */
export function migrateDb(db: Db) {
  return migrate(db, { migrationsFolder })
}
