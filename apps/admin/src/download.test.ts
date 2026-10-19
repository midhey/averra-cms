import { describe, expect, it } from 'vitest'
import { readBody } from './download'

describe('скачивание файла из ответа API', () => {
  it('ответ дочитан — файл целиком', async () => {
    const body = await readBody(new Response('"Имя"\r\n"Анна"\r\n'))
    expect(await body.text()).toBe('"Имя"\r\n"Анна"\r\n')
  })

  it('соединение оборвалось посреди файла — ошибка об обрыве, а не обрезанный файл', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('"Имя"\r\n'))
        controller.error(new TypeError('network error'))
      },
    })
    await expect(readBody(new Response(stream))).rejects.toThrow(
      'загрузка файла оборвалась, файл не сохранён',
    )
  })
})
