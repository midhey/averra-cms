import { describe, expect, it } from 'vitest'
import { authorLabel, restoredMessage, restoreQuestion, revisionLabel } from './history-format'

const revision = { version: 3, publishedAt: '2026-10-12T07:30:00.000Z' }

describe('подписи истории', () => {
  it('автор: человек по имени, токен по названию, без автора — так и пишем', () => {
    expect(authorLabel({ kind: 'user', name: 'Анна' })).toBe('Анна')
    expect(authorLabel({ kind: 'token', name: 'mcp' })).toBe('токен «mcp»')
    expect(authorLabel(null)).toBe('автор неизвестен')
  })

  it('версия с номером и временем публикации в поясе человека', () => {
    const label = revisionLabel(revision, 'Europe/Moscow')
    expect(label).toMatch(/^Версия 3 от /)
    expect(label).toContain('2026')
    expect(label).toContain('10:30')
  })

  it('вопрос перед возвратом называет версию и предупреждает о потере правок', () => {
    const question = restoreQuestion(revision, 'Europe/Moscow')
    expect(question).toContain('несохранённые правки')
    expect(question).toContain('версией 3')
    expect(question).toContain('10:30')
  })

  it('после возврата говорит, кто выложит версию на сайт', () => {
    expect(restoredMessage(revision, true)).toBe(
      'Версия 3 возвращена в черновик. На сайт она попадёт после публикации',
    )
    expect(restoredMessage(revision, false)).toContain('владелец или редактор')
  })
})
