import { type CustomBlockProblem, customBlockProblems } from '@averra/blocks/custom-engine'
import {
  applyCustomBlocks,
  type CustomBlockDraft,
  collectMediaRefs,
  type PageContent,
  SVG_MIME_TYPE,
  svgInContentMessage,
} from '@averra/schema'
import type { Db } from '../../db/client'
import { conflict, type Issue } from '../../errors'
import { mediaRepo } from '../media/repo'
import { customBlocksRepo } from './repo'

const MEDIA_IN_CSS = /media:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi

/** Картинки медиатеки в CSS своего блока: url(media:<id>) */
export const cssMediaIds = (css: string) =>
  [...css.matchAll(MEDIA_IN_CSS)].map((match) => (match[1] ?? '').toLowerCase())

/** JSON с ключами по алфавиту: jsonb хранит ключи в своём порядке, а смысл от порядка не зависит */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  )
}

/** Одно ли это определение — по смыслу, без оглядки на порядок ключей */
export const sameDefinition = (a: CustomBlockDraft, b: CustomBlockDraft) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

/**
 * Замечания к определению: шаблон, CSS, пример (движок своих блоков) и картинки — из медиатеки
 * этого сайта, в примере не SVG. Публикуется определение только без ошибок
 */
export async function definitionProblems(
  db: Db,
  siteId: string,
  draft: CustomBlockDraft,
): Promise<CustomBlockProblem[]> {
  const exampleRefs = collectMediaRefs(draft.example)
  const types = await mediaRepo(db).mimeTypes(siteId, [
    ...cssMediaIds(draft.css),
    ...exampleRefs.map((ref) => ref.mediaId),
  ])
  const problems = customBlockProblems(draft, { mediaIds: new Set(types.keys()) })
  for (const ref of exampleRefs) {
    const type = types.get(ref.mediaId)
    const message =
      type === undefined
        ? 'Картинки нет в медиатеке сайта: выберите другую'
        : type === SVG_MIME_TYPE
          ? svgInContentMessage
          : undefined
    if (message) {
      problems.push({
        part: 'example',
        level: 'error',
        message,
        path: ['example', ...ref.path].join('.'),
      })
    }
  }
  return problems
}

/** Ошибки определения в формате ответа API: путь — часть или поле, строка — в тексте */
export const problemIssues = (problems: readonly CustomBlockProblem[]): Issue[] =>
  problems
    .filter((problem) => problem.level === 'error')
    .map((problem) => ({
      path: problem.path ?? problem.part,
      message: problem.line ? `Строка ${problem.line}: ${problem.message}` : problem.message,
    }))

/**
 * 409 на публикацию страницы, чьи свои блоки не подходят под опубликованные определения: текст
 * называет блок и поле, issues — пути до полей (content.blocks.2.props.title) для редактора
 */
export function customBlocksConflict(issues: readonly Issue[]) {
  const list = issues
    .slice(0, 5)
    .map((issue) => `${issue.path.replace(/^content\./, '')} — ${issue.message}`)
    .join('; ')
  return conflict(
    `Свои блоки на странице не подходят под опубликованные определения: ${list}. Поправьте поля и сохраните черновик`,
    [...issues],
  )
}

/**
 * Свои блоки страницы по опубликованным определениям сайта: страница с подставленными
 * умолчаниями и ошибки с путём от тела запроса (content.blocks.2.props.title)
 */
export async function checkPageCustomBlocks(db: Db, siteId: string, content: PageContent) {
  const hasCustom = content.blocks.some((block) => block.type.startsWith('custom:'))
  if (!hasCustom) return { content, issues: [] as Issue[] }
  const definitions = await customBlocksRepo(db).published(siteId)
  const result = applyCustomBlocks(content, definitions)
  return {
    content: result.content,
    issues: result.issues.map((issue) => ({
      path: ['content', ...issue.path].join('.'),
      message: issue.message,
    })),
  }
}
