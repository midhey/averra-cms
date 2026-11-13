import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { CHECK_REQUEST_FILE, hostStatus } from '../../status/host'
import { createTestApi } from '../../testing'

const dir = await mkdtemp(join(tmpdir(), 'averra-check-update-'))
const host = hostStatus({ stateDir: dir, requestsDir: dir, disks: [] })
const api = await createTestApi({ host })
afterAll(async () => {
  await api.close()
  await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  await rm(join(dir, 'release-check.json'), { force: true })
  await rm(join(dir, CHECK_REQUEST_FILE), { force: true })
})
const check = (checkedAt: string) =>
  writeFile(
    join(dir, 'release-check.json'),
    JSON.stringify({
      checkedAt,
      current: '0.7.0',
      ok: true,
      error: null,
      adminUpdate: false,
      requestsWatched: false,
      checksWatched: true,
    }),
  )
const owner = await api.loginAs('owner')
const post = (headers: Record<string, string>) =>
  api.app.request('/api/status/check-update', { method: 'POST', headers })

describe('проверка версий из админки', () => {
  it('без хоста работает обновление сведений, участнику и токену проверка недоступна', async () => {
    expect((await post({})).status).toBe(401)
    for (const role of ['client', 'editor'] as const)
      expect((await post((await api.loginAs(role)).headers)).status).toBe(403)
    const { token } = await api.createToken()
    expect((await post({ authorization: `Bearer ${token}` })).status).toBe(403)
    const res = await post(owner.headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      requestedAt: null,
      message: expect.stringContaining('раз в сутки'),
    })
  })

  it('создаёт отдельную атомарную заявку, повтор использует ту же; после проверки действует лимит', async () => {
    await check(new Date(Date.now() - 600_000).toISOString())
    const res = await post(owner.headers)
    expect(res.status).toBe(202)
    const body = (await res.json()) as { requestedAt: string }
    expect(JSON.parse(await readFile(join(dir, CHECK_REQUEST_FILE), 'utf8'))).toEqual({
      requestedAt: body.requestedAt,
      requestedBy: owner.user.id,
    })
    expect((await host.release()).checkPending).toBe(body.requestedAt)
    const repeated = await post(owner.headers)
    expect(repeated.status).toBe(202)
    expect(((await repeated.json()) as { requestedAt: string }).requestedAt).toBe(body.requestedAt)
    await rm(join(dir, CHECK_REQUEST_FILE))
    await check(new Date().toISOString())
    const limited = await post(owner.headers)
    expect(limited.status).toBe(200)
    expect(await limited.json()).toMatchObject({
      requestedAt: null,
      message: expect.stringContaining('5 минут'),
    })
  })

  it('хост не перезаписывает существующую заявку и не создаёт файл без папки', async () => {
    const file = { requestedAt: new Date().toISOString(), requestedBy: owner.user.id }
    expect(await host.requestReleaseCheck?.(file)).toBe('written')
    expect(
      await host.requestReleaseCheck?.({ ...file, requestedAt: '2026-01-01T00:00:00.000Z' }),
    ).toBe('exists')
    expect(JSON.parse(await readFile(join(dir, CHECK_REQUEST_FILE), 'utf8'))).toEqual(file)
    expect(await hostStatus({ disks: [] }).requestReleaseCheck?.(file)).toBe('no-dir')
    await rm(join(dir, CHECK_REQUEST_FILE))
  })
})
