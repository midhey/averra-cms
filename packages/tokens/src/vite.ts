import { createRequire } from 'node:module'
// Расширение .ts — явно: Vite и Vitest грузят свои конфиги самой Node (без сборщика), а она
// не ищет файл без расширения
import { allFontFiles } from './fonts.ts'

// Файлы шрифтов темы для сборщиков на Vite: виртуальный модуль virtual:averra/font-files —
// { имя файла: где он }. Пакеты @fontsource — зависимости @averra/tokens, поэтому ищем их отсюда,
// а не из приложения: админке и рендереру не нужно перечислять шрифты у себя.
// Только для конфигов Vite и Astro (Node): в браузер этот модуль не попадает

const VIRTUAL_ID = 'virtual:averra/font-files'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

/** Путь к файлу шрифта на диске: <пакет>/files/<файл> */
export function fontFilePath(packageName: string, file: string) {
  return createRequire(import.meta.url).resolve(`${packageName}/files/${file}`)
}

/**
 * Плагин Vite. as: 'path' — пути на диске (рендерер читает только файлы темы сайта и кладёт их в
 * сборку сам), as: 'url' — адреса Vite (админка: в её сборку попадают все файлы каталога, браузер
 * грузит только те, что стоят в предпросмотре)
 */
export function fontFilesPlugin({ as }: { as: 'path' | 'url' }) {
  return {
    name: 'averra-font-files',
    resolveId(id: string) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    load(id: string) {
      if (id !== RESOLVED_ID) return undefined
      const files = allFontFiles().map((font) => ({
        file: font.file,
        path: fontFilePath(font.package, font.file).replaceAll('\\', '/'),
      }))
      if (as === 'path') {
        const entries = files.map(
          ({ file, path }) => `${JSON.stringify(file)}:${JSON.stringify(path)}`,
        )
        return `export default {${entries.join(',')}}`
      }
      const imports = files.map(
        ({ path }, index) => `import f${index} from ${JSON.stringify(`${path}?url`)}`,
      )
      const entries = files.map(({ file }, index) => `${JSON.stringify(file)}:f${index}`)
      return `${imports.join('\n')}\nexport default {${entries.join(',')}}`
    },
  }
}
