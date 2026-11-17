import {
  collectMediaRefs,
  type PageContent,
  SVG_MIME_TYPE,
  svgAllowedAt,
  svgInContentMessage,
} from '@averra/schema'
import type { Issue } from '../../errors'
import type { mediaRepo } from './repo'

/**
 * Ссылки на картинки, которых нет в медиатеке этого сайта (чужие, удалённые или выдуманные), и
 * SVG там, где его не разрешает схема поля: SVG — для логотипов (поле Logo, x-allow-svg), а фото
 * блоков и SEO-картинка страницы — растр с вариантами. Путь — до поля в теле запроса
 * (content.blocks.0.props.image.mediaId): админка покажет ошибку у поля, а MCP поймёт, какой
 * блок поправить
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
  return contentMediaIssues(types, content)
}

/** Та же проверка для архива: картинки ещё не записаны в базу, но их тип уже проверен. */
export function contentMediaIssues(
  types: ReadonlyMap<string, string | undefined>,
  content: PageContent,
): Issue[] {
  const refs = collectMediaRefs(content)
  return refs.flatMap((ref) => {
    const type = types.get(ref.mediaId)
    const message =
      type === undefined
        ? 'Картинки нет в медиатеке сайта: выберите другую'
        : type === SVG_MIME_TYPE && !svgAllowedAt(content, ref.path)
          ? svgInContentMessage
          : undefined
    return message ? [{ path: ['content', ...ref.path].join('.'), message }] : []
  })
}
