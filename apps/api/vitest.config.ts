import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Каждый файл поднимает свой PGlite (Postgres в WASM), а файлы идут параллельно.
    // Под такой нагрузкой новая база в тесте миграций стартует дольше 5 секунд по умолчанию
    testTimeout: 30_000,
  },
})
