import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type tls from 'node:tls'
import pg from 'pg'
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

describe('внешняя база (install.sh --external-db): адрес из .env доходит до драйвера как есть', () => {
  // Пароль со знаками, которые ломают адреса: в адресе — percent-encoded, $ — как есть
  const password = 'p@ss:w/r#d?%$HOME1'
  const url = (params: string) =>
    `postgres://averra_app:p%40ss%3Aw%2Fr%23d%3F%25$HOME1@db.example.test:6432/averra_site?${params}`
  /** Настройки соединения так, как их соберёт пул pg из DATABASE_URL */
  const settings = (connectionString: string) => {
    const client = new pg.Client({ connectionString })
    return client as unknown as {
      user: string
      password: string
      host: string
      port: number
      database: string
      ssl: false | (tls.ConnectionOptions & Record<string, unknown>)
    }
  }

  it('sslmode=verify-full — TLS с проверкой сертификата и имени, пароль раскодирован', () => {
    const client = settings(url('sslmode=verify-full'))
    expect(client).toMatchObject({
      user: 'averra_app',
      password,
      host: 'db.example.test',
      port: 6432,
      database: 'averra_site',
    })
    expect(client.ssl).toBeTypeOf('object')
    const ssl = client.ssl as tls.ConnectionOptions
    // Проверка не выключена: Node сверяет цепочку с корнями и имя хоста с сертификатом
    expect(ssl.rejectUnauthorized).not.toBe(false)
    expect(ssl.checkServerIdentity).toBeUndefined()
  })

  it('sslrootcert — CA провайдера читается из файла (папка db-tls в контейнере)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'averra-ca-'))
    try {
      const ca = join(dir, 'ca.pem')
      writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n')
      const client = settings(url(`sslmode=verify-full&sslrootcert=${ca}`))
      const ssl = client.ssl as tls.ConnectionOptions
      expect(ssl.ca).toBe(readFileSync(ca, 'utf8'))
      expect(ssl.rejectUnauthorized).not.toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('DATABASE_EXTERNAL из compose.external.yaml — признак для «Состояния», по умолчанию нет', () => {
    const external = parseConfig({
      ...prodEnv,
      DATABASE_URL: url('sslmode=verify-full'),
      DATABASE_EXTERNAL: 'true',
    })
    expect(external.data?.DATABASE_EXTERNAL).toBe(true)
    expect(external.data?.DATABASE_URL).toBe(url('sslmode=verify-full'))
    expect(parseConfig(prodEnv).data?.DATABASE_EXTERNAL).toBe(false)
  })
})
