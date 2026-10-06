import { defineConfig } from 'drizzle-kit'

// Только для генерации миграций: применяет их сам API при старте
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
})
