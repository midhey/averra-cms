import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

// Каждый прогон e2e начинается с пустой базы: API положит в неё демо-сайт заново.
// Путь зашит, а не приходит аргументом, чтобы опечатка не стёрла базу разработки в apps/api/.data
const dataDir = resolve(import.meta.dirname, '../.data')

rmSync(dataDir, { recursive: true, force: true })
