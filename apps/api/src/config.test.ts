import { describe, expect, it } from 'vitest'
import { type ConfigOptions, DEV_AUTH_SECRET, parseConfig } from './config'

const prodEnv = {
  NODE_ENV: 'production',
  AUTH_SECRET: 'x'.repeat(32),
  ADMIN_URL: 'https://admin.example.ru',
  API_URL: 'https://api.example.ru',
}

/** Учебный режим, как у pnpm dev: флаг --dev */
const dev = { dev: true }

const issuePaths = (env: Record<string, string>, options: ConfigOptions = dev) =>
  parseConfig(env, options).error?.issues.map((issue) => issue.path.join('.'))

describe('конфиг', () => {
  it('в разработке работает без .env: учебный секрет и адреса localhost', () => {
    const config = parseConfig({}, dev).data
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      AUTH_SECRET: DEV_AUTH_SECRET,
      ADMIN_URL: 'http://localhost:5173',
      API_URL: 'http://localhost:4000',
      TRUST_PROXY: false,
      secureCookies: false,
      loopbackOnly: true,
      devOwner: undefined,
    })
  })

  it('медиатека по умолчанию — папка .data/media и файлы до 10 МБ, оба значения настраиваются', () => {
    expect(parseConfig({}, dev).data).toMatchObject({
      MEDIA_DIR: '.data/media',
      MEDIA_MAX_BYTES: 10 * 1024 * 1024,
    })
    expect(parseConfig({ MEDIA_MAX_BYTES: '2048' }, dev).data?.MEDIA_MAX_BYTES).toBe(2048)
    expect(issuePaths({ MEDIA_MAX_BYTES: '0' })).toEqual(['MEDIA_MAX_BYTES'])
  })

  it('адрес API по умолчанию следует за PORT', () => {
    expect(parseConfig({ PORT: '4100' }, dev).data?.API_URL).toBe('http://localhost:4100')
  })

  it('в проде без секрета и адресов не стартует', () => {
    expect(issuePaths({ NODE_ENV: 'production' })).toEqual(['AUTH_SECRET', 'ADMIN_URL', 'API_URL'])
  })

  it('в проде cookie только Secure, а владельца для разработки нет даже при DEV_OWNER_*', () => {
    const config = parseConfig(
      {
        ...prodEnv,
        DEV_OWNER_EMAIL: 'dev@example.test',
        DEV_OWNER_PASSWORD: 'dev-password-1',
      },
      dev,
    ).data
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
    expect(parseConfig({ ADMIN_URL: 'http://localhost:5273' }, dev).success).toBe(true)
  })

  it('владелец для разработки — только парой почта + пароль и только в development', () => {
    expect(issuePaths({ DEV_OWNER_EMAIL: 'dev@example.test' })).toEqual(['DEV_OWNER_PASSWORD'])
    expect(issuePaths({ DEV_OWNER_PASSWORD: 'dev-password-1' })).toEqual(['DEV_OWNER_PASSWORD'])
    const pair = { DEV_OWNER_EMAIL: 'dev@example.test', DEV_OWNER_PASSWORD: 'dev-password-1' }
    expect(parseConfig(pair, dev).data?.devOwner).toEqual({
      email: 'dev@example.test',
      password: 'dev-password-1',
    })
    expect(parseConfig({ ...pair, NODE_ENV: 'test' }, dev).data?.devOwner).toBeUndefined()
  })

  describe('учебный секрет — только для разработки на этом компьютере', () => {
    const remote = { ADMIN_URL: 'https://admin.example.ru', API_URL: 'https://api.example.ru' }

    it('забыли NODE_ENV=production на сервере: без своего AUTH_SECRET не стартует', () => {
      const result = parseConfig(remote, dev)
      expect(result.success).toBe(false)
      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ['AUTH_SECRET'],
          message: expect.stringMatching(/свой AUTH_SECRET/),
        }),
      ])
    })

    it('хватает одного адреса не на localhost', () => {
      expect(issuePaths({ ADMIN_URL: 'https://admin.example.ru' })).toEqual(['AUTH_SECRET'])
      expect(issuePaths({ API_URL: 'http://192.168.1.10:4000' })).toEqual(['AUTH_SECRET'])
      expect(issuePaths({ NODE_ENV: 'test', ...remote })).toEqual(['AUTH_SECRET'])
    })

    it('учебный секрет, вписанный руками, вне localhost не пройдёт — и в проде тоже', () => {
      expect(issuePaths({ ...remote, AUTH_SECRET: DEV_AUTH_SECRET })).toEqual(['AUTH_SECRET'])
      expect(issuePaths({ ...prodEnv, AUTH_SECRET: DEV_AUTH_SECRET })).toEqual(['AUTH_SECRET'])
    })

    it('localhost, *.localhost, 127.x и [::1] — этот компьютер', () => {
      for (const host of ['localhost', 'admin.localhost', '127.0.0.1', '127.1.2.3', '[::1]']) {
        const config = parseConfig(
          {
            ADMIN_URL: `http://${host}:5173`,
            API_URL: `http://${host}:4000`,
          },
          dev,
        )
        expect(config.data?.AUTH_SECRET).toBe(DEV_AUTH_SECRET)
      }
      // Похожие имена — не localhost
      expect(issuePaths({ ADMIN_URL: 'http://localhost.example.ru' })).toEqual(['AUTH_SECRET'])
      expect(issuePaths({ ADMIN_URL: 'http://127.0.0.1.example.ru' })).toEqual(['AUTH_SECRET'])
    })

    it('со своим секретом вне прода работает, и API отвечает не только этому компьютеру', () => {
      const config = parseConfig({ ...remote, AUTH_SECRET: 'y'.repeat(32) }, dev).data
      expect(config).toMatchObject({ AUTH_SECRET: 'y'.repeat(32), loopbackOnly: false })
      // Адрес API по https — cookie Secure, даже если NODE_ENV не production
      expect(config?.secureCookies).toBe(true)
    })

    it('на учебном секрете API отвечает только этому компьютеру, со своим — всем', () => {
      expect(parseConfig({ NODE_ENV: 'test' }, dev).data?.loopbackOnly).toBe(true)
      expect(parseConfig({ AUTH_SECRET: 'z'.repeat(32) }, dev).data?.loopbackOnly).toBe(false)
      expect(parseConfig(prodEnv, dev).data?.loopbackOnly).toBe(false)
    })

    it('владелец для разработки — только на localhost', () => {
      const pair = { DEV_OWNER_EMAIL: 'dev@example.test', DEV_OWNER_PASSWORD: 'dev-password-1' }
      const config = parseConfig({ ...pair, ...remote, AUTH_SECRET: 'y'.repeat(32) }, dev).data
      expect(config?.devOwner).toBeUndefined()
    })

    describe('без флага --dev учебного режима нет', () => {
      const noFlag = {}
      const pair = { DEV_OWNER_EMAIL: 'dev@example.test', DEV_OWNER_PASSWORD: 'dev-password-1' }

      it('API вовсе без переменных не стартует: так его запустили бы на сервере за прокси', () => {
        const result = parseConfig({}, noFlag)
        expect(result.success).toBe(false)
        expect(result.error?.issues).toEqual([
          expect.objectContaining({
            path: ['AUTH_SECRET'],
            message: expect.stringMatching(/свой AUTH_SECRET.*--dev/),
          }),
        ])
      })

      it('не помогают ни NODE_ENV, ни адреса localhost, ни учебный секрет руками', () => {
        const local = { ADMIN_URL: 'http://localhost:5173', API_URL: 'http://localhost:4000' }
        for (const NODE_ENV of ['development', 'test']) {
          expect(issuePaths({ NODE_ENV, ...local, ...pair }, noFlag)).toEqual(['AUTH_SECRET'])
        }
        expect(issuePaths({ AUTH_SECRET: DEV_AUTH_SECRET }, noFlag)).toEqual(['AUTH_SECRET'])
      })

      it('со своим секретом работает, но демо-сайта и владельца для разработки нет', () => {
        const config = parseConfig({ ...pair, AUTH_SECRET: 'y'.repeat(32) }, noFlag).data
        expect(config).toMatchObject({ loopbackOnly: false, devSeed: false, devOwner: undefined })
      })
    })

    it('демо-сайт заводится по тому же правилу, что и владелец, а не по одному NODE_ENV', () => {
      expect(parseConfig({}, dev).data?.devSeed).toBe(true)
      expect(parseConfig({ NODE_ENV: 'test' }, dev).data?.devSeed).toBe(false)
      // Свой секрет и настоящие адреса без NODE_ENV: конфиг пускает, а демо-сайта нет
      const remoteWithSecret = { ...remote, AUTH_SECRET: 'y'.repeat(32) }
      expect(parseConfig(remoteWithSecret, dev).data?.devSeed).toBe(false)
      expect(parseConfig(remoteWithSecret).data?.devSeed).toBe(false)
      expect(parseConfig(prodEnv, dev).data?.devSeed).toBe(false)
    })
  })

  it('пустой адрес — понятная ошибка конфига, а не падение new URL', () => {
    for (const key of ['ADMIN_URL', 'API_URL']) {
      expect(() => parseConfig({ [key]: '' }, dev)).not.toThrow()
      expect(issuePaths({ [key]: '' })).toContain(key)
      expect(issuePaths({ ...prodEnv, [key]: '' })).toEqual([key])
    }
  })

  it('TRUST_PROXY понимает true/false', () => {
    expect(parseConfig({ TRUST_PROXY: 'true' }, dev).data?.TRUST_PROXY).toBe(true)
    expect(parseConfig({ TRUST_PROXY: 'false' }, dev).data?.TRUST_PROXY).toBe(false)
    expect(issuePaths({ TRUST_PROXY: 'maybe' })).toEqual(['TRUST_PROXY'])
  })
})
