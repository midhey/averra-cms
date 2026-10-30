import postcss, { type AtRule, CssSyntaxError, type Root } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import valueParser, { type FunctionNode, type Node as ValueNode } from 'postcss-value-parser'
import { CUSTOM_BLOCK_ATTRIBUTE, CUSTOM_BLOCK_ROOT_ATTRIBUTE } from './marker'
import type { CustomBlockProblem } from './problems'

/** Селектор блока: им начинается каждое правило его CSS */
export const customBlockScope = (key: string) => `[${CUSTOM_BLOCK_ATTRIBUTE}="${key}"]`

/** Правила с @, которые остаются внутри блока. Остальные меняют страницу целиком или грузят чужое */
const ALLOWED_AT_RULES: ReadonlySet<string> = new Set([
  'media',
  'supports',
  'container',
  'keyframes',
  '-webkit-keyframes',
  // Начальные стили появления (анимация из display: none): правила внутри — тоже в блоке
  'starting-style',
])

const AT_RULE_MESSAGES: Record<string, string> = {
  import: '@import запрещён: CSS блока — только здесь, без чужих файлов',
  'font-face':
    '@font-face не нужен: шрифты задаёт тема, берите var(--font-heading) и var(--font-body)',
  namespace: '@namespace в блоке недоступен',
  page: '@page в блоке недоступен',
  property: '@property действует на всю страницу: в блоке недоступен',
  layer: '@layer в блоке недоступен: порядок слоёв — у страницы',
}

/** Свойства, которые в старых браузерах исполняли код */
const FORBIDDEN_PROPERTIES: ReadonlySet<string> = new Set(['behavior', '-moz-binding'])

/** Картинка из медиатеки в url(): media:<id картинки> — при сборке станет адресом файла */
const MEDIA_URL = /^media:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/** Функции цвета и имена цветов CSS: конкретный цвет вместо роли темы — предупреждение */
const COLOR_FUNCTIONS: ReadonlySet<string> = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
])

const NAMED_COLORS: ReadonlySet<string> = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
)

/**
 * Функции, которые грузят файл по адресу строкой или url(). Пропускает только разрешающий список
 * ниже, этот — для понятного текста ошибки
 */
const LOADING_FUNCTIONS: ReadonlySet<string> = new Set([
  'src',
  'image',
  'cross-fade',
  'element',
  'paint',
])

/**
 * Функции, разрешённые в значениях. Разрешающий список, а не запреты: новая функция браузера,
 * которая грузит файл, сама сюда не попадёт. url() и image-set() проверяются отдельно, attr() —
 * только в content. Имена — без префикса браузера
 */
const VALUE_FUNCTIONS: ReadonlySet<string> = new Set([
  // Скобки без имени: calc(1px + (2px * 3))
  '',
  'var',
  'env',
  'calc',
  'min',
  'max',
  'clamp',
  'round',
  'mod',
  'rem',
  'abs',
  'sign',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'pow',
  'sqrt',
  'hypot',
  'log',
  'exp',
  ...COLOR_FUNCTIONS,
  'color-mix',
  'light-dark',
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
  'translate',
  'translatex',
  'translatey',
  'translatez',
  'translate3d',
  'rotate',
  'rotatex',
  'rotatey',
  'rotatez',
  'rotate3d',
  'scale',
  'scalex',
  'scaley',
  'scalez',
  'scale3d',
  'skew',
  'skewx',
  'skewy',
  'matrix',
  'matrix3d',
  'perspective',
  'cubic-bezier',
  'steps',
  'linear',
  'repeat',
  'minmax',
  'fit-content',
  'blur',
  'brightness',
  'contrast',
  'drop-shadow',
  'grayscale',
  'hue-rotate',
  'invert',
  'opacity',
  'saturate',
  'sepia',
  'inset',
  'circle',
  'ellipse',
  'polygon',
  'rect',
  'xywh',
  'path',
  'counter',
  'counters',
  'view',
  'scroll',
  'anchor',
  'anchor-size',
])

