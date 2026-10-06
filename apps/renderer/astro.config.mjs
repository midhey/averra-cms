import react from '@astrojs/react'
import { defineConfig } from 'astro/config'

export default defineConfig({
  // React нужен только на этапе сборки: блоки превращаются в HTML, JS в браузер не уходит
  integrations: [react()],
  server: { port: 4321 },
})
