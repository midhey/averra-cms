import { api } from '../api'
import { apiRequestError, NetworkError } from '../errors'
import type { MediaItem } from './media-format'

/**
 * Загрузка картинки с прогрессом. Через XMLHttpRequest, а не fetch: у fetch нет событий
 * отправки тела, и человек с большим файлом на медленной сети видел бы только «Загружаю…».
 * Адрес берём у типизированного клиента — так он не разойдётся с маршрутом API
 */
export function uploadMedia(
  siteId: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<MediaItem> {
  const url = api.sites[':siteId'].media.$url({ param: { siteId } })
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    // Сколько тела уже ушло и ушло ли всё: по этому отличаем обрыв посреди отправки от API,
    // который не отвечает вовсе
    let sent = 0
    let sentAll = false
    xhr.upload.addEventListener('progress', (event) => {
      sent = event.loaded
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    })
    xhr.upload.addEventListener('load', () => {
      sentAll = true
    })
    xhr.addEventListener('load', () => {
      const body: unknown = (() => {
        try {
          return JSON.parse(xhr.responseText)
        } catch {
          return null
        }
      })()
      if (xhr.status === 201) resolve(body as MediaItem)
      else apiRequestError({ status: xhr.status, json: async () => body }).then(reject, reject)
    })
    xhr.addEventListener('error', () => {
      // Связь оборвалась посреди отправки: чаще всего API отказал слишком большому файлу,
      // не дочитав его. Админка проверяет размер заранее, это запасной текст
      if (sent > 0 && !sentAll) {
        reject(
          new Error(
            'Связь оборвалась во время отправки файла. Если файл большой, уменьшите его и загрузите снова',
          ),
        )
        return
      }
      // Иначе сетевой сбой: как у запросов через apiFetch
      reject(new NetworkError())
    })
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}
