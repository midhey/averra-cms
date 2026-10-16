import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { type ZipEntry, zipStream } from './zip'

async function read(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const text = (value: string) => new TextEncoder().encode(value)

async function* chunks(...parts: string[]) {
  for (const part of parts) yield text(part)
}

async function* entries(list: ZipEntry[]) {
  yield* list
}

describe('zipStream', () => {
  it('архив из кусков и целых файлов распаковывается тем же содержимым', async () => {
    const big = 'а'.repeat(200_000)
    const zip = await read(
      zipStream(
        entries([
          { name: 'index.html', compress: true, data: chunks('<h1>', big, '</h1>') },
          { name: 'media/1/480.webp', compress: false, data: new Uint8Array([1, 2, 3]) },
          { name: 'пусто.txt', compress: true, data: chunks() },
        ]),
      ),
    )
    const files = unzipSync(zip)
    expect(Object.keys(files).sort()).toEqual(['index.html', 'media/1/480.webp', 'пусто.txt'])
    expect(new TextDecoder().decode(files['index.html'])).toBe(`<h1>${big}</h1>`)
    expect([...(files['media/1/480.webp'] ?? [])]).toEqual([1, 2, 3])
    expect(files['пусто.txt']).toHaveLength(0)
    // Сжатое действительно сжато: повторяющийся текст меньше исходного
    expect(zip.length).toBeLessThan(big.length)
  })

  it('пустой архив — валидный ZIP без файлов', async () => {
    expect(unzipSync(await read(zipStream(entries([]))))).toEqual({})
  })

  it('ошибка источника обрывает поток, а не отдаёт неполный архив молча', async () => {
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield text('начало')
      throw new Error('файл пропал')
    }
    const stream = zipStream(entries([{ name: 'a.txt', compress: true, data: failing() }]))
    await expect(read(stream)).rejects.toThrow('файл пропал')
  })

  it('имя с «..», ведущим слешем или обратным слешем не попадает в архив', async () => {
    for (const name of ['../etc/passwd', '/abs.txt', 'a/../../b', 'a\\b.txt']) {
      const stream = zipStream(entries([{ name, compress: false, data: text('x') }]))
      await expect(read(stream), name).rejects.toThrow('Недопустимое имя')
    }
  })

  it('читает источник по мере того, как забирают архив', async () => {
    let produced = 0
    async function* lazy(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < 100; i += 1) {
        produced += 1
        yield new Uint8Array(64 * 1024)
      }
    }
    const reader = zipStream(
      entries([{ name: 'big.bin', compress: false, data: lazy() }]),
    ).getReader()
    await reader.read()
    // Первый кусок архива готов задолго до конца файла
    expect(produced).toBeLessThan(10)
    await reader.cancel()
  })
})
