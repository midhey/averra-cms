import { collectMediaRefs, type PageContent } from '@averra/schema'
import type { Issue } from '../../errors'
import type { mediaRepo } from './repo'

/**
 * Ссылки на картинки, которых нет в медиатеке этого сайта: чужие, удалённые или выдуманные.
 * Путь — до поля в теле запроса (content.blocks.0.props.image.mediaId): админка покажет
 * ошибку у поля, а MCP поймёт, какой блок поправить
 */
export async function missingMediaIssues(
  media: ReturnType<typeof mediaRepo>,
  siteId: string,
  content: PageContent,
): Promise<Issue[]> {
  const refs = collectMediaRefs(content)
  const existing = await media.existingIds(
    siteId,
    refs.map((ref) => ref.mediaId),
  )
  return refs
    .filter((ref) => !existing.has(ref.mediaId))
    .map((ref) => ({
      path: ['content', ...ref.path].join('.'),
      message: 'Картинки нет в медиатеке сайта: выберите другую',
    }))
}
