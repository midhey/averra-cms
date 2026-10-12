// Только типы и чистые функции: этот файл импортируют маршруты, а их типы читает админка.
// Реализация на диске — в disk-storage.ts, её подключают index.ts и testing.ts

/**
 * Хранилище файлов медиатеки. Сейчас это папка на диске, потом будет S3: маршруты знают
 * только этот интерфейс. Ключи строит mediaKey — из id и имени, которое составил сервер
 */
export type MediaStorage = {
  put(key: string, data: Uint8Array): Promise<void>
  /** undefined — такого файла нет */
  get(key: string): Promise<Uint8Array | undefined>
  /** Отсутствующие файлы не ошибка: удаление должно доходить до конца */
  remove(keys: readonly string[]): Promise<void>
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Имя файла внутри папки картинки: 480.avif, original.jpg. Его составляет сервер */
export const MEDIA_FILE_NAME = /^(original|\d{1,5})\.(avif|webp|jpg|png)$/

/** Полный ключ: <siteId>/<mediaId>/<файл>. Ничего, кроме этого, хранилище не примет */
export const MEDIA_KEY = new RegExp(`^${UUID}/${UUID}/(original|\\d{1,5})\\.(avif|webp|jpg|png)$`)

/**
 * Ключ файла в хранилище. Все части — из базы и от сервера, а не из запроса, и всё равно
 * проверяются: ошибка выше не должна превратиться в запись за пределами папки медиатеки
 */
export function mediaKey(siteId: string, mediaId: string, file: string) {
  const key = `${siteId}/${mediaId}/${file}`
  if (!MEDIA_KEY.test(key)) throw new Error(`Недопустимый ключ файла медиатеки: ${key}`)
  return key
}
