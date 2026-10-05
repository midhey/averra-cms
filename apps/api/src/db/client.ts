import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'

/** Без dataDir база живёт в памяти — так удобно в тестах */
export function createDb(dataDir?: string) {
  const client = new PGlite(dataDir)
  return {
    db: drizzle({ client }),
    close: () => client.close(),
  }
}

export type Db = ReturnType<typeof createDb>['db']
