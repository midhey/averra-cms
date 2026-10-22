import {
  collectMediaRefs,
  type PageContent,
  SVG_MIME_TYPE,
  svgInContentMessage,
} from '@averra/schema'
import type { Issue } from '../../errors'
import type { mediaRepo } from './repo'

/**
 * Ссылки на картинки, которых нет в медиатеке этого сайта (чужие, удалённые или выдуманные), и
 * SVG в содержимом страницы: SVG — только для логотипа и иконки сайта, а картинки блоков и
 * SEO-картинка страницы — растр с вариантами. Путь — до поля в теле запроса
 * (content.blocks.0.props.image.mediaId): админка покажет ошибку у поля, а MCP поймёт, какой блок
 * поправить
 */
export async function missingMediaIssues(
  media: ReturnType<typeof mediaRepo>,
  siteId: string,
  content: PageContent,
): Promise<Issue[]> {
  const refs = collectMediaRefs(content)
  const types = await media.mimeTypes(
    siteId,
    refs.map((ref) => ref.mediaId),
  )
  return refs.flatMap((ref) => {
    const type = types.get(ref.mediaId)
    const message =
      type === undefined
        ? 'Картинки нет в медиатеке сайта: выберите другую'
        : type === SVG_MIME_TYPE
          ? svgInContentMessage
          : undefined
    return message ? [{ path: ['content', ...ref.path].join('.'), message }] : []
  })
}
