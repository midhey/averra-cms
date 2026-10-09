import { type BlockType, blocks } from '@cms/schema'
import { z } from 'zod'
import type { JsonSchema } from '../forms/json-schema'

/** Каталог для редактора: название, пример и JSON Schema полей каждого блока */
export const catalog = blocks.map((block) => ({
  type: block.type,
  title: block.title,
  example: block.example,
  schema: z.toJSONSchema(block.props, { io: 'input' }) as JsonSchema,
}))

export function catalogEntry(type: BlockType) {
  const entry = catalog.find((candidate) => candidate.type === type)
  if (!entry) throw new Error(`Блока «${type}» нет в каталоге`)
  return entry
}
