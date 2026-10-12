import { formatDateTime } from '../pages-format'

/** Кто опубликовал, как его отдаёт API. null — автор неизвестен */
export type RevisionAuthor = { kind: 'user' | 'token'; name: string } | null

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
