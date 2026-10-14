import { PageContent } from '@averra/schema'
import type { InferResponseType } from 'hono/client'
import type { api } from '../api'
import { formatDateTime } from '../pages-format'

type RevisionsGet = (typeof api.sites)[':siteId']['pages'][':slug']['revisions']['$get']

/** Версия из списка истории — как её отдаёт API (тип выводится из клиента, а не пишется руками) */
export type HistoryRevision = InferResponseType<RevisionsGet, 200>[number]

/** Кто опубликовал. null — автор неизвестен */
export type RevisionAuthor = HistoryRevision['author']

export type RevisionSummary = { version: number; publishedAt: string }

/** Подпись автора версии для человека */
export function authorLabel(author: RevisionAuthor) {
  if (author === null) return 'автор неизвестен'
  return author.kind === 'token' ? `токен «${author.name}»` : author.name
}

/** «Версия 3 от 12 окт. 2026 г., 10:30». Часовой пояс задаётся только в тестах */
export function revisionLabel({ version, publishedAt }: RevisionSummary, timeZone?: string) {
  return `Версия ${version} от ${formatDateTime(publishedAt, timeZone)}`
}

/**
 * Вопрос перед возвратом версии, когда в редакторе есть несохранённые правки: их нет нигде,
 * кроме открытой вкладки. Что заменится и сохранённый черновик, панель истории пишет
 * рядом с кнопкой, а не лишним диалогом на каждый возврат
 */
export function restoreQuestion(revision: RevisionSummary, timeZone?: string) {
  return `В редакторе есть несохранённые правки, они пропадут. Заменить черновик версией ${revision.version} (${formatDateTime(revision.publishedAt, timeZone)})?`
}

/** Что сказать после возврата: на сайте пока ничего не поменялось */
export function restoredMessage(revision: RevisionSummary, canPublish: boolean) {
  const next = canPublish
    ? 'На сайт она попадёт после публикации'
    : 'На сайт её выложит владелец или редактор сайта'
  return `Версия ${revision.version} возвращена в черновик. ${next}`
}

/**
 * Содержимое версии для предпросмотра. Снимок в истории старый, а блоки в коде меняются:
 * версию, которую не пропускают нынешние схемы, не рисуем — компонент блока на ней упадёт.
 * Вернуть её API тоже не даст (409), об этом и говорим
 */
export function revisionPreview(content: unknown) {
  const parsed = PageContent.safeParse(content)
  return parsed.success
    ? { content: parsed.data }
    : { error: 'Эту версию нельзя показать нынешними блоками, вернуть её в черновик тоже нельзя' }
}
