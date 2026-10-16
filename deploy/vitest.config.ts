import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Каждый тест запускает install.sh в bash, а на Windows (Git Bash) процесс стартует
    // в десятки раз медленнее, чем на Linux: несколько запусков не укладывались в 5 секунд
    testTimeout: 60_000,
  },
})
