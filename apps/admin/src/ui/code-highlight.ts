/** Кусок кода для подсветки: текст и его вид. Вид — имя класса в CodeEditor.module.scss */
export type CodeToken = { text: string; kind: CodeTokenKind | null }
export type CodeTokenKind =
  | 'comment'
  | 'liquid'
  | 'tag'
  | 'attribute'
  | 'string'
  | 'atrule'
  | 'property'
  | 'value'

export type CodeLanguage = 'liquid' | 'css'

// Подсветка — подсказка глазам, а не разбор: ошибки кода ищут проверки при сохранении. Поэтому
// хватает одного регулярного выражения на язык, а редкие случаи (кавычки в тексте) красятся как
// строки — это не мешает

const LIQUID_HTML: [RegExp, CodeTokenKind][] = [
  [/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/y, 'comment'],
  [/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/y, 'liquid'],
  [/<!--[\s\S]*?-->/y, 'comment'],
  [/<\/?[a-zA-Z][\w:-]*|\/?>/y, 'tag'],
  [/[a-zA-Z_:][\w:.-]*(?==)/y, 'attribute'],
  // Строка с Liquid внутри (href="{{ url }}") строкой не красится: вывод в ней важнее
  [/"[^"\n{}]*"|'[^'\n{}]*'/y, 'string'],
]

const CSS: [RegExp, CodeTokenKind][] = [
  [/\/\*[\s\S]*?\*\//y, 'comment'],
  [/@[\w-]+/y, 'atrule'],
  [/"[^"\n]*"|'[^'\n]*'/y, 'string'],
  [/(?<=^|[;{\s])-{0,2}[a-zA-Z][\w-]*(?=\s*:(?!:)[^{};]*[;}])/my, 'property'],
  [/var\(--[\w-]+\)|#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:[a-z%]+)?/y, 'value'],
]

/**
 * Код по кускам для подсветки: идём по строке, на каждом месте пробуем правила языка по порядку;
 * не подошло ни одно — символ остаётся простым текстом
 */
export function highlightCode(code: string, language: CodeLanguage): CodeToken[] {
  const rules = language === 'css' ? CSS : LIQUID_HTML
  const tokens: CodeToken[] = []
  let plain = ''
  let index = 0
  outer: while (index < code.length) {
    for (const [pattern, kind] of rules) {
      pattern.lastIndex = index
      const match = pattern.exec(code)
      if (match && match[0].length > 0) {
        if (plain) tokens.push({ text: plain, kind: null })
        plain = ''
        tokens.push({ text: match[0], kind })
        index += match[0].length
        continue outer
      }
    }
    plain += code[index]
    index += 1
  }
  if (plain) tokens.push({ text: plain, kind: null })
  return tokens
}

/** Номер строки (с 1) по позиции в тексте */
export const lineAt = (code: string, offset: number) => code.slice(0, offset).split('\n').length

/** Начало и конец строки line (с 1): выделить её по клику на замечание */
export function lineRange(code: string, line: number) {
  const lines = code.split('\n')
  const target = Math.min(Math.max(line, 1), lines.length)
  const start = lines.slice(0, target - 1).reduce((sum, text) => sum + text.length + 1, 0)
  return { start, end: start + (lines[target - 1]?.length ?? 0) }
}