/** Свойства, которые грузят картинку: строка в их значении — адрес мимо проверки url() */
const LOADING_PROPERTIES: ReadonlySet<string> = new Set([
  'background',
  'background-image',
  'border-image',
  'border-image-source',
  'mask',
  'mask-image',
  'mask-border',
  'mask-border-source',
  'mask-box-image',
  'mask-box-image-source',
  'list-style-image',
  'cursor',
  'shape-outside',
])

/**
 * Свойства со ссылкой на элемент SVG: url(#id) — маска, обрезка, фильтр, маркер из SVG блока.
 * Адрес из одного «#id» ничего не грузит
 */
const ELEMENT_REFERENCE_PROPERTIES: ReadonlySet<string> = new Set([
  'clip-path',
  'mask',
  'mask-image',
  'filter',
  'fill',
  'stroke',
  'marker',
  'marker-start',
  'marker-mid',
  'marker-end',
])

/** url(#id): ссылка на элемент этой же страницы */
const ELEMENT_REFERENCE = /^#[A-Za-z_][\w-]*$/

/** Плотность картинки в image-set(): 1x, 2dppx, 96dpi */
const RESOLUTION = /^\d*\.?\d+(?:x|dppx|dpi|dpcm)$/i

/** Без префикса браузера: -webkit-linear-gradient — это linear-gradient */
const unprefixed = (name: string) => name.replace(/^-(?:webkit|moz|ms|o)-/, '')

/**
 * Номер строки, где строка CSS оборвана неэкранированным переводом строки (LF, CR, FF), или
 * undefined. postcss считает такую строку целой, а браузер обрывает её (bad-string) и читает
 * следующий текст как правила верхнего уровня, мимо изоляции. Обратная косая черта перед
 * переводом строки — продолжение строки, это можно
 */
function brokenStringLine(css: string): number | undefined {
  let line = 1
  let quote: string | undefined
  for (let i = 0; i < css.length; i++) {
    const char = css[i] as string
    if (quote) {
      if (char === '\\') {
        if (css[i + 1] === '\r' && css[i + 2] === '\n') i++
        i++
        if (css[i] === '\n') line++
      } else if (char === quote) quote = undefined
      else if (char === '\n' || char === '\r' || char === '\f') return line
    } else if (char === '\n') line++
    else if (char === '"' || char === "'") quote = char
    else if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end === -1 ? css.length : end + 2
      line += css.slice(i, stop).split('\n').length - 1
      i = stop - 1
    } else if (char === '\\') {
      i++
      if (css[i] === '\n') line++
    }
  }
  return undefined
}

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

type CompileOptions = {
  /** Адрес файла картинки медиатеки по id. Нет — url(media:…) остаётся как есть (проверка) */
  mediaUrl?: ((mediaId: string) => string | undefined) | undefined
}

export type CompiledCss = { css: string; problems: CustomBlockProblem[] }

const SYNTAX_MESSAGES: [RegExp, string][] = [
  [/^Unclosed block/, 'Блок не закрыт: не хватает }'],
  [/^Unclosed string/, 'Строка не закрыта: не хватает кавычки'],
  [/^Unclosed comment/, 'Комментарий не закрыт: не хватает */'],
  [/^Unclosed bracket/, 'Скобка не закрыта'],
  [/^Unexpected \}/, 'Лишняя }'],
  [/^Unknown word/, 'Непонятное слово: пропущены «:» или «;»?'],
  [/^Missed semicolon/, 'Пропущена «;»'],
]

/**
 * CSS своего блока: разбор postcss и сборка заново. Каждый селектор — внутри блока
 * ([data-custom-block="ключ"] …, :scope — сам блок), имена @keyframes — с ключом блока, url() —
 * только картинки медиатеки. Ошибки — со строкой, конкретные цвета — предупреждения: роли темы
 * (var(--color-text)) меняются вместе с темой сайта
 */
