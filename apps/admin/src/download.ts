/**
 * Сохранить файл из ответа API (CSV заявок, архивы выгрузки). Файл скачивается запросом с cookie
 * сессии, как всё в админке, а не ссылкой: админка и API бывают на разных адресах. Имя файла —
 * из ответа API, иначе запасное
 */
export async function saveResponse(res: Response, fallbackName: string) {
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName
  const url = URL.createObjectURL(await readBody(res))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // Ссылку на файл отпускаем после того, как браузер начал скачивание
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Тело ответа целиком. Статус 200 уходит раньше файла, и сбой посреди выгрузки API сообщает
 * обрывом соединения: тогда файл не сохраняем, а говорим об обрыве — обрезанный файл
 * легко принять за целый
 */
export async function readBody(res: Response) {
  try {
    return await res.blob()
  } catch (error) {
    throw new Error('загрузка файла оборвалась, файл не сохранён. Попробуйте ещё раз', {
      cause: error,
    })
  }
}
