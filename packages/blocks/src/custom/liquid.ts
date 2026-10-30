import { type ImageFormat, imageMimeTypes, type MediaMap } from '@averra/schema'
import {
  type Context,
  type Emitter,
  Liquid,
  Tag,
  type TagToken,
  type Template,
  type TopLevelToken,
} from 'liquidjs'
import { fallbackFormat, largestVariant, srcSetOf, vectorVariant } from '../ui/media-file'
import { CustomBlockRenderError } from './problems'

/** Пределы рендера шаблона: время одного рендера и «память» LiquidJS (созданные строки и массивы) */
export const LIQUID_LIMITS = { renderMs: 200, memory: 2_000_000, output: 500_000 } as const

/** Что нужно фильтрам во время рендера: картинки сайта и место блока на странице */
type RenderState = { media: MediaMap; priority: boolean }

// Рендер синхронный: фильтры читают состояние текущего вызова отсюда, а не из переменных шаблона
let current: RenderState | undefined

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)

const text = (value: unknown) =>
  value === null || value === undefined ? '' : typeof value === 'string' ? value : String(value)

// Те же правила, что у ссылок встроенных блоков (Href в @averra/schema)
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|#)/i

/** Безопасный адрес из поля «Ссылка» ({ label, href }) или строки. Иначе — «#» */
export function safeHref(value: unknown) {
  const href =
    typeof value === 'object' && value !== null && 'href' in value
      ? text((value as { href: unknown }).href)
      : text(value)
  const trimmed = href.trim()
  return SAFE_HREF.test(trimmed) ? trimmed : '#'
}

const mediaOf = (value: unknown) => {
  if (typeof value !== 'object' || value === null || !('mediaId' in value)) return undefined
  const id = (value as { mediaId: unknown }).mediaId
  return typeof id === 'string' ? current?.media[id] : undefined
}

/**
 * Картинка из медиатеки — как Picture у встроенных блоков: AVIF и WebP с набором ширин, запасной
 * формат, width и height исходника (вёрстка не прыгает), alt из поля. Первый блок страницы
 * грузит картинку сразу и первой, остальные — лениво
 */
function pictureHtml(value: unknown, sizes: unknown, className: unknown) {
  const file = mediaOf(value)
  if (!file) return ''
  const alt = escapeHtml(text((value as { alt?: unknown }).alt))
  const classAttr = className ? ` class="${escapeHtml(text(className))}"` : ''
  const size = escapeHtml(text(sizes) || '100vw')
  const priority = current?.priority === true
  const loading = priority ? 'eager' : 'lazy'
  const dimensions = `width="${file.width}" height="${file.height}"`
  const vector = vectorVariant(file)
  if (vector) {
    return `<picture${classAttr}><img src="${escapeHtml(vector.url)}" ${dimensions} alt="${alt}" loading="${loading}" decoding="async"></picture>`
  }
  const fallback = fallbackFormat(file)
  const largest = largestVariant(file, fallback)
  if (!largest) return ''
  const sources = (['avif', 'webp'] as const satisfies readonly ImageFormat[])
    .filter((format) => format !== fallback && srcSetOf(file, format) !== '')
    .map(
      (format) =>
        `<source type="${imageMimeTypes[format]}" srcset="${escapeHtml(srcSetOf(file, format))}" sizes="${size}">`,
    )
    .join('')
  const fetchPriority = priority ? ' fetchpriority="high"' : ''
  return `<picture${classAttr}>${sources}<img src="${escapeHtml(largest.url)}" srcset="${escapeHtml(srcSetOf(file, fallback))}" sizes="${size}" ${dimensions} alt="${alt}" loading="${loading}"${fetchPriority} decoding="async"></picture>`
}

