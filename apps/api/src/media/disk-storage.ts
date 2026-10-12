import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { MEDIA_KEY, type MediaStorage } from './storage'

/**
 * Хранилище в папке на диске: для разработки и пока нет S3. Папки создаются по мере записи,
 * поэтому пустой корень (например, временная папка тестов) на диске не появляется
 */
export function diskStorage(root: string): MediaStorage {
  const base = resolve(root)

  // Вторая линия защиты от path traversal: ключ строит сервер, но и здесь он должен быть
  // строго нашего вида, а итоговый путь — внутри корня
  const pathOf = (key: string) => {
    if (!MEDIA_KEY.test(key)) throw new Error(`Недопустимый ключ файла медиатеки: ${key}`)
    const path = resolve(base, ...key.split('/'))
    const inside = relative(base, path)
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
      throw new Error(`Ключ ${key} указывает за пределы медиатеки`)
    }
    return path
  }

  return {
    async put(key, data) {
      const path = pathOf(key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    },

    async get(key) {
      try {
        return new Uint8Array(await readFile(pathOf(key)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },

    async remove(keys) {
      const folders = new Set<string>()
      for (const key of keys) {
        const path = pathOf(key)
        await rm(path, { force: true })
        folders.add(dirname(path))
      }
      // Папка картинки после удаления её файлов пуста — убираем и её. Непустую не трогаем
      for (const folder of folders) await rmdir(folder).catch(() => {})
    },
  }
}
