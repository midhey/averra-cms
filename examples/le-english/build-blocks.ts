import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { customBlockProblems } from '@averra/blocks/custom-engine'
import { CUSTOM_BLOCKS_FILE_FORMAT, CustomBlockDraft, CustomBlocksFile } from '@averra/schema'

// Собирает файл выгрузки своих блоков (формат averra.custom-blocks, версия 1) из папок blocks/:
// block.json — ключ, поля, пример; template.liquid — шаблон; style.css — стили. Файл
// le-english.blocks.json лежит в репозитории готовым: его грузят «Свои блоки» → «Загрузить из
// файла» и import.ts. Правят исходники в blocks/, потом `pnpm --filter @averra/example-le-english build`

const folder = dirname(fileURLToPath(import.meta.url))
export const BLOCKS_FILE = join(folder, 'le-english.blocks.json')

/** Порядок блоков в файле — порядок секций главной */
export const BLOCK_ORDER = [
  'le-hero',
  'le-goals',
  'le-about',
  'le-steps',
  'le-reviews',
  'le-prices',
  'le-faq',
  'le-signup',
] as const

/** Определение блока из его папки: схема проверяет структуру, движок — шаблон, CSS и пример */
export function readBlock(key: string) {
  const dir = join(folder, 'blocks', key)
  const meta = JSON.parse(readFileSync(join(dir, 'block.json'), 'utf8')) as Record<string, unknown>
  return CustomBlockDraft.parse({
    ...meta,
    template: readFileSync(join(dir, 'template.liquid'), 'utf8'),
    css: readFileSync(join(dir, 'style.css'), 'utf8'),
  })
}

export function buildFile() {
  const onDisk = readdirSync(join(folder, 'blocks')).toSorted()
  if (JSON.stringify(onDisk) !== JSON.stringify([...BLOCK_ORDER].toSorted())) {
    throw new Error(`Папки blocks/ (${onDisk.join(', ')}) не совпадают с BLOCK_ORDER`)
  }
  return CustomBlocksFile.parse({
    format: CUSTOM_BLOCKS_FILE_FORMAT,
    version: 1,
    blocks: BLOCK_ORDER.map(readBlock),
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = buildFile()
  let errors = 0
  for (const block of file.blocks) {
    const problems = customBlockProblems(block)
    // Цвета бумаги, скотча и маркера — часть вида сайта, ролей темы для них нет: предупреждения
    // «цвет задан напрямую» здесь ожидаемы, их выводим одной строкой
    const colors = problems.filter((problem) => problem.message.startsWith('Цвет '))
    if (colors.length > 0) console.log(`${block.key}: цветов задано напрямую — ${colors.length}`)
    for (const problem of problems.filter((one) => !colors.includes(one))) {
      const where = problem.line ? `${problem.part}:${problem.line}` : problem.part
      console.log(`${block.key} ${problem.level} ${where} ${problem.message}`)
      if (problem.level === 'error') errors += 1
    }
  }
  if (errors > 0) {
    console.error(`Ошибок: ${errors}. Файл не записан`)
    process.exit(1)
  }
  writeFileSync(BLOCKS_FILE, `${JSON.stringify(file, null, 2)}\n`)
  console.log(`Записано блоков: ${file.blocks.length} → ${BLOCKS_FILE}`)
}
