import react from '@astrojs/react'
import { defineConfig, envField } from 'astro/config'

export default defineConfig({
  // React нужен только на этапе сборки: блоки превращаются в HTML, JS в браузер не уходит
  integrations: [react()],
  server: { port: 4321 },
  env: {
    schema: {
      CMS_API_URL: envField.string({
        context: 'server',
        access: 'public',
        default: 'http://localhost:4000',
      }),
      // Какой сайт собирать. Если не задан — первый сайт из API
      CMS_SITE_ID: envField.string({ context: 'server', access: 'public', optional: true }),
    },
  },
})