export function compileCustomCss(
  css: string,
  key: string,
  options: CompileOptions = {},
): CompiledCss {
  const problems: CustomBlockProblem[] = []
  const add = (level: CustomBlockProblem['level'], line: number | undefined, message: string) =>
    problems.push({ part: 'css', level, line, message })

  const broken = brokenStringLine(css)
  if (broken !== undefined) {
    add(
      'error',
      broken,
      'Строка оборвана переводом строки: закройте кавычку на этой же строке (перенос внутри строки — «» перед ним)',
    )
    return { css: '', problems }
  }

  let root: Root
  try {
    root = postcss.parse(css)
  } catch (error) {
    if (error instanceof CssSyntaxError) {
      const known = SYNTAX_MESSAGES.find(([pattern]) => pattern.test(error.reason))
      add('error', error.line, known?.[1] ?? `Ошибка CSS: ${error.reason}`)
      return { css: '', problems }
    }
    throw error
  }

  const scope = customBlockScope(key)
  const keyframes = new Map<string, string>()

  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase()
    const line = rule.source?.start?.line
    if (name === 'charset') {
      rule.remove()
      return
    }
    if (!ALLOWED_AT_RULES.has(name)) {
      add('error', line, AT_RULE_MESSAGES[name] ?? `@${rule.name} в блоке недоступен`)
      rule.remove()
      return
    }
    if (name.endsWith('keyframes')) {
      const local = rule.params.trim()
      const scoped = `${key}--${local}`
      keyframes.set(local, scoped)
      rule.params = scoped
    }
  })

  root.walkRules((rule) => {
    const line = rule.source?.start?.line
    if (insideKeyframes(rule.parent)) return
    if (insideRule(rule.parent)) {
      add(
        'error',
        line,
        'Вложенные правила (&) старые iPhone не понимают: пишите селекторы полностью',
      )
      rule.remove()
      return
    }
    try {
      let failed = false
      const selector = scopeSelector(rule.selector, scope, (message) => {
        failed = true
        add('error', line, message)
      })
      if (failed) rule.remove()
      else rule.selector = selector
    } catch {
      add('error', line, `Непонятный селектор «${rule.selector.slice(0, 60)}»`)
      rule.remove()
    }
  })

  root.walkDecls((decl) => {
    const line = decl.source?.start?.line
    if (decl.prop.includes('\\')) {
      // Браузер читает posit\ion как position: имя свойства прошло бы мимо проверок
      add('error', line, 'Обратная косая черта в имени свойства запрещена')
      decl.remove()
      return
    }
    if (FORBIDDEN_PROPERTIES.has(decl.prop.toLowerCase())) {
      add('error', line, `Свойство ${decl.prop} запрещено`)
      decl.remove()
      return
    }
    const property = unprefixed(decl.prop.toLowerCase())
    if (property === 'position') {
      const position = decl.value.trim().toLowerCase()
      // Запасное значение var(--p, fixed) браузер берёт, когда переменной нет. А значение своей
      // переменной (--p: fixed) не проверить по месту: в position — только буквально, без var()
      const viaVar = /\bvar\(/.test(position)
      if (viaVar || /\bfixed\b/.test(position)) {
        add(
          'error',
          line,
          viaVar
            ? 'В position — только значение буквально (relative, absolute, sticky), без var()'
            : 'position: fixed закроет страницу, меню или подвал: внутри блока берите relative или absolute',
        )
        decl.remove()
        return
      }
      if (position === 'sticky') {
        add(
          'warning',
          line,
          'position: sticky прилипнет и может закрыть соседние блоки: проверьте на телефоне',
        )
      }
    }
    if (property === 'z-index' && Number(decl.value.trim()) > 10) {
      add('warning', line, 'z-index выше 10 поднимет блок над меню и подвалом страницы')
    }
    const loads = LOADING_PROPERTIES.has(property)
    const value = valueParser(decl.value)
    let color: string | undefined
    let changed = false
    let failed = false
    const fail = (message: string) => {
      add('error', line, message)
      failed = true
      return false
    }
    /**
     * url(media:<id>) — единственный адрес, который можно; при сборке — адрес файла медиатеки.
     * В свойствах SVG ещё url(#id) — элемент блока (reference: не внутри image-set)
     */
    const checkUrl = (node: FunctionNode, reference = false) => {
      const target = node.nodes
        .map((part) => part.value)
        .join('')
        .trim()
      if (
        reference &&
        ELEMENT_REFERENCE_PROPERTIES.has(property) &&
        ELEMENT_REFERENCE.test(target)
      ) {
        return true
      }
      const media = MEDIA_URL.exec(target)
      if (!media?.[1]) return fail('url() — только картинки медиатеки: url(media:<id картинки>)')
      if (options.mediaUrl) {
        const url = options.mediaUrl(media[1])
        if (!url) return fail(`Картинки ${media[1]} нет в медиатеке сайта`)
        node.nodes = [{ type: 'string', value: url, quote: '"', sourceIndex: 0, sourceEndIndex: 0 }]
        changed = true
      }
      return true
    }
    /**
     * image-set(): внутри только url(media:…), type("image/avif") и плотность. Строка здесь — адрес
     * файла, а var() подставил бы строку из своего свойства мимо проверки
     */
    const checkImageSet = (node: FunctionNode) => {
      for (const part of node.nodes) {
        if (part.type === 'space' || part.type === 'div' || part.type === 'comment') continue
        if (part.type === 'word' && RESOLUTION.test(part.value)) continue
        if (part.type === 'function' && part.value.toLowerCase() === 'url') {
          if (!checkUrl(part)) return
          continue
        }
        if (part.type === 'function' && part.value.toLowerCase() === 'type') {
          const inner = part.nodes.filter((one) => one.type !== 'space')
          if (inner.length === 1 && inner[0]?.type === 'string') continue
        }
        fail(`${node.value}(): внутри только url(media:<id картинки>), type() и плотность (1x, 2x)`)
        return
      }
    }
    // inVar: запасное значение var() — тоже значение, браузер возьмёт его, когда переменной нет
    const visit = (nodes: ValueNode[], inVar: boolean) =>
      valueParser.walk(nodes, (node) => {
        if ((node.type === 'word' || node.type === 'function') && node.value.includes('\\')) {
          // Запись с кодом символа вместо «u» браузер читает как url(, а разбор значения — как два слова
          return fail(
            'Обратная косая черта вне строки в значении запрещена: она прячет имена функций',
          )
        }
        if (node.type === 'string' && loads) {
          return fail(
            `Строка в ${decl.prop} — адрес файла мимо проверки: берите url(media:<id картинки>)`,
          )
        }
        if (node.type === 'function') {
          const fn = node.value.toLowerCase()
          if (fn === 'url') {
            checkUrl(node, true)
            return false
          }
          if (fn === 'image-set' || fn === '-webkit-image-set') {
            checkImageSet(node)
            return false
          }
          if (fn === 'var') {
            visit(node.nodes, true)
            return false
          }
          if (fn === 'attr' && property === 'content') return
          const name = unprefixed(fn)
          if (LOADING_FUNCTIONS.has(name)) {
            return fail(`${node.value}() грузит файл по адресу: берите url(media:<id картинки>)`)
          }
          if (!VALUE_FUNCTIONS.has(name))
            return fail(`Функция ${node.value}() в CSS блока недоступна`)
          if (!inVar && COLOR_FUNCTIONS.has(name)) color ??= `${node.value}()`
          return
        }
        if (node.type === 'word' && !inVar) {
          const word = node.value.toLowerCase()
          if (HEX_COLOR.test(word) || NAMED_COLORS.has(word)) color ??= node.value
          if (
            (property === 'animation' || property === 'animation-name') &&
            keyframes.has(node.value)
          ) {
            node.value = keyframes.get(node.value) ?? node.value
            changed = true
          }
        }
        return
      })
    visit(value.nodes, false)
    if (failed) {
      decl.remove()
      return
    }
    if (changed) decl.value = value.toString()
    if (color) {
      add(
        'warning',
        line,
        `Цвет ${color} задан напрямую: возьмите роль темы, например var(--color-text) или var(--color-accent) — она сменится вместе с темой`,
      )
    }
  })

  // Ошибочное уже убрано: в сборку попадает только то, что прошло проверку
  return { css: escapeForStyleElement(root.toString()), problems }
}

