import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FileImporter } from 'sass'

const packageDir = resolve(import.meta.dirname, '..')
const exportsMap = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')).exports as
  | Record<string, { sass?: string } | string>
  | undefined

/**
 * `@use "@averra/ui…"` для Dart Sass вне Vite (тесты): тот же путь, что у Vite, — по `exports`
 * пакета с условием `sass`. Чего нет в `exports`, того нет и здесь: глубокий импорт не найдётся
 */
export const averraUiImporter: FileImporter<'sync'> = {
  findFileUrl(url) {
    if (url !== '@averra/ui' && !url.startsWith('@averra/ui/')) return null
    const entry = exportsMap?.[`.${url.slice('@averra/ui'.length)}`]
    const target = typeof entry === 'object' ? entry.sass : undefined
    if (!target) throw new Error(`В @averra/ui нет входа «${url}»: смотрите exports в package.json`)
    return pathToFileURL(resolve(packageDir, target))
  },
}
