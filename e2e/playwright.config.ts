import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { demoSiteId } from '@cms/schema'
import { defineConfig, devices } from '@playwright/test'
import { e2eOwner, ownerStateFile, ports, urls } from './urls'

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
      command: 'node scripts/clean-data.ts && pnpm --filter @cms/api start',
      url: `${urls.api}/api/health/ready`,
      reuseExistingServer: false,
      env: {
        // development, чтобы API положил в пустую базу демо-сайт и владельца
        NODE_ENV: 'development',
        PORT: String(ports.api),
        PGLITE_DIR: resolve(import.meta.dirname, '.data/pglite'),
        DEV_OWNER_EMAIL: e2eOwner.email,
        DEV_OWNER_PASSWORD: e2eOwner.password,
        ADMIN_URL: urls.admin,
        API_URL: urls.api,
        // Перед API стоит прокси Vite из админки. Доверяем X-Forwarded-For, чтобы тесты входа
        // могли быть разными «клиентами» и лимит попыток одного не задевал другой
        TRUST_PROXY: 'true',
      },
    },
    {
      name: 'Админка',
      command: 'pnpm --filter @cms/admin exec vite --strictPort',
      url: urls.admin,
      reuseExistingServer: false,
      env: { ADMIN_PORT: String(ports.admin), CMS_API_URL: urls.api },
    },
    {
      name: 'Рендерер',
      // Astro держит один файл-замок apps/renderer/.astro/dev.json на проект и не даёт
      // запустить второй astro dev рядом с рендерером из pnpm dev (и наоборот).
      // --ignore-lock не читает и не пишет замок, а заодно не даёт Astro уйти в фон,
      // когда он решит, что его запустил агент: webServer должен владеть процессом
      command: `pnpm --filter @cms/renderer exec astro dev --port ${ports.renderer} --ignore-lock`,
      url: urls.renderer,
      reuseExistingServer: false,
      // Демо-сайт свежей базы всегда с этим id: список сайтов без входа не получить
      env: { CMS_API_URL: urls.api, CMS_SITE_ID: demoSiteId, ASTRO_TELEMETRY_DISABLED: '1' },
    },
  ],
})
