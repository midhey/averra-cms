import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import fontPaths from 'virtual:averra/font-files'
import type { Theme } from '@averra/schema'
import { type FontFile, fontFaceCss, themeFontFiles } from '@averra/tokens'

/** Где шрифты лежат на сайте. В Caddyfile этот путь — неизменяемый (кеш на год) */
export const FONTS_PREFIX = '/_fonts/'

export type SiteFontFile = FontFile & {
  /** Имя на сайте без .woff2: имя файла пакета и хеш содержимого */
  name: string
  url: string
  path: string
}

// Файлы шрифтов не меняются за сборку: хеш считаем один раз на файл
const hashes = new Map<string, Promise<string>>()

function hashOf(path: string) {
  let hash = hashes.get(path)
  if (!hash) {
    hash = readFile(path).then((data) =>
      createHash('sha256').update(data).digest('hex').slice(0, 10),
    )
    hashes.set(path, hash)
  }
  return hash
}

/**
 * Файлы шрифтов темы сайта: только начертания темы, с хешем содержимого в имени. Хеш нужен кешу:
 * Caddy отдаёт /_fonts/ как неизменяемые на год, а новая версия пакета шрифта — новое имя
 */
export async function siteFontFiles(theme: Theme): Promise<SiteFontFile[]> {
  return Promise.all(
    themeFontFiles(theme).map(async (file) => {
      const path = fontPaths[file.file]
      if (!path) throw new Error(`Нет файла шрифта ${file.file}: проверьте каталог шрифтов`)
      const name = `${file.file.replace(/\.woff2$/, '')}-${await hashOf(path)}`
      return { ...file, name, url: `${FONTS_PREFIX}${name}.woff2`, path }
    }),
  )
}

/** @font-face для шрифтов темы — перед переменными темы в <head> */
export const siteFontCss = (files: readonly SiteFontFile[]) =>
  fontFaceCss(files, (file) => file.url)
