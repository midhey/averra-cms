import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { diskStorage } from './disk-storage'
import { mediaKey } from './storage'

const root = join(tmpdir(), `cms-disk-storage-${randomUUID()}`)
afterAll(() => rm(root, { recursive: true, force: true }))

const storage = diskStorage(root)
const siteId = randomUUID()
const mediaId = randomUUID()
const bytes = new Uint8Array([1, 2, 3, 4])

describe('хранилище на диске', () => {
  it('корень не создаётся, пока ничего не записали', () => {
    expect(existsSync(root)).toBe(false)
  })

  it('пишет, читает и удаляет файл; папка картинки после удаления исчезает', async () => {
    const key = mediaKey(siteId, mediaId, '480.avif')
    await storage.put(key, bytes)
    expect(await storage.get(key)).toEqual(bytes)
    expect(existsSync(join(root, siteId, mediaId, '480.avif'))).toBe(true)

    await storage.remove([key])
    expect(await storage.get(key)).toBeUndefined()
    expect(existsSync(join(root, siteId, mediaId))).toBe(false)
  })

  it('нет файла — undefined; удаление отсутствующего — не ошибка', async () => {
    const key = mediaKey(siteId, mediaId, 'original.png')
    expect(await storage.get(key)).toBeUndefined()
    await expect(storage.remove([key])).resolves.toBeUndefined()
  })

  it.each([
    ['выход из корня', `${siteId}/${mediaId}/../../../escape.jpg`],
    ['абсолютный путь', 'C:/Windows/win.ini'],
    ['не uuid вместо сайта', `site/${mediaId}/480.avif`],
    ['чужое расширение', `${siteId}/${mediaId}/480.svg`],
    ['имя не от сервера', `${siteId}/${mediaId}/photo.jpg`],
    ['обратный слеш', `${siteId}\\${mediaId}\\480.avif`],
  ])('не принимает ключ: %s', async (_, key) => {
    await expect(storage.put(key, bytes)).rejects.toThrow(/Недопустимый ключ/)
    await expect(storage.get(key)).rejects.toThrow(/Недопустимый ключ/)
    await expect(storage.remove([key])).rejects.toThrow(/Недопустимый ключ/)
  })

  it('mediaKey тоже не строит ключ из кривых частей', () => {
    expect(() => mediaKey(siteId, mediaId, '../480.avif')).toThrow(/Недопустимый ключ/)
    expect(() => mediaKey('..', mediaId, '480.avif')).toThrow(/Недопустимый ключ/)
  })
})
