import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTestCa, issueServerCert } from '@averra/api/testing/certs'

// Тестовый SMTP e2e: свой CA и сертификат сервера на localhost — до старта API. API e2e
// доверяет этому CA через NODE_EXTRA_CA_CERTS (playwright.config.ts): это добавляет корневой
// сертификат, а не снимает проверку, и код API ничего об e2e не знает. Сервер с этим
// сертификатом поднимает сам тест (tests/smtp-settings.spec.ts). Запускается после clean-data:
// каждый прогон — новый CA. Пути те же, что smtpTest.files в urls.ts
const dir = resolve(import.meta.dirname, '../.data/smtp')

const ca = await createTestCa('Averra CMS e2e SMTP CA')
const server = await issueServerCert(ca)

mkdirSync(dir, { recursive: true })
writeFileSync(resolve(dir, 'ca.pem'), ca.cert)
writeFileSync(resolve(dir, 'server-key.pem'), server.key)
writeFileSync(resolve(dir, 'server-cert.pem'), server.cert)
