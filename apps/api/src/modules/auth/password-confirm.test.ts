import { afterAll, describe, expect, it } from 'vitest'
import { CLOSED_AUTH_PATHS } from '../../auth/auth'
import { PASSWORD_CONFIRM_FAILURES } from '../../auth/confirm-password'
import { createTestApi, TEST_PASSWORD, testOrigins } from '../../testing'
import { PASSWORD_CHANGED } from './routes'

// Как вошедший проверяет свой пароль по HTTP. Путей два — повторный пароль у настроек почты
// и смена пароля, — и счётчик неудач у них один (auth/confirm-password.ts). Проверка пароля
// Better Auth (verify-password) по HTTP закрыта: через неё уведённая сессия подбирала бы пароль
// владельца мимо счётчика, с лимитом Better Auth 100 запросов за 10 секунд

const api = await createTestApi({ resetResponseMs: 0 })
afterAll(api.close)

const NEW_PASSWORD = 'new-password-456'
const { max } = PASSWORD_CONFIRM_FAILURES

let ipCounter = 0
/** Свой IP на запрос: лимиты Better Auth считаются по IP и общие на процесс */
const freshIp = () => {
  ipCounter += 1
  return `198.18.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`
}

type Headers = Record<string, string>

const post = (path: string, headers: Headers, body: unknown) =>
  api.app.request(path, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', 'x-forwarded-for': freshIp() },
    body: JSON.stringify(body),
  })

const changePassword = (headers: Headers, currentPassword: string, newPassword = NEW_PASSWORD) =>
  post('/api/auth/change-password', headers, { currentPassword, newPassword })

/**
 * Повторный пароль у настроек почты: «удалить настройки SMTP». Настроек нет, поэтому принятый
 * пароль даёт 404 «настроек нет», а не меняет почту
 */
const confirmViaMail = (headers: Headers, currentPassword: string) =>
  api.app.request('/api/mail/smtp', {
    method: 'DELETE',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword }),
  })

const signIn = (email: string, password: string) =>
  post('/api/auth/sign-in/email', { origin: testOrigins.admin }, { email, password })

const me = (headers: Headers) => api.app.request('/api/me', { headers })

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')

const WRONG = {
  error: {
    code: 'invalid_password',
    message: 'Неверный пароль',
    issues: [{ path: 'currentPassword', message: 'Неверный пароль' }],
  },
}

describe('проверка пароля Better Auth по HTTP закрыта', () => {
  it('POST /api/auth/verify-password — 404 с верным и неверным паролем, в любом написании пути', async () => {
    const { headers } = await api.loginAs('owner')
    for (const path of [
      '/api/auth/verify-password',
      '/api/auth/verify-password/',
      '/api/auth//verify-password',
      '/api/auth/Verify-Password',
      '/api/auth/verify%2Dpassword',
      '/api/auth/verify-password?x=1',
    ]) {
      for (const password of [TEST_PASSWORD, 'не тот пароль']) {
        const res = await post(path, headers, { password })
        expect(res.status, path).toBe(404)
        expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Не найдено' } })
      }
    }
    expect(CLOSED_AUTH_PATHS).toContain('/verify-password')
  })

  it('сам Better Auth его тоже не обслуживает, а серверный вызов работает', async () => {
    const { headers } = await api.loginAs('owner')
    // Мимо наших маршрутов, прямо в обработчик Better Auth: disabledPaths
    const direct = await api.auth.handler(
      new Request(`${testOrigins.api}/api/auth/verify-password`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ password: TEST_PASSWORD }),
      }),
    )
    expect(direct.status).toBe(404)
    // Подтверждение пароля в API — серверный вызов, его disabledPaths не трогает
    await expect(
      api.auth.api.verifyPassword({
        body: { password: TEST_PASSWORD },
        headers: new Headers(headers),
      }),
    ).resolves.toEqual({ status: true })
  })

  it('удаление пользователя выключено: пароль через него не проверить и аккаунт не удалить', async () => {
    const { headers } = await api.loginAs('owner')
    for (const password of ['не тот пароль', TEST_PASSWORD]) {
      const res = await post('/api/auth/delete-user', headers, { password })
      expect(res.status, password).toBe(404)
    }
    expect((await me(headers)).status).toBe(200)
  })
})

