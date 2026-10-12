import { describe, expect, it } from 'vitest'
import { DEV_AUTH_SECRET, parseConfig } from './config'

const prodEnv = {
  NODE_ENV: 'production',
  AUTH_SECRET: 'x'.repeat(32),
  ADMIN_URL: 'https://admin.example.ru',
  API_URL: 'https://api.example.ru',
}

const issuePaths = (env: Record<string, string>) =>
  parseConfig(env).error?.issues.map((issue) => issue.path.join('.'))

describe('конфиг', () => {
  it('в разработке работает без .env: учебный секрет и адреса localhost', () => {
    const config = parseConfig({}).data
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      AUTH_SECRET: DEV_AUTH_SECRET,
      ADMIN_URL: 'http://localhost:5173',
      API_URL: 'http://localhost:4000',
      TRUST_PROXY: false,
      secureCookies: false,
      devOwner: undefined,
    })
  })

  it('адрес API по умолчанию следует за PORT', () => {
    expect(parseConfig({ PORT: '4100' }).data?.API_URL).toBe('http://localhost:4100')
  })

  it('в проде без секрета и адресов не стартует', () => {
    expect(issuePaths({ NODE_ENV: 'production' })).toEqual(['AUTH_SECRET', 'ADMIN_URL', 'API_URL'])
  })

  it('в проде cookie только Secure, а владельца для разработки нет даже при DEV_OWNER_*', () => {
    const config = parseConfig({
      ...prodEnv,
      DEV_OWNER_EMAIL: 'dev@example.test',
      DEV_OWNER_PASSWORD: 'dev-password-1',
    }).data
    expect(config?.secureCookies).toBe(true)
    expect(config?.devOwner).toBeUndefined()
  })

  it('короткий секрет не пройдёт', () => {
    expect(issuePaths({ ...prodEnv, AUTH_SECRET: 'short' })).toEqual(['AUTH_SECRET'])
  })

  it('адрес админки — только origin, без пути: с ним сравнивается заголовок Origin', () => {
    expect(issuePaths({ ADMIN_URL: 'http://localhost:5173/' })).toEqual(['ADMIN_URL'])
    expect(issuePaths({ ADMIN_URL: 'http://localhost:5173/admin' })).toEqual(['ADMIN_URL'])
    expect(issuePaths({ ADMIN_URL: 'ftp://localhost' })).toEqual(['ADMIN_URL'])
    expect(parseConfig({ ADMIN_URL: 'http://localhost:5273' }).success).toBe(true)
  })

  it('владелец для разработки — только парой почта + пароль и только в development', () => {
    expect(issuePaths({ DEV_OWNER_EMAIL: 'dev@example.test' })).toEqual(['DEV_OWNER_PASSWORD'])
    expect(issuePaths({ DEV_OWNER_PASSWORD: 'dev-password-1' })).toEqual(['DEV_OWNER_PASSWORD'])
    const pair = { DEV_OWNER_EMAIL: 'dev@example.test', DEV_OWNER_PASSWORD: 'dev-password-1' }
    expect(parseConfig(pair).data?.devOwner).toEqual({
      email: 'dev@example.test',
      password: 'dev-password-1',
    })
    expect(parseConfig({ ...pair, NODE_ENV: 'test' }).data?.devOwner).toBeUndefined()
  })

  it('TRUST_PROXY понимает true/false', () => {
    expect(parseConfig({ TRUST_PROXY: 'true' }).data?.TRUST_PROXY).toBe(true)
    expect(parseConfig({ TRUST_PROXY: 'false' }).data?.TRUST_PROXY).toBe(false)
    expect(issuePaths({ TRUST_PROXY: 'maybe' })).toEqual(['TRUST_PROXY'])
  })
})
