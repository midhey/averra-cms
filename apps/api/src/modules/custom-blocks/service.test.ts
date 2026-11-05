import { CustomBlockDraft } from '@averra/schema'
import { describe, expect, it, vi } from 'vitest'
import type { Db } from '../../db/client'

// Проверка шаблона — самая тяжёлая часть ответа «блок с замечаниями»; тот же вход не считаем заново

const counted = vi.hoisted(() => ({ calls: 0 }))
// Следующая проверка «оборвана временем»: настоящие часы в тесте не подвинуть
const timeLimited = vi.hoisted(() => ({ next: false }))
vi.mock('@averra/blocks/custom-engine', async (importOriginal) => {
  const original = await importOriginal<typeof import('@averra/blocks/custom-engine')>()
  return {
    ...original,
    customBlockProblems: (...args: Parameters<typeof original.customBlockProblems>) => {
      counted.calls++
      if (timeLimited.next && args[1]?.timeLimit) {
        args[1].timeLimit.hit = true
        timeLimited.next = false
      }
      return original.customBlockProblems(...args)
    },
  }
})

const { definitionProblems } = await import('./service')

const draft = (template: string) =>
  CustomBlockDraft.parse({
    key: 'tariffs',
    title: 'Тарифы',
    description: 'Тарифы карточками',
    fields: [{ type: 'text', name: 'title', label: 'Заголовок', required: true }],
    template,
    example: { title: 'Тарифы' },
  })

// Без картинок в определении база не нужна: список типов пуст
const db = {} as Db

describe('замечания к определению: кеш проверки', () => {
  it('одно определение — одна проверка, а замечания копией: чужая правка списка не доходит до кеша', async () => {
    const one = draft('<h2>{{ title }}</h2><script>x</script>')
    const before = counted.calls
    const first = await definitionProblems(db, 'site', one)
    const second = await definitionProblems(db, 'site', one)
    expect(counted.calls - before).toBe(1)
    expect(second).toEqual(first)
    expect(first.some((problem) => problem.level === 'error')).toBe(true)
    first.length = 0
    expect((await definitionProblems(db, 'site', one)).length).toBeGreaterThan(0)
    // Правка шаблона — новая проверка
    await definitionProblems(db, 'site', draft('<h2>{{ title }}</h2>'))
    expect(counted.calls - before).toBe(2)
  })
})

describe('замечания к определению: итог, оборванный временем, не запоминается', () => {
  it('«слишком хитро» из-за часов не закрепляется за шаблоном', async () => {
    const one = draft('<h2>{{ title }}</h2><p>время</p>')
    const before = counted.calls
    timeLimited.next = true
    await definitionProblems(db, 'site', one)
    await definitionProblems(db, 'site', one)
    // Первая проверка оборвана временем: вторая считается заново и уже запоминается
    expect(counted.calls - before).toBe(2)
    await definitionProblems(db, 'site', one)
    expect(counted.calls - before).toBe(2)
  })
})
