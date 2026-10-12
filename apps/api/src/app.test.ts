import { afterAll, describe, expect, it } from 'vitest'
import { createTestApi } from './testing'

const { app, close, loginAs } = await createTestApi()
const owner = await loginAs('owner')

afterAll(close)

describe('health', () => {
  it('отвечает без входа, что API живо', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('видит базу без входа', async () => {
    const res = await app.request('/api/health/ready')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', db: 'up' })
  })

  it('на неизвестный адрес отвечает 404 в едином формате ошибок', async () => {
    const res = await app.request('/api/nope', { headers: owner.headers })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })

  it('без входа не выдаёт даже, есть ли такой маршрут', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(401)
  })
})