describe('смена пароля', () => {
  it('неверный текущий пароль — 403 у поля currentPassword, пароль прежний', async () => {
    const { user, headers } = await api.loginAs('owner')
    const res = await changePassword(headers, 'не тот пароль')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(WRONG)
    expect((await signIn(user.email, TEST_PASSWORD)).status).toBe(200)
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(401)
  })

  it('удачная: новый пароль работает, остальные входы завершены, этот получил новую cookie', async () => {
    const { user, headers } = await api.loginAs('editor')
    const other = await api.sessionHeaders(user.email)

    const res = await changePassword(headers, TEST_PASSWORD)
    expect(res.status).toBe(200)
    // Токена новой сессии в теле нет: он только в httpOnly-cookie
    expect(await res.json()).toEqual(PASSWORD_CHANGED)
    expect(res.headers.getSetCookie().join('\n')).toMatch(
      /better-auth\.session_token=[^;]+;.*HttpOnly/i,
    )

    expect((await me(headers)).status).toBe(401)
    expect((await me(other)).status).toBe(401)
    const fresh = { cookie: cookieOf(res), origin: testOrigins.admin }
    expect((await me(fresh)).status).toBe(200)
    expect((await signIn(user.email, TEST_PASSWORD)).status).toBe(401)
    expect((await signIn(user.email, NEW_PASSWORD)).status).toBe(200)

    // Удачная попытка счёт неудач не тратит: впереди все пять
    for (let i = 0; i < max; i++) {
      expect((await changePassword(fresh, `не тот пароль ${i}`, TEST_PASSWORD)).status).toBe(403)
    }
    expect((await changePassword(fresh, NEW_PASSWORD, TEST_PASSWORD)).status).toBe(429)
  })

  it(`${max} неудач при смене пароля — дальше 429 и у повторного пароля для почты, и наоборот`, async () => {
    const first = await api.loginAs('owner')
    for (let i = 0; i < max; i++) {
      const res = await changePassword(first.headers, `не тот пароль ${i}`)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual(WRONG)
    }
    // Верный пароль, но счётчик общий: 429 и там, и там
    const viaMail = await confirmViaMail(first.headers, TEST_PASSWORD)
    expect(viaMail.status).toBe(429)
    expect(await viaMail.json()).toMatchObject({
      error: {
        code: 'rate_limited',
        message: expect.stringContaining('неверных попыток ввести пароль'),
      },
    })
    expect((await changePassword(first.headers, TEST_PASSWORD)).status).toBe(429)
    expect((await signIn(first.user.email, TEST_PASSWORD)).status).toBe(200)

    // В обратную сторону: неудачи у настроек почты закрывают и смену пароля
    const second = await api.loginAs('owner')
    for (let i = 0; i < max; i++) {
      expect((await confirmViaMail(second.headers, `не тот пароль ${i}`)).status).toBe(403)
    }
    expect((await changePassword(second.headers, TEST_PASSWORD)).status).toBe(429)
    expect((await signIn(second.user.email, TEST_PASSWORD)).status).toBe(200)

    // Вперемешку — всё равно пять на двоих
    const third = await api.loginAs('owner')
    for (let i = 0; i < max; i++) {
      const res =
        i % 2 === 0
          ? await changePassword(third.headers, `не тот пароль ${i}`)
          : await confirmViaMail(third.headers, `не тот пароль ${i}`)
      expect(res.status).toBe(403)
    }
    expect((await confirmViaMail(third.headers, TEST_PASSWORD)).status).toBe(429)

    // Счётчик — на пользователя: у другого свой, и пароль у него принимается
    const fourth = await api.loginAs('owner')
    expect((await confirmViaMail(fourth.headers, TEST_PASSWORD)).status).toBe(404)
  })

  it('кривые пути, чужой Origin, запрос без входа и кривое тело до пароля не доходят и счёт не тратят', async () => {
    const { user, headers } = await api.loginAs('owner')
    for (const path of [
      '/api/auth/change-password/',
      '/api/auth//change-password',
      '/api/auth/Change-Password',
      '/api/auth/change%2Dpassword',
    ]) {
      const res = await post(path, headers, {
        currentPassword: 'не тот',
        newPassword: NEW_PASSWORD,
      })
      expect(res.status, path).toBe(404)
    }
    expect((await api.app.request('/api/auth/change-password', { headers })).status).toBe(404)

    const evil = await changePassword({ ...headers, origin: 'https://evil.example' }, 'не тот')
    expect(evil.status).toBe(403)
    expect(await evil.json()).toEqual({
      error: { code: 'forbidden', message: 'Запрос пришёл не из админки' },
    })
    expect((await changePassword({ cookie: headers.cookie ?? '' }, 'не тот')).status).toBe(403)

    const anonymous = await changePassword({ origin: testOrigins.admin }, TEST_PASSWORD)
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toEqual({
      error: { code: 'unauthorized', message: 'Нужно войти' },
    })

    // revokeOtherSessions обёртка ставит сама: из запроса его не принимаем
    const extra = await post('/api/auth/change-password', headers, {
      currentPassword: 'не тот',
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: false,
    })
    expect(extra.status).toBe(400)
    const short = await changePassword(headers, 'не тот', 'short')
    expect(short.status).toBe(400)
    expect(await short.json()).toMatchObject({
      error: { issues: [expect.objectContaining({ path: 'newPassword' })] },
    })

    // Ничто из этого не потратило счёт: впереди все пять неудач
    for (let i = 0; i < max; i++) {
      expect((await changePassword(headers, `не тот пароль ${i}`)).status).toBe(403)
    }
    expect((await changePassword(headers, TEST_PASSWORD)).status).toBe(429)
    expect((await signIn(user.email, TEST_PASSWORD)).status).toBe(200)
  })
})
