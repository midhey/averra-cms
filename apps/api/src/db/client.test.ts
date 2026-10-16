import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config'
import { createDb, dbTargetOf } from './client'

const prodEnv = {
  NODE_ENV: 'production',
  AUTH_SECRET: 'x'.repeat(32),
  ADMIN_URL: 'https://admin.example.ru',
  API_URL: 'https://admin.example.ru',
}

describe('выбор базы по DATABASE_URL', () => {
  it('без DATABASE_URL — встроенный PGlite в PGLITE_DIR, как в разработке', () => {
    const config = parseConfig({}, { dev: true })
    expect(config.success).toBe(true)
    expect(config.data && dbTargetOf(config.data)).toEqual({
      kind: 'pglite',
      dataDir: '.data/pglite',
    })
  })

  it('с DATABASE_URL — PostgreSQL по этому адресу, PGLITE_DIR не важен', () => {
    const url = 'postgres://averra:секрет@postgres:5432/averra'
    const config = parseConfig({ ...prodEnv, DATABASE_URL: url, PGLITE_DIR: '/tmp/x' })
    expect(config.data && dbTargetOf(config.data)).toEqual({ kind: 'postgres', url })
    expect(dbTargetOf({ DATABASE_URL: 'postgresql://h/db', PGLITE_DIR: 'x' })).toEqual({
      kind: 'postgres',
      url: 'postgresql://h/db',
    })
  })

  it('не адрес Postgres — ошибка конфига, и пароль из адреса в сообщение не попадает', () => {
    for (const DATABASE_URL of ['mysql://u:p4ss-w0rd@h/db', 'http://h/db', 'postgres://', ' ']) {
      const config = parseConfig({ ...prodEnv, DATABASE_URL })
      expect(config.success).toBe(false)
      expect(config.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['DATABASE_URL'])
      expect(JSON.stringify(config.error?.issues)).not.toContain('p4ss-w0rd')
    }
  })

  it('createDb открывает PGlite по строке и в памяти, а PostgreSQL — по цели postgres', async () => {
    const memory = createDb()
    expect(memory.kind).toBe('pglite')
    await memory.close()
    // Пул node-postgres соединяется лениво: открыть и закрыть можно без сервера
    const postgres = createDb({ kind: 'postgres', url: 'postgres://u:p@127.0.0.1:1/db' })
    expect(postgres.kind).toBe('postgres')
    await postgres.close()
  })
})
