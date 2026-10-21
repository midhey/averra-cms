import { describe, expect, it } from 'vitest'
import {
  type ConfigOptions,
  DEV_AUTH_SECRET,
  DEV_MAIL_ENCRYPTION_KEY,
  isDevAuthSecret,
  isDevMailKey,
  parseApiArgs,
  parseConfig,
} from './config'

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

  it('сайт установки: SITE_URL — только origin, SITE_NAME — название, пустые — как не заданы', () => {
    const site = (env: Record<string, string>, options: ConfigOptions = {}) => {
      const data = parseConfig(env, options).data
      return { url: data?.SITE_URL, name: data?.SITE_NAME }
    }
    expect(site(prodEnv)).toEqual({ url: undefined, name: undefined })
    // В учебном режиме сайт показывает рендерер pnpm dev
    expect(site({}, dev).url).toBe('http://localhost:4321')
    expect(site({ ...prodEnv, SITE_URL: 'https://example.ru', SITE_NAME: '  Ремонт  ' })).toEqual({
      url: 'https://example.ru',
      name: 'Ремонт',
    })
    // compose.yaml передаёт ${SITE_NAME:-}: у установок без строки в .env это пустая строка
    expect(site({ ...prodEnv, SITE_URL: '', SITE_NAME: ' ' })).toEqual({
      url: undefined,
      name: undefined,
    })
    expect(issuePaths({ ...prodEnv, SITE_URL: 'https://example.ru/' })).toEqual(['SITE_URL'])
    // Длинное название обрезается: оно нужно один раз, и ронять из-за него API незачем
    expect(site({ ...prodEnv, SITE_NAME: 'я'.repeat(100) }).name).toBe('я'.repeat(80))
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

    describe('варианты учебного секрета — тот же публичный секрет', () => {
      const variants = [
        ` ${DEV_AUTH_SECRET}`,
        `${DEV_AUTH_SECRET} `,
        `\t${DEV_AUTH_SECRET}\n`,
        `"${DEV_AUTH_SECRET}"`,
        `'${DEV_AUTH_SECRET}'`,
        DEV_AUTH_SECRET.toUpperCase(),
        'Dev-Only-Secret-Not-For-Production-0123456789',
        DEV_AUTH_SECRET.replaceAll('-', '_'),
        // Полноширинные символы (ｄｅｖ－ｏｎｌｙ…): сдвиг ASCII на U+FEE0
        DEV_AUTH_SECRET.replace(/[!-~]/g, (char) =>
          String.fromCharCode(char.charCodeAt(0) + 0xfee0),
        ),
        // Часть учебного секрета, добитая до 32 символов
        'dev-only-secret-plus-my-own-tail-1234',
        'my-very-long-prefix-not-for-production',
        `${DEV_AUTH_SECRET}-and-something-more`,
      ]

      it('распознаются: пробелы, кавычки, регистр, _ вместо -, полноширинные символы, часть секрета', () => {
        expect(isDevAuthSecret(DEV_AUTH_SECRET)).toBe(true)
        for (const secret of variants) expect(isDevAuthSecret(secret), secret).toBe(true)
        expect(isDevAuthSecret('y'.repeat(32))).toBe(false)
        expect(isDevAuthSecret('kq3H7vXQm9b2Lw0Zr5TtYc8N1aPdEfGu+JhS4o6Vi/A=')).toBe(false)
      })

      it('вне учебного режима не проходят: ни на сервере, ни в проде, ни без флага', () => {
        for (const AUTH_SECRET of variants) {
          expect(issuePaths({ ...remote, AUTH_SECRET }), AUTH_SECRET).toEqual(['AUTH_SECRET'])
          expect(issuePaths({ ...prodEnv, AUTH_SECRET }), AUTH_SECRET).toEqual(['AUTH_SECRET'])
          expect(issuePaths({ AUTH_SECRET }, {}), AUTH_SECRET).toEqual(['AUTH_SECRET'])
        }
        expect(
          parseConfig({ ...remote, AUTH_SECRET: ` ${DEV_AUTH_SECRET}` }, dev).error?.issues,
        ).toEqual([
          expect.objectContaining({ message: expect.stringMatching(/учебный секрет.*вариант/) }),
        ])
      })

      it('в учебном режиме API на варианте отвечает только этому компьютеру', () => {
        for (const AUTH_SECRET of variants) {
          expect(parseConfig({ AUTH_SECRET }, dev).data?.loopbackOnly, AUTH_SECRET).toBe(true)
        }
      })
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

describe('почта', () => {
  const smtp = {
    SMTP_HOST: 'smtp.example.ru',
    SMTP_USER: 'noreply@example.ru',
    SMTP_PASSWORD: 'smtp-secret-password',
    MAIL_FROM: 'noreply@example.ru',
  }

  it('в учебном режиме без SMTP_* — файловый ящик в .data/mail, и окружение почту не решало', () => {
    expect(parseConfig({}, dev).data?.mail).toEqual({
      transport: 'file',
      dir: '.data/mail',
      from: { address: 'noreply@averra.test', name: 'Averra CMS' },
      maxAttempts: 8,
      retentionDays: 30,
      fromEnv: false,
    })
  })

  it('окружение решает почту само, только если задан SMTP_HOST или MAIL_TRANSPORT', () => {
    expect(parseConfig(prodEnv).data?.mail.fromEnv).toBe(false)
    expect(parseConfig({ ...prodEnv, ...smtp }).data?.mail.fromEnv).toBe(true)
    for (const MAIL_TRANSPORT of ['off', 'file', 'smtp']) {
      expect(parseConfig({ MAIL_TRANSPORT, ...smtp }, dev).data?.mail.fromEnv, MAIL_TRANSPORT).toBe(
        true,
      )
    }
  })

  it('без SMTP_* и не в учебном режиме — почта выключена явно и с причиной', () => {
    const mail = parseConfig(prodEnv).data?.mail
    expect(mail?.transport).toBe('off')
    expect(mail && 'reason' in mail ? mail.reason : '').toContain('Почта не настроена')
    // Подсказка называет и страницу «Почта» в админке, и переменные окружения
    expect(mail && 'reason' in mail ? mail.reason : '').toContain('«Почта» в админке')
    expect(parseConfig({ MAIL_TRANSPORT: 'off' }, dev).data?.mail).toMatchObject({
      transport: 'off',
      reason: expect.stringContaining('MAIL_TRANSPORT=off'),
    })
  })

  it('SMTP_HOST включает SMTP; режим берётся из порта: 465 — TLS, 587 — STARTTLS', () => {
    expect(parseConfig({ ...prodEnv, ...smtp }).data?.mail).toMatchObject({
      transport: 'smtp',
      host: 'smtp.example.ru',
      port: 465,
      security: 'tls',
      user: 'noreply@example.ru',
      password: 'smtp-secret-password',
      from: { address: 'noreply@example.ru', name: 'Averra CMS' },
    })
    expect(parseConfig({ ...prodEnv, ...smtp, SMTP_PORT: '587' }).data?.mail).toMatchObject({
      security: 'starttls',
    })
    expect(
      parseConfig({ ...prodEnv, ...smtp, SMTP_PORT: '2525', SMTP_SECURITY: 'starttls' }).data?.mail,
    ).toMatchObject({ port: 2525, security: 'starttls' })
  })

  it('нестандартный порт без SMTP_SECURITY — ошибка; варианта без шифрования нет', () => {
    expect(issuePaths({ ...prodEnv, ...smtp, SMTP_PORT: '2525' })).toEqual(['SMTP_SECURITY'])
    expect(issuePaths({ ...prodEnv, ...smtp, SMTP_SECURITY: 'none' })).toEqual(['SMTP_SECURITY'])
    expect(issuePaths({ ...prodEnv, ...smtp, SMTP_SECURITY: 'plain' })).toEqual(['SMTP_SECURITY'])
  })

  it('SMTP без логина, пароля или отправителя — ошибка конфига, а не тихо выключенная почта', () => {
    for (const key of ['SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'] as const) {
      const { [key]: _, ...rest } = smtp
      expect(issuePaths({ ...prodEnv, ...rest }), key).toEqual([key])
    }
    expect(issuePaths({ ...prodEnv, MAIL_TRANSPORT: 'smtp' })).toEqual([
      'SMTP_HOST',
      'SMTP_USER',
      'SMTP_PASSWORD',
      'MAIL_FROM',
    ])
  })

  it('ошибка конфига не печатает пароль', () => {
    const password = 'smtp-secret-password'
    const result = parseConfig({ ...prodEnv, ...smtp, MAIL_FROM: 'не адрес', SMTP_PORT: 'x' })
    expect(JSON.stringify(result.error?.issues)).not.toContain(password)
  })

  it('файловый ящик в проде запрещён', () => {
    expect(issuePaths({ ...prodEnv, MAIL_TRANSPORT: 'file' })).toEqual(['MAIL_TRANSPORT'])
  })

  it('перевод строки в MAIL_FROM и MAIL_FROM_NAME — ошибка: это заголовки письма', () => {
    const from = 'noreply@example.ru\nBcc: x@y.ru'
    expect(issuePaths({ ...prodEnv, ...smtp, MAIL_FROM: from })).toEqual(['MAIL_FROM'])
    const name = 'Averra\r\nBcc: x@y.ru'
    expect(issuePaths({ ...prodEnv, ...smtp, MAIL_FROM_NAME: name })).toEqual(['MAIL_FROM_NAME'])
  })

  it('попытки и срок хранения настраиваются', () => {
    expect(
      parseConfig({ MAIL_MAX_ATTEMPTS: '5', MAIL_RETENTION_DAYS: '7' }, dev).data?.mail,
    ).toMatchObject({ maxAttempts: 5, retentionDays: 7 })
    expect(issuePaths({ MAIL_RETENTION_DAYS: '0' })).toEqual(['MAIL_RETENTION_DAYS'])
  })
})

describe('ключ шифрования пароля SMTP', () => {
  const ownKey = Buffer.alloc(32, 7).toString('base64')
  const remote = { ADMIN_URL: 'https://admin.example.ru', API_URL: 'https://api.example.ru' }

  it('свой ключ — 32 байта в base64 (и в base64url, без «=», с пробелами по краям)', () => {
    for (const MAIL_ENCRYPTION_KEY of [
      ownKey,
      ownKey.replace(/=+$/, ''),
      Buffer.alloc(32, 250).toString('base64url'),
      ` ${ownKey}
`,
      `"${ownKey}"`,
    ]) {
      const config = parseConfig({ ...prodEnv, MAIL_ENCRYPTION_KEY }).data
      expect(config?.mailEncryptionKey?.length, MAIL_ENCRYPTION_KEY).toBe(32)
      expect(config?.mailKeyKind).toBe('env')
    }
    expect(
      parseConfig({ ...prodEnv, MAIL_ENCRYPTION_KEY: ownKey }).data?.mailEncryptionKey,
    ).toEqual(Buffer.alloc(32, 7))
  })

  it('короткий, длинный и не base64 — ошибка конфига с подсказкой и без значения', () => {
    for (const MAIL_ENCRYPTION_KEY of [
      Buffer.alloc(16, 1).toString('base64'),
      Buffer.alloc(33, 1).toString('base64'),
      'не base64 вовсе',
      'x'.repeat(44),
      '',
    ]) {
      const result = parseConfig({ ...prodEnv, MAIL_ENCRYPTION_KEY })
      expect(
        result.error?.issues.map((issue) => issue.path.join('.')),
        MAIL_ENCRYPTION_KEY,
      ).toEqual(['MAIL_ENCRYPTION_KEY'])
      const message = result.error?.issues[0]?.message ?? ''
      expect(message).toContain('openssl rand -base64 32')
      if (MAIL_ENCRYPTION_KEY.length > 0) expect(message).not.toContain(MAIL_ENCRYPTION_KEY)
    }
  })

  it('из AUTH_SECRET ключ не выводится: без MAIL_ENCRYPTION_KEY вне учебного режима ключа нет', () => {
    const config = parseConfig(prodEnv).data
    expect(config?.mailEncryptionKey).toBeUndefined()
    expect(config?.mailKeyKind).toBeUndefined()
    // API при этом стартует: просто SMTP в админке будет только для чтения
    expect(parseConfig(prodEnv).success).toBe(true)
    expect(
      parseConfig({ ...remote, AUTH_SECRET: 'y'.repeat(32) }, dev).data?.mailEncryptionKey,
    ).toBe(undefined)
  })

  it('в учебном режиме без ключа — учебный ключ из репозитория', () => {
    const config = parseConfig({}, dev).data
    expect(config?.mailKeyKind).toBe('dev')
    expect(config?.mailEncryptionKey?.toString('base64')).toBe(DEV_MAIL_ENCRYPTION_KEY)
    expect(
      parseConfig({ MAIL_ENCRYPTION_KEY: DEV_MAIL_ENCRYPTION_KEY }, dev).data?.mailKeyKind,
    ).toBe('dev')
    // Свой ключ в учебном режиме — свой
    expect(parseConfig({ MAIL_ENCRYPTION_KEY: ownKey }, dev).data?.mailKeyKind).toBe('env')
  })

  describe('варианты учебного ключа — тот же публичный ключ', () => {
    const variants = [
      DEV_MAIL_ENCRYPTION_KEY,
      ` ${DEV_MAIL_ENCRYPTION_KEY} `,
      `"${DEV_MAIL_ENCRYPTION_KEY}"`,
      DEV_MAIL_ENCRYPTION_KEY.toLowerCase(),
      DEV_MAIL_ENCRYPTION_KEY.toUpperCase(),
      DEV_MAIL_ENCRYPTION_KEY.replace(/=+$/, ''),
      Buffer.from(DEV_MAIL_ENCRYPTION_KEY, 'base64').toString('base64url'),
      // Часть учебного ключа
      DEV_MAIL_ENCRYPTION_KEY.slice(0, 24),
      // Сам учебный текст и он же с другим хвостом, записанный в base64
      'dev-only-mail-key-not-for-prod!!',
      Buffer.from('dev-only-mail-key-not-for-prod??').toString('base64'),
    ]

    it('распознаются, а случайный ключ — нет', () => {
      for (const value of variants) expect(isDevMailKey(value), value).toBe(true)
      expect(isDevMailKey(ownKey)).toBe(false)
      for (let i = 0; i < 50; i += 1) {
        const random = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
        expect(isDevMailKey(random), random).toBe(false)
      }
    })

    it('вне учебного режима не проходят: ни в проде, ни на сервере, ни без флага', () => {
      for (const MAIL_ENCRYPTION_KEY of variants) {
        expect(issuePaths({ ...prodEnv, MAIL_ENCRYPTION_KEY }), MAIL_ENCRYPTION_KEY).toEqual([
          'MAIL_ENCRYPTION_KEY',
        ])
        expect(
          issuePaths({ ...remote, AUTH_SECRET: 'y'.repeat(32), MAIL_ENCRYPTION_KEY }),
          MAIL_ENCRYPTION_KEY,
        ).toEqual(['MAIL_ENCRYPTION_KEY'])
        expect(
          issuePaths({ AUTH_SECRET: 'y'.repeat(32), MAIL_ENCRYPTION_KEY }, {}),
          MAIL_ENCRYPTION_KEY,
        ).toEqual(['MAIL_ENCRYPTION_KEY'])
      }
      expect(
        parseConfig({ ...prodEnv, MAIL_ENCRYPTION_KEY: DEV_MAIL_ENCRYPTION_KEY }).error?.issues[0]
          ?.message,
      ).toMatch(/учебный ключ.*openssl rand -base64 32/)
    })

    it('в учебном режиме вариант — тот же учебный ключ', () => {
      for (const MAIL_ENCRYPTION_KEY of variants) {
        const config = parseConfig({ MAIL_ENCRYPTION_KEY }, dev).data
        expect(config?.mailKeyKind, MAIL_ENCRYPTION_KEY).toBe('dev')
        expect(config?.mailEncryptionKey?.toString('base64')).toBe(DEV_MAIL_ENCRYPTION_KEY)
      }
    })
  })
})

describe('порт тестового SMTP (DEV_SMTP_CONNECT_PORT)', () => {
  const remote = { ADMIN_URL: 'https://admin.example.ru', API_URL: 'https://api.example.ru' }

  it('в учебном режиме — порт, куда подключается SMTP из админки; не задан — нет подмены', () => {
    expect(parseConfig({ DEV_SMTP_CONNECT_PORT: '2587' }, dev).data?.smtpConnectPort).toBe(2587)
    expect(parseConfig({}, dev).data?.smtpConnectPort).toBeUndefined()
    expect(parseConfig(prodEnv).data?.smtpConnectPort).toBeUndefined()
  })

  it('вне учебного режима — ошибка конфига: в проде SMTP из админки ходит только на 465 и 587', () => {
    for (const [env, options] of [
      [{ ...prodEnv, DEV_SMTP_CONNECT_PORT: '2587' }, {}],
      [{ ...remote, AUTH_SECRET: 'y'.repeat(32), DEV_SMTP_CONNECT_PORT: '2587' }, dev],
      [{ AUTH_SECRET: 'y'.repeat(32), DEV_SMTP_CONNECT_PORT: '2587' }, {}],
    ] as const) {
      const result = parseConfig(env, options)
      expect(result.success, JSON.stringify(env)).toBe(false)
      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ['DEV_SMTP_CONNECT_PORT'],
          message: expect.stringContaining('только для разработки и e2e'),
        }),
      ])
    }
  })

  it('не порт — ошибка конфига', () => {
    for (const DEV_SMTP_CONNECT_PORT of ['0', '70000', 'abc', '25.5']) {
      expect(issuePaths({ DEV_SMTP_CONNECT_PORT }), DEV_SMTP_CONNECT_PORT).toEqual([
        'DEV_SMTP_CONNECT_PORT',
      ])
    }
  })
})

