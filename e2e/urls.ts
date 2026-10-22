import { fileURLToPath } from 'node:url'

// Свои порты, чтобы e2e не мешали pnpm dev (4000, 5173, 4321)
export const ports = { api: 4100, admin: 5273, renderer: 4421 } as const

export const urls = {
  api: `http://localhost:${ports.api}`,
  admin: `http://localhost:${ports.admin}`,
  renderer: `http://localhost:${ports.renderer}`,
} as const

/**
 * Владелец админки в базе e2e: API создаёт его при старте (DEV_OWNER_*), тесты входят им.
 * Учебные данные только для e2e — база e2e своя и стирается перед каждым прогоном
 */
export const e2eOwner = {
  email: 'owner@e2e.test',
  password: 'e2e-owner-password',
  name: 'Владелец (разработка)',
} as const

/**
 * Тестовый SMTP e2e: CA и сертификат сервера на localhost создаёт scripts/smtp-certs.ts перед
 * стартом API, а API e2e доверяет CA через NODE_EXTRA_CA_CERTS. Настройки SMTP в админке пускают
 * только 465 и 587, а порт ниже 1024 на Linux без root не занять: сервер слушает свой порт, и API
 * e2e подключается к нему вместо 465 и 587 (DEV_SMTP_CONNECT_PORT, только учебный режим)
 */
export const smtpTest = {
  port: 2587,
  files: {
    ca: fileURLToPath(new URL('./.data/smtp/ca.pem', import.meta.url)),
    key: fileURLToPath(new URL('./.data/smtp/server-key.pem', import.meta.url)),
    cert: fileURLToPath(new URL('./.data/smtp/server-cert.pem', import.meta.url)),
  },
} as const

/**
 * Фейковый Bot API Telegram e2e (apps/api/src/notifications/testing/fake-telegram.ts): его
 * поднимает сам тест уведомлений, а API e2e ходит к нему вместо api.telegram.org
 * (TELEGRAM_API_URL: http — для localhost и 127.x, как здесь, и имени сервиса docker без точки).
 * Токен — учебный, только для e2e
 */
export const telegramTest = {
  port: 2445,
  token: '7000002:AAE2eFakeTokenOnlyForPlaywrightTests_xyz',
} as const

/**
 * Куда API e2e собирает сайты при публикации (PUBLISH_DIR): <id сайта>/releases/… и
 * ссылка current. Стирается вместе с базой перед каждым прогоном
 */
export const publishDir = fileURLToPath(new URL('./.data/sites', import.meta.url))

/** Сессия владельца, которую сохраняет проект setup и берут остальные тесты */
export const ownerStateFile = new URL('./.data/owner.json', import.meta.url)
