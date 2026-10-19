import type { StatusTone } from '../ui/StatusPill'

/**
 * JSON с упорядоченными ключами: одно и то же содержимое — одна строка, в каком бы порядке ни
 * пришли ключи. Postgres (jsonb) отдаёт ключи в своём порядке, редактор пишет в своём
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return inner
    const record = inner as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    )
  })
}

/** Страница так, как её последний раз отдал API: черновик и опубликованная версия */
export type ServerPage = {
  title: string
  draft: unknown
  publishedTitle: string | null
  published: unknown
  publishedAt: string | null
}

/**
 * Что с черновиком — словами для плашки в полосе редактора и тоном. Сохранённое и опубликованное
 * сравниваются по смыслу (stableJson), заголовок страницы — тоже часть опубликованного
 */
export function draftState(dirty: boolean, page: ServerPage): { label: string; tone: StatusTone } {
  if (dirty) return { label: 'Есть несохранённые правки', tone: 'warning' }
  if (page.publishedAt === null || page.published === null) {
    return { label: 'Черновик сохранён · не опубликован', tone: 'warning' }
  }
  const same =
    page.title === page.publishedTitle && stableJson(page.draft) === stableJson(page.published)
  return same
    ? { label: 'Опубликовано', tone: 'success' }
    : { label: 'Сохранено · правки не опубликованы', tone: 'warning' }
}
