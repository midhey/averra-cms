import { z } from 'zod'
import { blocks } from './blocks'

// Где в содержимом страницы можно SVG. Решает схема поля: пометка x-allow-svg (Logo в media.ts).
// API, админка и MCP читают одно и то же правило, а не список полей, который легко забыть

type SchemaNode = {
  type?: string
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  'x-allow-svg'?: boolean
}

/** JSON Schema полей блоков — один раз на процесс: схемы не меняются, а ссылок бывает много */
const blockSchemas = new Map<string, SchemaNode>(
  blocks.map((block) => [block.type, z.toJSONSchema(block.props, { io: 'input' }) as SchemaNode]),
)

/**
 * Можно ли SVG в этой ссылке на картинку. Путь — как у collectMediaRefs:
 * ['blocks', 0, 'props', 'items', 2, 'logo', 'mediaId']. Шагаем по JSON Schema блока до объекта
 * картинки и смотрим его пометку. SEO-картинка страницы и всё, чего нет в схеме, — нельзя
 */
export function svgAllowedAt(
  content: { blocks: readonly { type: string }[] },
  path: readonly (string | number)[],
) {
  const [root, index, props, ...rest] = path
  if (root !== 'blocks' || typeof index !== 'number' || props !== 'props') return false
  const type = content.blocks[index]?.type
  let node = type ? blockSchemas.get(type) : undefined
  // Последний шаг — сам mediaId: пометка стоит на объекте картинки, на шаг выше
  for (const step of rest.slice(0, -1)) {
    node = typeof step === 'number' ? node?.items : node?.properties?.[step]
  }
  return node?.['x-allow-svg'] === true
}
