import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { ports, urls } from './urls'

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Серверы поднимаются по очереди: API первым, остальные ходят в него.
  // Занятый порт — ошибка, а не повод гонять тесты по чужому серверу и чужой базе
  webServer: [
    {
      name: 'API',
      command: 'node scripts/clean-data.ts && pnpm --filter @cms/api start',
      url: `${urls.api}/api/health/ready`,
      reuseExistingServer: false,
      env: {
        // development, чтобы API положил в пустую базу демо-сайт
        NODE_ENV: 'development',
        PORT: String(ports.api),
        PGLITE_DIR: resolve(import.meta.dirname, '.data/pglite'),
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
      env: { CMS_API_URL: urls.api, ASTRO_TELEMETRY_DISABLED: '1' },
    },
  ],
})
