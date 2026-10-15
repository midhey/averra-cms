import { generate } from 'selfsigned'

// Сертификаты для тестового SMTP-сервера (smtp.ts): свой CA и сертификат сервера, в памяти,
// без файлов в репозитории. Отдельно от сервера: e2e/scripts/smtp-certs.ts создаёт их до старта
// API, а импорт smtp-server уже трогает хранилище корневых сертификатов Node — и тот предупредил
// бы, что файла из NODE_EXTRA_CA_CERTS ещё нет

export type TestCa = { key: string; cert: string }

const yearFromNow = () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

/** Тестовый корневой сертификат. Каждый вызов — новый CA: «чужой» для сертификатов другого */
export async function createTestCa(name = 'Averra CMS Test CA'): Promise<TestCa> {
  const pems = await generate([{ name: 'commonName', value: name }], {
    keyType: 'ec',
    algorithm: 'sha256',
    notAfterDate: yearFromNow(),
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
  })
  return { key: pems.private, cert: pems.cert }
}

/**
 * Сертификат сервера, подписанный CA. По умолчанию — на localhost и 127.0.0.1; с другим
 * именем — чтобы проверить, что сертификат от доверенного CA, но на чужое имя, не принимается
 */
export async function issueServerCert(ca: TestCa, name = 'localhost') {
  const altNames =
    name === 'localhost'
      ? [
          { type: 2 as const, value: 'localhost' },
          { type: 7 as const, ip: '127.0.0.1' },
        ]
      : [{ type: 2 as const, value: name }]
  const pems = await generate([{ name: 'commonName', value: name }], {
    keyType: 'ec',
    algorithm: 'sha256',
    notAfterDate: yearFromNow(),
    ca,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  })
  return { key: pems.private, cert: pems.cert }
}
