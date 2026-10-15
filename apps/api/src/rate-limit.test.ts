import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rate-limit'

describe('createRateLimiter', () => {
  it('пускает max запросов в окне, следующий — с временем до освобождения места', () => {
    let time = 1000
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000, now: () => time })
    for (let i = 0; i < 3; i++) {
      expect(limiter.take('a').allowed).toBe(true)
      time += 1000
    }
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterMs: 57_000 })
  })

  it('отказ не продлевает окно, а с его концом место освобождается', () => {
    let time = 0
    const limiter = createRateLimiter({ max: 1, windowMs: 10_000, now: () => time })
    expect(limiter.take('a').allowed).toBe(true)
    time = 9_999
    expect(limiter.take('a').allowed).toBe(false)
    time = 10_000
    expect(limiter.take('a').allowed).toBe(true)
  })

  it('ключи считаются отдельно', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 })
    expect(limiter.take('a').allowed).toBe(true)
    expect(limiter.take('b').allowed).toBe(true)
    expect(limiter.take('a').allowed).toBe(false)
  })
})

describe('память счётчика', () => {
  it('ключей не больше maxKeys: при нехватке места вытесняется самый давний', () => {
    let time = 0
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000, maxKeys: 3, now: () => time })
    for (const key of ['a', 'b', 'c']) {
      expect(limiter.take(key).allowed).toBe(true)
      time += 1
    }
    expect(limiter.take('a').allowed).toBe(false)
    // «a» самый давний: отказ его не освежил, и новый ключ вытесняет именно его
    expect(limiter.take('d').allowed).toBe(true)
    expect(limiter.size()).toBe(3)
    expect(limiter.take('a').allowed).toBe(true)
    expect(limiter.take('c').allowed).toBe(false)
  })

  it('ключи с прошедшим окном уходят сами, живые остаются', () => {
    let time = 0
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => time })
    limiter.take('old')
    time = 600
    limiter.take('fresh')
    time = 1000
    limiter.take('other')
    expect(limiter.size()).toBe(2)
    time = 1600
    limiter.take('other')
    expect(limiter.size()).toBe(1)
  })

  it('сто тысяч разовых ключей в одном окне: память ограничена, а запрос не дорожает', () => {
    let time = 0
    const limiter = createRateLimiter({ max: 3, windowMs: 15 * 60_000, now: () => time })
    const started = performance.now()
    for (let i = 0; i < 100_000; i++) {
      time += 1
      limiter.take(`ghost-${i}@example.test`)
    }
    // Прежняя очистка обходила всю Map на каждом запросе: здесь это были бы минуты
    expect(performance.now() - started).toBeLessThan(5000)
    expect(limiter.size()).toBe(10_000)
  })
})
