import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { createDb } from './db/client'

const { db, close } = createDb()
const app = createApp({ db, log: () => {} })

afterAll(close)

describe('health', () => {
  it('отвечает, что API живо', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('видит базу', async () => {
    const res = await app.request('/api/health/ready')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', db: 'up' })
  })

  it('отдаёт 404 в едином формате ошибок', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })
})
