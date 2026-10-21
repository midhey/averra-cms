import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { e2eOwner, ownerStateFile, ports, publishDir, smtpTest, urls } from './urls'

export default defineConfig({
  testDir: './tests',
  // Тесты делят демо-сайт (его же показывает рендерер), и каждый возвращает его в исходное
  // состояние. Одновременно такие тесты мешали бы друг другу, поэтому воркер один. fullyParallel
  // здесь не про скорость: с ним --shuffle перемешивает отдельные тесты, а не только файлы
  fullyParallel: true,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: urls.admin,
    locale: 'ru-RU',
    trace: 'retain-on-failure',
  },
  projects: [
    // Входит владельцем один раз и сохраняет cookie: остальным тестам не надо проходить
    // форму входа (и тратить лимит попыток входа). Вход как таковой проверяет auth.spec.ts
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: fileURLToPath(ownerStateFile) },
    },
  ],
  // Серверы поднимаются по очереди: API первым, остальные ходят в него.
  // Занятый порт — ошибка, а не повод гонять тесты по чужому серверу и чужой базе
  webServer: [
    {
      name: 'API',
      // --dev — учебный режим, как в pnpm dev: без своего AUTH_SECRET, с демо-сайтом и владельцем
      // в пустой базе. Без флага API на учебном секрете не стартует (см. isLocalDev в config.ts).
      // tsx напрямую, а не скрипт start: pnpm мог бы принять --dev за свой флаг.
      // smtp-certs — CA тестового SMTP-сервера: файл для NODE_EXTRA_CA_CERTS нужен до старта API
      command:
        'node scripts/clean-data.ts && node scripts/smtp-certs.ts && pnpm --filter @averra/api exec tsx src/index.ts --dev',
      url: `${urls.api}/api/health/ready`,
      reuseExistingServer: false,
      env: {
        // development, чтобы API положил в пустую базу демо-сайт и владельца
        NODE_ENV: 'development',
        PORT: String(ports.api),
        PGLITE_DIR: resolve(import.meta.dirname, '.data/pglite'),
        // Картинки e2e — рядом с их базой и стираются вместе с ней
        MEDIA_DIR: resolve(import.meta.dirname, '.data/media'),
        // Лимит меньше обычных 10 МБ: тест большого файла не гоняет десятки мегабайт
        MEDIA_MAX_BYTES: String(2 * 1024 * 1024),
        // Почта e2e — файловый ящик (учебный режим) рядом с базой: наружу ничего не уходит
        MAIL_DIR: resolve(import.meta.dirname, '.data/mail'),
        DEV_OWNER_EMAIL: e2eOwner.email,
        DEV_OWNER_PASSWORD: e2eOwner.password,
        ADMIN_URL: urls.admin,
        API_URL: urls.api,
        // Перед API стоит прокси Vite из админки. Доверяем X-Forwarded-For, чтобы тесты входа
        // могли быть разными «клиентами» и лимит попыток одного не задевал другой
        TRUST_PROXY: 'true',
        // CA тестового SMTP-сервера (tests/smtp-settings.spec.ts): стандартный механизм Node
        // добавляет его к доверенным корневым. Проверку сертификата это не снимает: сертификат
        // сервера по-прежнему должен быть подписан им и выписан на localhost
        NODE_EXTRA_CA_CERTS: smtpTest.files.ca,
        // Тестовый SMTP-сервер слушает свой порт, а не 587: SMTP из админки подключается к нему
        // вместо 465 и 587. API принимает это только в учебном режиме (--dev)
        DEV_SMTP_CONNECT_PORT: String(smtpTest.port),
        // Публикация собирает сайт на «сервере», как в установке на VPS: настоящий Astro в папку
        // релиза (tests/server-build.spec.ts). Сборки идут в фоне и по одной, тестам не мешают
        PUBLISH_DIR: publishDir,
        // Адрес сайта — рендерер e2e: его домен админка показывает в боковой панели
        SITE_URL: urls.renderer,
      },
    },
    {
      name: 'Админка',
      command: 'pnpm --filter @averra/admin exec vite --strictPort',
      url: urls.admin,
      reuseExistingServer: false,
      env: { ADMIN_PORT: String(ports.admin), CMS_API_URL: urls.api },
    },
    {
      name: 'Рендерер',
      // Astro держит один файл-замок apps/renderer/.astro/dev.json на проект и не даёт запустить
      // второй astro dev рядом с рендерером из pnpm dev (и наоборот). --ignore-lock не берёт и не
      // пишет замок (разве что удалит брошенный), а заодно не даёт Astro уйти в фон, когда он
      // решит, что его запустил агент: webServer должен владеть процессом
      command: `pnpm --filter @averra/renderer exec astro dev --port ${ports.renderer} --ignore-lock`,
      url: urls.renderer,
      reuseExistingServer: false,
      // Без CMS_SITE_ID: рендерер показывает сайт установки (одна установка — один сайт)
      env: { CMS_API_URL: urls.api, ASTRO_TELEMETRY_DISABLED: '1' },
    },
  ],
})
