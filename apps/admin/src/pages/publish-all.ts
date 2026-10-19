import { apiRequestError } from '../errors'
import { countRu } from '../format/plural'

type Target = { slug: string; title: string }
type Response = { status: number; json(): Promise<unknown> }

export type PublishFailure = { slug: string; title: string; message: string }
export type PublishResult = { published: number; failed: PublishFailure[] }

/**
 * «Опубликовать правки» с обзора: отдельного API «опубликовать всё» нет, поэтому по очереди тот же
 * запрос, что у кнопки редактора. Сбой одной страницы не останавливает остальные — итог скажет,
 * какие не вышли и почему. Кончилась сессия (401) — дальше нет смысла: ошибка уводит на вход
 */
export async function publishPages(
  targets: readonly Target[],
  publishOne: (slug: string) => Promise<Response>,
): Promise<PublishResult> {
  const failed: PublishFailure[] = []
  for (const page of targets) {
    const res = await publishOne(page.slug)
    if (res.status === 200) continue
    const error = await apiRequestError(res)
    if (error.status === 401) throw error
    failed.push({ slug: page.slug, title: page.title, message: error.message })
  }
  return { published: targets.length - failed.length, failed }
}

/**
 * Вопрос перед публикацией: какие страницы уйдут на публичный сайт одним нажатием.
 * Длинный список не перечисляем целиком — первые пять и «и ещё N страниц»
 */
export function publishQuestion(targets: readonly Target[]) {
  const shown = targets.slice(0, 5).map((page) => `«${page.title}»`)
  const rest = targets.length - shown.length
  const list =
    rest > 0
      ? `${shown.join(', ')} и ещё ${countRu(rest, ['страница', 'страницы', 'страниц'])}`
      : shown.join(', ')
  return `Опубликовать правки на сайте: ${list}? Сайт обновится после сборки.`
}
