import { applyCustomBlocks, type CustomBlockFieldsSource, PageContent } from '@averra/schema'
import type { EditorBlock } from './draft'

export type Validation = {
  /** Проверенная страница: её можно сохранять и показывать. null, если есть ошибки */
  content: PageContent | null
  /** Ошибки полей по блокам: id блока → путь внутри полей → текст. Путь '' — блок целиком */
  blockErrors: Record<string, Record<string, string>>
  /** Ошибки страницы целиком, например повторяющиеся id */
  pageErrors: string[]
}

type Issue = { path: readonly PropertyKey[]; message: string }

/**
 * Та же проверка, что у страницы в API, — только здесь, сразу при вводе: схема страницы, а поля
 * своих блоков — по их опубликованным определениям (applyCustomBlocks)
 */
export function validateBlocks(
  blocks: readonly EditorBlock[],
  customBlocks: readonly CustomBlockFieldsSource[] = [],
): Validation {
  const result = PageContent.safeParse({ blocks })
  if (result.success) {
    const custom = applyCustomBlocks(result.data, customBlocks)
    if (custom.issues.length === 0) {
      return { content: custom.content, blockErrors: {}, pageErrors: [] }
    }
    return errorsOf(blocks, custom.issues)
  }
  return errorsOf(blocks, result.error.issues)
}

function errorsOf(blocks: readonly EditorBlock[], issues: readonly Issue[]): Validation {
  const blockErrors: Record<string, Record<string, string>> = {}
  const pageErrors: string[] = []
  for (const issue of issues) {
    const [, index, part, ...rest] = issue.path
    const block = typeof index === 'number' ? blocks[index] : undefined
    if (!block) {
      pageErrors.push(issue.message)
      continue
    }
    const key = part === 'props' ? rest.map(String).join('.') : ''
    const errors = blockErrors[block.id] ?? {}
    errors[key] ??= issue.message
    blockErrors[block.id] = errors
  }
  return { content: null, blockErrors, pageErrors }
}
