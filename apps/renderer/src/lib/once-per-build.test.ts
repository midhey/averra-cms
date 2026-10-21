import { describe, expect, it } from 'vitest'
import { oncePerBuild } from './once-per-build'

// Снимок сайта при сборке — один на все маршруты, в dev — свежий на каждый запрос

describe('oncePerBuild', () => {
  it('при сборке загружает один раз, даже если маршруты спрашивают одновременно', async () => {
    let calls = 0
    const load = oncePerBuild(async () => ({ version: ++calls }), false)
    const [a, b] = await Promise.all([load(), load()])
    const c = await load()
    expect(calls).toBe(1)
    expect([a, b, c]).toEqual([{ version: 1 }, { version: 1 }, { version: 1 }])
  })

  it('в dev — каждый раз заново: опубликованное видно после обновления страницы', async () => {
    let calls = 0
    const load = oncePerBuild(async () => ++calls, true)
    expect([await load(), await load()]).toEqual([1, 2])
  })
})