function insideKeyframes(node: postcss.Container | postcss.Document | undefined): boolean {
  if (!node || node.type === 'root' || node.type === 'document') return false
  if (node.type === 'atrule' && (node as AtRule).name.toLowerCase().endsWith('keyframes'))
    return true
  return insideKeyframes(node.parent)
}

/** Правило внутри правила, в том числе через @media: вложенность CSS старые iPhone не понимают */
function insideRule(node: postcss.Container | postcss.Document | undefined): boolean {
  if (!node || node.type === 'root' || node.type === 'document') return false
  return node.type === 'rule' || insideRule(node.parent)
}

const PAGE_SELECTORS: ReadonlySet<string> = new Set(['html', 'body'])

/**
 * Псевдоклассы и псевдоэлементы, разрешённые в селекторах. Разрешающий список: состояние,
 * порядок, формы и логика (:not/:is/:where/:has) — всё про элементы блока
 */
const PSEUDOS: ReadonlySet<string> = new Set([
  ':hover',
  ':focus',
  ':focus-visible',
  ':focus-within',
  ':active',
  ':visited',
  ':link',
  ':any-link',
  ':target',
  ':checked',
  ':disabled',
  ':enabled',
  ':required',
  ':optional',
  ':valid',
  ':invalid',
  ':user-valid',
  ':user-invalid',
  ':in-range',
  ':out-of-range',
  ':read-only',
  ':read-write',
  ':placeholder-shown',
  ':default',
  ':indeterminate',
  ':autofill',
  ':open',
  ':popover-open',
  ':first-child',
  ':last-child',
  ':only-child',
  ':first-of-type',
  ':last-of-type',
  ':only-of-type',
  ':nth-child',
  ':nth-last-child',
  ':nth-of-type',
  ':nth-last-of-type',
  ':empty',
  ':not',
  ':is',
  ':where',
  ':has',
  ':lang',
  ':dir',
  // Старая запись псевдоэлементов с одним двоеточием
  ':before',
  ':after',
  ':first-line',
  ':first-letter',
  '::before',
  '::after',
  '::marker',
  '::placeholder',
  '::selection',
  '::first-line',
  '::first-letter',
  '::backdrop',
  '::file-selector-button',
])

