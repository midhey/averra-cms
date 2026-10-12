import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Адрес API и порт переопределяются, чтобы e2e поднимали свою копию рядом с pnpm dev
const apiUrl = process.env.CMS_API_URL ?? 'http://localhost:4000'
const port = Number(process.env.ADMIN_PORT ?? 5173)

export default defineConfig({
  plugins: [react()],
  server: {
    port,
    // В разработке админка ходит в API через прокси — без CORS
    proxy: {
      '/api': apiUrl,
    },
  },
})