describe('аргументы API', () => {
  it('без аргументов — обычный запуск, --dev — учебный режим', () => {
    expect(parseApiArgs([])).toEqual({ success: true, dev: false })
    expect(parseApiArgs(['--dev'])).toEqual({ success: true, dev: true })
  })

  it('опечатка или лишний аргумент — русская ошибка со списком, а не исключение', () => {
    for (const args of [
      ['--Dev'],
      ['--dev', '--port', '4000'],
      ['dev'],
      ['--dev=true'],
      ['-d'],
      ['-dev'],
      ['--', '--dev'],
    ]) {
      expect(() => parseApiArgs(args), args.join(' ')).not.toThrow()
      const result = parseApiArgs(args)
      expect(result, args.join(' ')).toEqual({
        success: false,
        error: expect.stringMatching(/^Непонятные аргументы API: .+Принимается только --dev/),
      })
    }
    expect(parseApiArgs(['--Dev', 'extra'])).toMatchObject({
      error: expect.stringContaining('--Dev extra.'),
    })
    expect(parseApiArgs(['--dev=1'])).toMatchObject({ error: expect.stringContaining('--dev=1.') })
  })

  it('в ошибке аргументы так, как их написали, а не токены разбора', () => {
    const listed = (args: string[]) => {
      const result = parseApiArgs(args)
      return result.success
        ? undefined
        : result.error.match(/^Непонятные аргументы API: (.*?)\. /)?.[1]
    }
    // Группа из одной черты — одним аргументом, а не -d -e -v
    expect(listed(['-dev'])).toBe('-dev')
    expect(listed(['--dev', '-dev'])).toBe('-dev')
    // «--» показываем: без него «--dev» в ошибке противоречил бы подсказке «принимается --dev»
    expect(listed(['--', '--dev'])).toBe('-- --dev')
    expect(listed(['--dev', '--port', '4000'])).toBe('--port 4000')
    expect(listed(['--dev=true'])).toBe('--dev=true')
  })
})
