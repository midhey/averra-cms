import { fontFilesPlugin } from '@averra/tokens/vite'
import { defineConfig } from 'vitest/config'

// Тестам нужен тот же модуль с путями шрифтов, что сборке (astro.config.mjs)
export default defineConfig({ plugins: [fontFilesPlugin({ as: 'path' })] })
