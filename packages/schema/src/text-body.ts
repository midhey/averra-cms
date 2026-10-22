// Лёгкая разметка текста блока «Текст»: её понимает и человек в поле редактора, и нейронка в MCP.
// Пустая строка — новый абзац, строка с «- » — пункт списка, с «## » — подзаголовок. HTML в тексте
// не разметка, а текст: разбор отдаёт строки, а блок выводит их через React (экранирует)

export type TextPart =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'heading'; text: string }

const LIST_ITEM = /^[-–—•]\s+/
const HEADING = /^##\s+/

/** Разбирает текст блока на абзацы, списки и подзаголовки. Строки абзаца склеиваются пробелом */
export function parseTextBody(body: string): TextPart[] {
  const parts: TextPart[] = []
  let paragraph: string[] = []
  let list: string[] = []
  const flushParagraph = () => {
    if (paragraph.length > 0) parts.push({ kind: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  const flushList = () => {
    if (list.length > 0) parts.push({ kind: 'list', items: list })
    list = []
  }
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') {
      flushParagraph()
      flushList()
    } else if (HEADING.test(line)) {
      flushParagraph()
      flushList()
      parts.push({ kind: 'heading', text: line.replace(HEADING, '') })
    } else if (LIST_ITEM.test(line)) {
      flushParagraph()
      list.push(line.replace(LIST_ITEM, ''))
    } else if (list.length > 0) {
      // Строка сразу после пункта без пустой строки — продолжение пункта
      list[list.length - 1] = `${list[list.length - 1]} ${line}`
    } else {
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  return parts
}

/**
 * Значение для вставки в текст с разметкой (шаблоны документов): одной строкой, без переводов
 * строк и без «- »/«## » в начале — иначе название организации могло бы стать подзаголовком
 */
export function plainTextValue(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[-–—•#]+\s*)+/, '')
}
