import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { MemberRole, NewUser } from '../modules/users/repo'
import { check, run } from './common'

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

/** Что команда напечатала бы человеку, если main упадёт */
async function printed(main: () => Promise<void>) {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await run(main)
  expect(process.exitCode).toBe(1)
  return String(error.mock.calls[0]?.[0])
}

describe('команды терминала', () => {
  it('ошибки аргументов пишут по-русски: и свои сообщения схем, и стандартные Zod', async () => {
    const text = await printed(async () => {
      check(
        NewUser.omit({ password: true }),
        { email: 'anna@example.ru', name: '', role: 'admin' },
        'Как вызывать',
      )
    })
    expect(text).toContain('Поле не может быть пустым')
    expect(text).toContain('Роль — owner или member')
    expect(text).toContain('Как вызывать')
    expect(text).not.toMatch(/Too small|Invalid option/)
  })

  it('неверная роль участника — понятными словами', async () => {
    const text = await printed(async () => {
      check(z.object({ role: MemberRole }), { role: 'owner' }, '')
    })
    expect(text).toContain('Роль на сайте — editor или client')
  })
})
