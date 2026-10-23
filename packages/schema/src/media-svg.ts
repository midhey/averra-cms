import { z } from 'zod'
import { blocks } from './blocks'

// Что можно картинке в содержимом страницы, решает схема поля, а не список полей, который легко
// забыть: пометка x-allow-svg (Logo в media.ts) — можно SVG, нет свойства alt — описания у
// картинки нет (alt логотипа — название рядом). API, админка, MCP и проверки SEO читают одно правило

/** Узел JSON Schema полей блока — та часть, по которой шагают проверки картинок */
export type BlockSchemaNode = {
  type?: string
  properties?: Record<string, BlockSchemaNode>
  items?: BlockSchemaNode
  'x-allow-svg'?: boolean
}

/** JSON Schema полей блоков — один раз на процесс: схемы не меняются, а ссылок бывает много */
const blockSchemas = new Map<string, BlockSchemaNode>(
  blocks.map((block) => [
    block.type,
    z.toJSONSchema(block.props, { io: 'input' }) as BlockSchemaNode,
  ]),
)

/** Схема полей блока по типу; незнакомый тип (черновик после отката версии) — undefined */
export const blockPropsSchema = (type: string) => blockSchemas.get(type)

/** Шаг по схеме: номер — в пункт списка, имя — в поле объекта */
export const schemaStep = (node: BlockSchemaNode | undefined, step: string | number) =>
  typeof step === 'number' ? node?.items : node?.properties?.[step]

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
  let node = type ? blockPropsSchema(type) : undefined
  // Последний шаг — сам mediaId: пометка стоит на объекте картинки, на шаг выше
  for (const step of rest.slice(0, -1)) node = schemaStep(node, step)
  return node?.['x-allow-svg'] === true
}
