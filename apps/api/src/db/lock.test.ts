import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DbLockedError, lockDb } from './lock'

let dir: string
let dataDir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cms-lock-'))
  dataDir = join(dir, 'pglite')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** pid процесса, которого уже нет: запускаем короткий процесс и ждём его выхода */
function deadPid() {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'])
  return Number(child.stdout.toString())
}

describe('замок базы', () => {
  it('лежит рядом с папкой базы, хранит pid и снимается при отпускании', async () => {
    const unlock = await lockDb(dataDir)
    expect(readFileSync(`${dataDir}.lock`, 'utf8')).toBe(String(process.pid))
    unlock()
    expect(existsSync(`${dataDir}.lock`)).toBe(false)
  })

  it('не отдаётся второму, пока жив владелец', async () => {
    // Живой чужой процесс — родитель тестового воркера
    writeFileSync(`${dataDir}.lock`, String(process.ppid))
    const error = await lockDb(dataDir).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DbLockedError)
    expect((error as DbLockedError).pid).toBe(process.ppid)
    expect(readFileSync(`${dataDir}.lock`, 'utf8')).toBe(String(process.ppid))
  })

  it('ждёт живого владельца не дольше waitMs', async () => {
    writeFileSync(`${dataDir}.lock`, String(process.ppid))
    const started = Date.now()
    await expect(lockDb(dataDir, { waitMs: 400 })).rejects.toBeInstanceOf(DbLockedError)
    expect(Date.now() - started).toBeGreaterThanOrEqual(400)
  })

  it('замок упавшего процесса забирает', async () => {
    writeFileSync(`${dataDir}.lock`, String(deadPid()))
    const unlock = await lockDb(dataDir)
    expect(readFileSync(`${dataDir}.lock`, 'utf8')).toBe(String(process.pid))
    unlock()
  })

  it('отпуская, не трогает замок, который уже чужой', async () => {
    const unlock = await lockDb(dataDir)
    writeFileSync(`${dataDir}.lock`, String(process.ppid))
    unlock()
    expect(readFileSync(`${dataDir}.lock`, 'utf8')).toBe(String(process.ppid))
  })
})
