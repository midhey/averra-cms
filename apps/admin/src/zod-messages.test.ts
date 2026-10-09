import { features, hero } from '@cms/schema'
import { describe, expect, it } from 'vitest'
import { setupZodMessages } from './zod-messages'

setupZodMessages()

const messages = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message)

describe('сообщения об ошибках', () => {
  it('говорят по-человечески про пустые и слишком длинные поля', () => {
    expect(messages(hero.props.safeParse({ title: '' }))).toEqual(['Поле не может быть пустым'])
    expect(messages(hero.props.safeParse({ title: 'а'.repeat(121) }))).toEqual([
      'Не больше 120 символов',
    ])
  })

  it('объясняют ограничения списков', () => {
    expect(messages(features.props.safeParse({ items: [] }))).toEqual(['Минимум элементов: 1'])
  })
})