/** Свои псевдоэлементы браузеров (полоса прокрутки, маркер details) — тоже про элементы блока */
const VENDOR_PSEUDO_ELEMENT = /^::?-(?:webkit|moz)-[a-z-]+$/

/** Комбинаторы между частями селектора; в начале селектора — только «>», верхний элемент шаблона */
const COMBINATORS: ReadonlySet<string> = new Set(['', '>', '+', '~'])

/**
 * Селектор внутри блока. Разрешающий список: элемент, класс, id, атрибут, «*», псевдоклассы из
 * списка и комбинаторы « », «>», «+», «~». :scope — сам блок и только в начале селектора; без него
 * селектор начинается с элемента блока или с «>». «~», «+» в начале или после :scope выбрали бы
 * соседние блоки страницы, :scope в аргументах :not/:is/:has — всю страницу
 */
function scopeSelector(selector: string, scope: string, fail: (message: string) => void) {
  const scopeNode = () => selectorParser().astSync(scope).first.first
  const rootNode = () => selectorParser().astSync(`[${CUSTOM_BLOCK_ROOT_ATTRIBUTE}]`).first.first
  const isScope = (node: selectorParser.Node | undefined) =>
    node?.type === 'pseudo' && node.value.toLowerCase() === ':scope'
  return selectorParser((selectors) => {
    selectors.each((one) => {
      const lead = isScope(one.first) ? one.first : undefined
      one.walk((node) => {
        switch (node.type) {
          case 'pseudo': {
            const name = node.value.toLowerCase()
            if (name === ':scope') {
              if (node !== lead) {
                fail(
                  ':scope — только в начале селектора: внутри :not(), :is(), :has() он вышел бы за блок',
                )
              }
            } else if (name === ':root') {
              fail(':root — это вся страница: в блоке берите :scope')
            } else if (!PSEUDOS.has(name) && !VENDOR_PSEUDO_ELEMENT.test(name)) {
              fail(`${node.value} в CSS блока недоступен`)
            }
            return
          }
          case 'tag':
            if (PAGE_SELECTORS.has(node.value.toLowerCase())) {
              fail(`${node.value} — это вся страница: в блоке берите :scope`)
            }
            return
          case 'combinator':
            if (!COMBINATORS.has(node.value.trim())) {
              fail(`Комбинатор «${node.value.trim()}» в CSS блока недоступен`)
            }
            return
          case 'nesting':
            fail('& вне вложенного правила не работает: пишите селектор полностью')
            return
          case 'class':
          case 'id':
          case 'attribute':
          case 'universal':
          case 'selector':
          case 'comment':
            return
          default:
            fail(`Непонятный селектор «${selector.slice(0, 60)}»`)
        }
      })
      const first = one.first
      if (lead) {
        const next = one.nodes.find((node) => node.type === 'combinator')
        const combinator = next?.value.trim()
        if (combinator === '+' || combinator === '~') {
          fail('«+» и «~» после :scope выбирают соседние блоки страницы: пишите «:scope .класс»')
        }
        // «:scope > .a» — верхний элемент шаблона: ребёнок обёртки HTML, а не секции
        if (next && combinator === '>') {
          one.insertBefore(next, selectorParser.combinator({ value: ' ' }))
          one.insertBefore(next, rootNode())
          next.spaces.before = ' '
        }
        // Пробел после запятой остаётся перед селектором блока
        const root = scopeNode()
        root.spaces.before = lead.spaces.before
        lead.replaceWith(root)
      } else if (first?.type === 'combinator') {
        // «> .a» — ребёнок блока; «~ *» и «+ *» — соседние блоки страницы, мимо изоляции
        if (first.value.trim() !== '>') {
          fail(
            `Селектор не может начинаться с «${first.value.trim()}»: он выбрал бы соседние блоки страницы`,
          )
          return
        }
        // «> .a» — верхний элемент шаблона: ребёнок обёртки HTML внутри секции блока
        const before = first.spaces.before
        first.spaces.before = ' '
        const wrapper = rootNode()
        one.prepend(wrapper)
        one.prepend(selectorParser.combinator({ value: ' ' }))
        const root = scopeNode()
        root.spaces.before = before
        one.prepend(root)
      } else {
        // Пробел после запятой остаётся перед селектором блока, а не между ним и потомком
        const before = first?.spaces.before ?? ''
        if (first) first.spaces.before = ''
        const root = scopeNode()
        root.spaces.before = before
        one.prepend(selectorParser.combinator({ value: ' ' }))
        one.prepend(root)
      }
    })
  }).processSync(selector)
}

/**
 * CSS кладут в <style> внутри HTML: «</style» в строке или комментарии закрыл бы элемент, «<!--»
 * сбил бы разбор. Заменяем на CSS-код символа: в строке значение то же, вне строки это ошибка
 * и без того. Не полагаемся на то, что postcss делает так сам
 */
export const escapeForStyleElement = (css: string) => css.replace(/<(?=\/style|!--)/gi, '\\3c ')