/** Абзацы по пустой строке, переносы внутри абзаца — <br> */
const paragraphsHtml = (value: unknown) =>
  text(value)
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replaceAll('\n', '<br>')}</p>`)
    .join('')

/** Теги, которые в своём блоке недоступны, и почему */
const DISABLED_TAGS: Record<string, string> = {
  include: 'шаблон своего блока — один файл',
  render: 'шаблон своего блока — один файл',
  layout: 'шаблон своего блока — один файл',
  block: 'шаблон своего блока — один файл',
  // cycle выводит значение мимо автоэкранирования; чередование — {% assign odd = forloop.index | modulo: 2 %}
  cycle: 'чередуйте через {% assign odd = forloop.index | modulo: 2 %}',
}

class DisabledTag extends Tag {
  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid)
    throw new Error(`Тег {% ${token.name} %} недоступен: ${DISABLED_TAGS[token.name] ?? ''}`)
  }
  *render() {}
}

/**
 * {% echo значение | фильтры %} — то же, что {{ значение | фильтры }}. Штатный echo пишет значение
 * мимо автоэкранирования, поэтому он заменён: выражение разбирается как обычный вывод {{ }}
 */
class SafeEchoTag extends Tag {
  private readonly templates: Template[]
  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid)
    const args = token.args.trim()
    // Аргументы разбираются как шаблон «{{ … }}»: скобки Liquid в них закрыли бы вывод и спрятали
    // разметку между ними от проверки HTML при сохранении
    if (/\{\{|\}\}|\{%|%\}/.test(args)) {
      throw new Error('В {% echo %} — только значение и фильтры, без {{ }} и {% %} внутри')
    }
    this.templates = args === '' ? [] : liquid.parse(`{{ ${args} }}`)
  }
  *render(ctx: Context, emitter: Emitter) {
    yield this.liquid.renderer.renderTemplates(this.templates, ctx, emitter)
  }
}

function createEngine() {
  const engine = new Liquid({
    // Весь вывод {{ }} экранирован: данные блока заполняют люди, HTML в них — текст
    outputEscape: 'escape',
    strictFilters: true,
    strictVariables: false,
    ownPropertyOnly: true,
    // Без файловой системы: include и layout искали бы файлы на сервере
    templates: {},
    relativeReference: false,
    dynamicPartials: false,
    parseLimit: 100_000,
    renderLimit: LIQUID_LIMITS.renderMs,
    memoryLimit: LIQUID_LIMITS.memory,
    greedy: false,
  })
  for (const name of Object.keys(DISABLED_TAGS)) engine.registerTag(name, DisabledTag)
  engine.registerTag('echo', SafeEchoTag)
  // raw снимал бы экранирование: с ним поле «Заголовок» могло бы вставить на сайт <script>
  engine.registerFilter('raw', (value: unknown) => value)
  // Вывод и так экранирован: escape поверх дал бы &amp;lt; вместо «<»
  engine.registerFilter('escape', (value: unknown) => value)
  engine.registerFilter('escape_once', (value: unknown) => value)
  engine.registerFilter('image', {
    raw: true,
    handler: (value: unknown, sizes?: unknown, className?: unknown) =>
      pictureHtml(value, sizes, className),
  })
  engine.registerFilter('image_url', (value: unknown) => {
    const file = mediaOf(value)
    if (!file) return ''
    return vectorVariant(file)?.url ?? largestVariant(file, fallbackFormat(file))?.url ?? ''
  })
  engine.registerFilter('image_width', (value: unknown) => mediaOf(value)?.width ?? '')
  engine.registerFilter('image_height', (value: unknown) => mediaOf(value)?.height ?? '')
  engine.registerFilter('link', (value: unknown) => safeHref(value))
  engine.registerFilter('newline_to_br', {
    raw: true,
    handler: (value: unknown) =>
      escapeHtml(text(value).replace(/\r\n?/g, '\n')).replaceAll('\n', '<br>'),
  })
  engine.registerFilter('paragraphs', { raw: true, handler: paragraphsHtml })
  return engine
}

export const liquid = createEngine()

/** Свои фильтры — для подсказки в редакторе и документации */
export const CUSTOM_FILTERS = [
  'image',
  'image_url',
  'image_width',
  'image_height',
  'link',
  'newline_to_br',
  'paragraphs',
] as const

const parsed = new Map<string, Template[]>()
const PARSED_MAX = 64

/** Разобранный шаблон: разбор — самое дорогое, а шаблон один на все блоки этого типа */
export function parseTemplate(template: string) {
  const cached = parsed.get(template)
  if (cached) return cached
  const templates = liquid.parse(template)
  if (parsed.size >= PARSED_MAX) parsed.delete(parsed.keys().next().value ?? '')
  parsed.set(template, templates)
  return templates
}

/** Ошибка LiquidJS человеческим языком и строка, где она */
export function liquidErrorOf(error: unknown): { message: string; line?: number } {
  const token = (error as { token?: { getPosition?: () => [number, number] } }).token
  const line = token?.getPosition?.()[0]
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.replace(/, (?:file:[^,]*, )?line:\d+, col:\d+$/, '')
  return { message: translate(message), ...(line !== undefined && { line }) }
}

const translations: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^tag "?([\w-]+)"? not found$/, (m) => `Неизвестный тег {% ${m[1]} %}`],
  [/^undefined filter: ([\w-]+)$/, (m) => `Неизвестный фильтр «${m[1]}»`],
  [/^tag (\{%.*?%\}) not closed$/s, (m) => `Тег ${m[1]} не закрыт`],
  [/^output "?(\{\{.*?)"? not closed$/s, (m) => `Вывод ${m[1]} не закрыт: не хватает }}`],
  [/^tag .* not closed$/s, () => 'Тег не закрыт: не хватает %}'],
  [
    /^illegal tag: (.*)$/s,
    (m) => `Тег ${m[1]} записан не полностью: например, {% for item in plans %}`,
  ],
  [/^invalid value expression: "(.*)"$/s, (m) => `Непонятное значение «${m[1]}»: пустое условие?`],
  [
    /^([\w-]+) expects? (\d+) arguments?/i,
    (m) => `Фильтру «${m[1]}» нужно аргументов: ${m[2]} — {{ значение | ${m[1]}: … }}`,
  ],
  [/^expected variable name/i, () => 'Нужно имя переменной: {% assign имя = значение %}'],
  [/^unexpected token/i, () => 'Непонятное выражение'],
  [/render limit exceeded/i, () => 'Шаблон рендерится слишком долго: упростите циклы'],
  [/memory alloc limit exceeded/i, () => 'Шаблон создаёт слишком много данных: упростите циклы'],
  [/parse length limit exceeded/i, () => 'Шаблон слишком длинный'],
]

function translate(message: string) {
  for (const [pattern, text] of translations) {
    const match = message.match(pattern)
    if (match) return text(match)
  }
  // Свои сообщения (недоступные теги) уже по-русски; чужие — как есть, с пометкой
  return /[а-яё]/i.test(message) ? message : `Ошибка в шаблоне: ${message}`
}

const TAG_BODY = /\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}/g
const DANGLING_PIPE = /\|\s*(?:\||$)/
/** Фильтр с «:» без аргумента: {{ title | date: }} */
const DANGLING_COLON = /\|\s*[\w-]+\s*:\s*(?:\||$)/
/** comment и raw — не код: «|» и сравнения в них ничего не значат */
const NOT_CODE = /\{%-?\s*(comment|raw)\s*-?%\}[\s\S]*?\{%-?\s*end\1\s*-?%\}/g
const DANGLING_OPERATOR = /(?:==|!=|<>|<=|>=|<|>|\bcontains|\band|\bor)\s*$/

/**
 * Что LiquidJS молча пропускает, а автор шаблона явно не хотел: «|» без фильтра ({{ title | }}),
 * фильтр с «:» без значения ({{ title | date: }}) и сравнение без второго значения ({% if title == %}). Строки {% liquid %} — по одной
 */
export function liquidLint(template: string): { message: string; line: number }[] {
  const problems: { message: string; line: number }[] = []
  // Пробелы той же длины с переводами строк на месте: номера строк не сдвигаются
  const source = template.replace(NOT_CODE, (part) => part.replace(/[^\n]/g, ' '))
  for (const match of source.matchAll(TAG_BODY)) {
    const body = match[1] ?? match[2] ?? ''
    const start = source.slice(0, match.index).split('\n').length
    body.split('\n').forEach((part, offset) => {
      // Строки в кавычках — данные, «|» и «>» в них ничего не значат
      const code = part.replace(/"[^"]*"|'[^']*'/g, '""').trim()
      if (DANGLING_PIPE.test(code)) {
        problems.push({ message: 'После «|» нет фильтра', line: start + offset })
      } else if (DANGLING_COLON.test(code)) {
        problems.push({ message: 'После «:» у фильтра нет значения', line: start + offset })
      } else if (DANGLING_OPERATOR.test(code)) {
        problems.push({ message: 'Сравнение без второго значения', line: start + offset })
      }
    })
  }
  return problems
}

/**
 * Рендер шаблона своего блока: данные блока — переменные шаблона, block — id и ключ. Ошибка —
 * CustomBlockRenderError со строкой
 */
export function renderTemplate(
  template: string,
  scope: Record<string, unknown>,
  state: RenderState,
): string {
  const previous = current
  current = state
  try {
    const html: unknown = liquid.renderSync(parseTemplate(template), scope)
    const output = typeof html === 'string' ? html : String(html)
    if (output.length > LIQUID_LIMITS.output) {
      throw new CustomBlockRenderError('Блок выводит слишком много HTML: упростите шаблон')
    }
    return output
  } catch (error) {
    if (error instanceof CustomBlockRenderError) throw error
    const { message, line } = liquidErrorOf(error)
    throw new CustomBlockRenderError(message, line)
  } finally {
    current = previous
  }
}
