import { getRouteApi } from '@tanstack/react-router'
import { Editor } from '../editor/Editor'

const route = getRouteApi('/pages/$slug')

export function EditorScreen() {
  const { site, page, customBlocks } = route.useLoaderData()
  // Редактор берёт страницу в своё состояние один раз. key пересоздаёт его на другой странице,
  // а не оставляет правки предыдущей
  return (
    <Editor key={`${site.id}/${page.slug}`} site={site} page={page} customBlocks={customBlocks} />
  )
}
