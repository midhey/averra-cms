import { type CustomPlace, collectMediaRefs } from '@averra/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { media } from '../../db/schema'
import type { Issue } from '../../errors'
import type { Tx } from '../../mail/outbox'

/**
 * Картинки в полях своего вида шапки или подвала, которых нет в медиатеке сайта (удалённые,
 * чужие, выдуманные токеном). Как у картинок страницы и логотипа: иначе на сайте вышел бы пустой
 * элемент на месте картинки. Путь — от шапки: custom.props.badge.mediaId
 */
export async function placeMediaIssues(
  db: Db | Tx,
  siteId: string,
  custom: CustomPlace | null,
): Promise<Issue[]> {
  if (!custom) return []
  const refs = collectMediaRefs(custom.props, ['custom', 'props'])
  if (refs.length === 0) return []
  // Не uuid в базу не отдаём: Postgres ответил бы ошибкой вместо «картинки нет»
  const ids = [...new Set(refs.map((ref) => ref.mediaId).filter((id) => uuidLike.test(id)))]
  const found =
    ids.length === 0
      ? []
      : await db
          .select({ id: media.id })
          .from(media)
          .where(and(eq(media.siteId, siteId), inArray(media.id, ids)))
  const known = new Set(found.map((row) => row.id))
  return refs.flatMap((ref) =>
    known.has(ref.mediaId)
      ? []
      : [{ path: ref.path.join('.'), message: 'Картинки нет в медиатеке сайта: выберите другую' }],
  )
}

const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
