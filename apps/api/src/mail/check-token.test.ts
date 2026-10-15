import { describe, expect, it } from 'vitest'
import { CHECK_TOKEN_TTL_MS, type CheckedSettings, createCheckTokens } from './check-token'

const settings: CheckedSettings = {
  host: 'smtp.example.ru',
  port: 465,
  security: 'tls',
  user: 'noreply@example.ru',
  password: 'smtp-secret-password',
  fromAddress: 'noreply@example.ru',
  fromName: 'Averra CMS',
}

const USER = 'user-1'

describe('итог проверки подключения', () => {
  it('подходит к тем же настройкам того же владельца и говорит, когда была проверка', async () => {
    let time = 1_000_000
    const tokens = createCheckTokens({ now: () => time })
    const token = await tokens.issue(USER, settings)
    time += 60_000
    expect(await tokens.verify(token, USER, settings)).toEqual(new Date(1_000_000))
    // Адрес отправителя в другом регистре — тот же адрес
    expect(
      await tokens.verify(token, USER, { ...settings, fromAddress: 'NoReply@Example.RU' }),
    ).toEqual(new Date(1_000_000))
  })

  it.each([
    ['хост', { host: 'smtp.other.ru' }],
    ['порт и режим', { port: 587, security: 'starttls' }],
    ['логин', { user: 'other@example.ru' }],
    ['пароль', { password: 'другой пароль' }],
    ['адрес отправителя', { fromAddress: 'other@example.ru' }],
    ['имя отправителя', { fromName: 'Другое имя' }],
  ])('другие настройки (%s) — не подходит', async (_, change) => {
    const tokens = createCheckTokens()
    const token = await tokens.issue(USER, settings)
    expect(await tokens.verify(token, USER, { ...settings, ...change })).toBeUndefined()
  })

  it('чужой владелец, устаревший, подделанный и мусор — не подходят', async () => {
    let time = 1_000_000
    const tokens = createCheckTokens({ now: () => time })
    const token = await tokens.issue(USER, settings)
    expect(await tokens.verify(token, 'user-2', settings)).toBeUndefined()

    // Другой экземпляр API (другой ключ) токен не примет
    expect(await createCheckTokens({ now: () => time }).verify(token, USER, settings)).toBe(
      undefined,
    )

    // Время в токене поменяли, подпись старая
    const [, signature] = token.split('.')
    expect(await tokens.verify(`${time + 1}.${signature}`, USER, settings)).toBeUndefined()

    for (const garbage of ['', 'x', `${time}.`, `${time}.${'A'.repeat(43)}`, `-1.${signature}`]) {
      expect(await tokens.verify(garbage, USER, settings), garbage).toBeUndefined()
    }

    time += CHECK_TOKEN_TTL_MS
    expect(await tokens.verify(token, USER, settings)).toBeUndefined()
  })

  it('токен из будущего не подходит, а пароля в токене нет', async () => {
    let time = 5_000_000
    const tokens = createCheckTokens({ now: () => time })
    const token = await tokens.issue(USER, settings)
    time -= 1000
    expect(await tokens.verify(token, USER, settings)).toBeUndefined()
    expect(token).not.toContain(settings.password)
    expect(token).not.toContain(btoa(settings.password))
  })
})
