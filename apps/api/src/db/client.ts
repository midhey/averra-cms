import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite'
import pg from 'pg'

/**
 * Какая база: встроенный PGlite (разработка, тесты, команды на машине разработчика) или настоящий
 * PostgreSQL по DATABASE_URL (сервер). Миграции и код запросов у обоих одни
 */
export type DbTarget =
  | { kind: 'pglite' /** Без папки база живёт в памяти — так удобно в тестах */; dataDir?: string }
  | { kind: 'postgres'; url: string /** Сколько соединений держит пул */; maxConnections?: number }

/**
 * Выбор базы по окружению: DATABASE_URL задан — PostgreSQL, иначе PGlite в PGLITE_DIR.
 * Отдельно от config.ts и index.ts, чтобы проверить тестом
 */
export function dbTargetOf(env: { DATABASE_URL?: string; PGLITE_DIR: string }): DbTarget {
  return env.DATABASE_URL
    ? { kind: 'postgres', url: env.DATABASE_URL }
    : { kind: 'pglite', dataDir: env.PGLITE_DIR }
}

/**
 * Пул небольшой: на VPS с 1–2 ГБ у Postgres по умолчанию 100 соединений, а API — один процесс,
 * которому хватает нескольких (запросы короткие, обработчик очереди берёт одно)
 */
const DEFAULT_POOL_SIZE = 5

/**
 * Открывает базу. Строка или ничего — PGlite в папке или в памяти (как раньше: тесты и команды
 * зовут createDb() и createDb(dir)).
 *
 * Тип у обеих баз один — PgliteDatabase. У драйвера node-postgres тот же PgDatabase с тем же
 * диалектом, а единственное, что у драйверов расходится в коде, — ответ db.execute: и PGlite,
 * и node-postgres отдают { rows }. Поэтому выбран node-postgres, а не postgres.js (тот отдаёт
 * массив строк). Совпадение держит интеграционный тест API на настоящем драйвере
 * (db/postgres.test.ts, сервер протокола Postgres поверх PGlite)
 */
export function createDb(target?: DbTarget | string) {
  const resolved: DbTarget =
    typeof target === 'object' ? target : { kind: 'pglite', dataDir: target }
  if (resolved.kind === 'postgres') {
    const pool = new pg.Pool({
      connectionString: resolved.url,
      max: resolved.maxConnections ?? DEFAULT_POOL_SIZE,
    })
    // Упавшее простаивающее соединение (перезапуск Postgres) не должно ронять процесс:
    // пул выбросит его и откроет новое при следующем запросе
    pool.on('error', (error) => console.error(`Соединение с базой оборвалось: ${error.message}`))
    const db = drizzlePg({ client: pool, casing: 'snake_case' })
    return {
      db: db as unknown as PgliteDb,
      kind: 'postgres' as const,
      close: () => pool.end(),
    }
  }
  const client = new PGlite(resolved.dataDir)
  return {
    db: drizzlePglite({ client, casing: 'snake_case' }),
    kind: 'pglite' as const,
    close: () => client.close(),
  }
}

// $client у базы на node-postgres — пул pg, а не PGlite; код его не трогает
type PgliteDb = PgliteDatabase & { $client: PGlite }

export type Db = PgliteDb
