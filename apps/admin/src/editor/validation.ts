import { PageContent } from '@averra/schema'
import type { EditorBlock } from './draft'

export type Validation = {
  /** Проверенная страница: её можно сохранять и показывать. null, если есть ошибки */
  content: PageContent | null
  /** Ошибки полей по блокам: id блока → путь внутри полей → текст. Путь '' — блок целиком */
  blockErrors: Record<string, Record<string, string>>
  /** Ошибки страницы целиком, например повторяющиеся id */
  pageErrors: string[]
}

/** Та же схема, что проверяет страницу в API, — только здесь, сразу при вводе */
export function validateBlocks(blocks: readonly EditorBlock[]): Validation {
  const result = PageContent.safeParse({ blocks })
  if (result.success) return { content: result.data, blockErrors: {}, pageErrors: [] }

  const blockErrors: Record<string, Record<string, string>> = {}
  const pageErrors: string[] = []
  for (const issue of result.error.issues) {
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
