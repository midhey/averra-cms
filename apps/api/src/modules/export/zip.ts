import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'

// ZIP потоком (fflate): файлы читаются по одному и сразу уходят клиенту, в памяти — кусок
// текущего файла, а не весь архив. Без Node API: источник файлов приходит интерфейсом

export type ZipEntry = {
  /** Путь в архиве: только прямые слеши, без «..» и ведущего «/» (проверяет zipStream) */
  name: string
  /** Сжимать ли: картинки и так сжаты, их кладём как есть */
  compress: boolean
  /** Содержимое целиком или по кускам */
  data: Uint8Array | AsyncIterable<Uint8Array>
  mtime?: Date
}

/** Предел без ZIP64: fflate его не пишет, а смещения в обычном ZIP — 32 бита */
export const ZIP_MAX_BYTES = 3.5 * 1024 ** 3

const SAFE_NAME = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\0]+$/

/**
 * Поток ZIP из файлов. Читает следующий кусок только тогда, когда клиент забрал прежний
 * (pull), поэтому медленный клиент не раздувает память. Ошибка источника обрывает поток —
 * архив у клиента будет битым, а не молча неполным
 */
export function zipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const ready: Uint8Array[] = []
  let finished = false
  let failure: Error | undefined
  const zip = new Zip((error, chunk, final) => {
    if (error) failure = error
    else {
      if (chunk.length > 0) ready.push(chunk)
      if (final) finished = true
    }
  })

  // Каждый шаг кладёт в архив кусок файла: zip отдаёт готовые байты в ready синхронно
  async function* steps() {
    for await (const entry of entries) {
      if (!SAFE_NAME.test(entry.name)) throw new Error(`Недопустимое имя в архиве: ${entry.name}`)
      const file = entry.compress
        ? new ZipDeflate(entry.name, { level: 6 })
        : new ZipPassThrough(entry.name)
      // Время файла — его собственное, иначе fflate поставит время выгрузки
      if (entry.mtime) file.mtime = entry.mtime
      zip.add(file)
      if (entry.data instanceof Uint8Array) {
        file.push(entry.data, true)
        yield
        continue
      }
      for await (const chunk of entry.data) {
        file.push(chunk)
        yield
      }
      file.push(new Uint8Array(0), true)
      yield
    }
    zip.end()
    yield
  }
  const iterator = steps()

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (ready.length === 0 && !finished) {
        if (failure) throw failure
        const step = await iterator.next()
        if (step.done && ready.length === 0 && !finished) {
          throw failure ?? new Error('Архив закончился раньше времени')
        }
      }
      if (failure) throw failure
      const chunk = ready.shift()
      if (chunk) controller.enqueue(chunk)
      else controller.close()
    },
    async cancel() {
      // Клиент оборвал скачивание: закрываем источник (открытые файлы)
      await iterator.return(undefined)
    },
  })
}
