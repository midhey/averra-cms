import { defaultOptions, type TagToken, Tokenizer, TokenKind } from 'liquidjs'
import { type DefaultTreeAdapterTypes, parseFragment, serialize } from 'parse5'
import { isReservedDataAttribute, isReservedId } from './marker'
import type { CustomBlockProblem } from './problems'

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode

/**
 * Элементы, которых в своём блоке нет: скрипты и всё, что встраивает чужое или меняет страницу
 * целиком. Блок — HTML и CSS без JavaScript (правило продукта), стили — в поле CSS, формы — блок
 * «Форма». SVG-анимации set/animate умеют подменить href на javascript:
 */
const FORBIDDEN_ELEMENTS: ReadonlySet<string> = new Set([
  'script',
  'noscript',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'link',
  'meta',
  'title',
  'template',
  'form',
  'portal',
  // Браузер превращает в текст всё до конца страницы: следующие блоки, подвал, cookie-уведомление
  'plaintext',
  'xmp',
  'listing',
  'noembed',
  'noframes',
  'foreignobject',
  'set',
  'animate',
  'animatemotion',
  'animatetransform',
  // MathML на лендинге не нужен, а смена пространства имён (mglyph, malignmark в mtext) — главный
  // приём мутационного XSS: при повторном разборе текст атрибута становится разметкой
  'math',
  'mglyph',
  'malignmark',
])

const NS_SVG = 'http://www.w3.org/2000/svg'
const NS_MATHML = 'http://www.w3.org/1998/Math/MathML'

/** Атрибуты со ссылкой: в них только http(s), mailto:, tel: и адреса без схемы */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'srcset',
  'imagesrcset',
  'poster',
  'cite',
  'action',
  'background',
  'longdesc',
  'data',
  'codebase',
  'manifest',
  'xlink:href',
])

/**
 * Атрибуты, которые сами грузят файл: только свой сайт и медиатека. Чужой адрес отдал бы
 * посетителя (его IP и просмотр страницы) чужому серверу до согласия на cookie
 */
const RESOURCE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'src',
  'srcset',
  'imagesrcset',
  'poster',
  'background',
  'data',
  'codebase',
  'manifest',
])

/** У этих элементов href — тоже загрузка файла (SVG), а не переход по ссылке */
const RESOURCE_HREF_ELEMENTS: ReadonlySet<string> = new Set(['use', 'image', 'feimage'])

/**
 * У этих SVG-элементов href — ссылка на шаблон (градиент, узор, фильтр, путь). Firefox умеет брать
 * его из внешнего документа, поэтому — только #id на элемент блока
 */
const TEMPLATE_HREF_ELEMENTS: ReadonlySet<string> = new Set([
  'lineargradient',
  'radialgradient',
  'pattern',
  'filter',
  'textpath',
  'mpath',
  'tref',
  'altglyph',
])

/** Атрибуты, которых в своём блоке нет, и почему */
const FORBIDDEN_ATTRIBUTES: Readonly<Record<string, string>> = {
  srcdoc: 'он встраивает чужую страницу',
  style: 'стили блока — во вкладке CSS: там они изолированы в блоке и проверяются',
  ping: 'он шлёт запрос на чужой адрес',
  form: 'он привязывает кнопку к форме сайта: заявки принимает блок «Форма»',
  formaction: 'он отправляет форму на другой адрес: заявки принимает блок «Форма»',
  formmethod: 'он меняет отправку формы: заявки принимает блок «Форма»',
  formtarget: 'он меняет отправку формы: заявки принимает блок «Форма»',
  formenctype: 'он меняет отправку формы: заявки принимает блок «Форма»',
  formnovalidate: 'он меняет отправку формы: заявки принимает блок «Форма»',
}

/** Функции CSS, которые грузят файл по адресу: в презентационных атрибутах SVG их читает браузер */
const LOADING_CSS_FUNCTION =
  /(?:^|[^\w-])(?:-webkit-|-moz-)?(?:image|image-set|src|cross-fade|element|paint)\s*\(/i

/** Атрибуты без CSS: текст для людей и данные, браузер значение не разбирает */
const INERT_ATTRIBUTE = /^(?:alt|title|placeholder|aria-.+|data-.+)$/

/** Значение атрибута без CSS-экранирования: u\72l( браузер читает как url( */
const decodeCssEscapes = (value: string) =>
  value.replace(/\\([0-9a-f]{1,6})\s?|\\([^\n])/gi, (_, hex: string | undefined, char: string) =>
    hex ? String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff) || 0xfffd) : char,
  )

/**
 * Загрузка файла из значения атрибута через url() (fill, mask, clip-path, filter, marker-*,
 * cursor в SVG): допустим только url(#id) — ссылка на элемент этой же страницы
 */
function cssLoadsFile(value: string) {
  const text = decodeCssEscapes(value)
  if (LOADING_CSS_FUNCTION.test(text)) return true
  for (const match of text.matchAll(/url\s*\(([^)]*)\)?/gi)) {
    if (!/^\s*(?:"#[^"]*"|'#[^']*'|#[^\s"']*)\s*$/.test(match[1] ?? '')) return true
  }
  return false
}

const isEventAttribute = (name: string) => /^on/i.test(name)

/**
 * id, который годится в имя переменной JS. Браузер кладёт элемент с таким id в window: id="ym"
 * или id="dataLayer" подменил бы счётчик, и скрипты сайта упали бы. Имя с дефисом или другим
 * знаком вне имён JS (tariffs-menu, {{ block.id }}-menu) ни с одной переменной не совпадёт —
 * поэтому разрешающее правило, а не список занятых имён: чужие счётчики заводят свои
 */
const isScriptName = (id: string) => /^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u.test(id)

/**
 * Элементы, которых браузер кладёт в document по атрибуту name: <img name="cookie"> подменил бы
 * document.cookie, name="querySelectorAll" — сам метод. form, embed, object, iframe и так запрещены
 */
const NAMED_ELEMENTS: ReadonlySet<string> = new Set(['img', 'form', 'embed', 'object', 'iframe'])

/** tabindex больше 0 ставит элемент блока в порядке Tab раньше всей страницы */
const isPositiveTabindex = (value: string) => Number.parseInt(value.trim(), 10) > 0

/**
 * Атрибуты со ссылкой на элемент по id. Ссылка из блока на элемент страницы открыла бы её окно
 * (popovertarget), подписала бы чужое поле или прочла бы диктором чужой текст: только на элементы
 * этого же блока
 */
const ID_REFERENCE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'popovertarget',
  'commandfor',
  'interestfor',
  'anchor',
  'for',
  'list',
  'headers',
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-owns',
  'aria-details',
  'aria-activedescendant',
  'aria-flowto',
  'aria-errormessage',
])

const idsOf = (value: string) => value.split(/\s+/).filter(Boolean)

/** Схема адреса без пробелов и управляющих символов: браузер их выбрасывает перед разбором */
const schemeOf = (url: string) => {
  const compact = url.replace(/[\s\p{Cc}]/gu, '').toLowerCase()
  return /^([a-z][a-z0-9+.-]*):/.exec(compact)?.[1]
}

const SAFE_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel'])

/** Адрес можно оставить: без схемы (/путь, #якорь, файл) или с безопасной схемой */
export function isSafeUrl(url: string) {
  const scheme = schemeOf(url)
  return scheme === undefined || SAFE_SCHEMES.has(scheme)
}

/** Адрес со своего сайта: без схемы и не «//хост» (браузер читает и обратные слэши как чужой сервер) */
export function isLocalUrl(url: string) {
  const compact = url.replace(/[\s\p{Cc}]/gu, '')
  return schemeOf(url) === undefined && !/^[\\/]{2}/.test(compact)
}

const srcsetUrls = (value: string) =>
  value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean)

const attributeName = (attr: { name: string; prefix?: string }) =>
  attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name

const urlsOf = (name: string, value: string) =>
  name.endsWith('srcset') ? srcsetUrls(value) : [value]

const isResource = (tag: string, name: string) =>
  RESOURCE_ATTRIBUTES.has(name) ||
  (RESOURCE_HREF_ELEMENTS.has(tag) && (name === 'href' || name === 'xlink:href'))

const unsafeLinkMessage = (value: string) =>
  `Ссылка «${value.trim().slice(0, 40)}» запрещена: только https://, /, #, mailto: и tel:`

/**
 * Что не так с атрибутом (текст для редактора) или undefined, если всё хорошо. Значение
 * проверяется, если оно не собрано из Liquid: при сохранении у такого значения — «x»
 */
function attributeProblem(
  tag: string,
  name: string,
  value: string | undefined,
  trusted?: ReadonlySet<string>,
) {
  if (isEventAttribute(name)) return `Атрибут ${name} — это JavaScript: в своём блоке его нет`
  const reason = FORBIDDEN_ATTRIBUTES[name]
  if (reason) return `Атрибут ${name} запрещён: ${reason}`
  if (name.startsWith('data-') && isReservedDataAttribute(name)) {
    return `Атрибут ${name} занят разметкой сайта (уведомление о cookie, шапка, видео): возьмите другое имя`
  }
  if (name === 'name' && NAMED_ELEMENTS.has(tag)) {
    return `Атрибут name у <${tag}> запрещён: браузер подставил бы элемент вместо document.<имя>, и скрипты сайта сломались бы`
  }
  if (name === 'autofocus') {
    return 'Атрибут autofocus запрещён: он уводит фокус и прокрутку страницы в блок при загрузке'
  }
  if (value === undefined) return undefined
  if (name === 'tabindex' && isPositiveTabindex(value)) {
    return `tabindex="${value.trim().slice(0, 10)}" запрещён: элемент встал бы в порядке Tab раньше всей страницы. Только 0 или -1`
  }
  if (name === 'id' && isReservedId(value)) {
    return `id «${value.trim().slice(0, 40)}» занят разметкой сайта: возьмите другой`
  }
  if (name === 'id' && isScriptName(value)) {
    return `id «${value.slice(0, 40)}» совпал бы с переменной скриптов сайта (window.${value.slice(0, 40)}): возьмите имя с дефисом, например «{{ block.id }}-${value.slice(0, 40)}»`
  }
  const isLink = URL_ATTRIBUTES.has(name) || name.endsWith(':href')
  if (!isLink) {
    if (!INERT_ATTRIBUTE.test(name) && cssLoadsFile(value)) {
      return `Значение атрибута ${name} грузит файл через url(): внутри блока допустим только url(#id) на элемент блока`
    }
    return undefined
  }
  const urls = urlsOf(name, value)
  if (!urls.every(isSafeUrl)) return unsafeLinkMessage(value)
  if (
    TEMPLATE_HREF_ELEMENTS.has(tag) &&
    (name === 'href' || name === 'xlink:href') &&
    !value.trim().startsWith('#')
  ) {
    return `У <${tag}> ${name} — только #id элемента блока: внешний шаблон грузился бы с чужого сервера`
  }
  if (isResource(tag, name) && !urls.every((url) => isLocalUrl(url) || trusted?.has(url.trim()))) {
    return `Чужой адрес «${value.trim().slice(0, 40)}» в ${name} запрещён: картинки — из медиатеки (фильтр image), файлы — со своего сайта`
  }
  return undefined
}

const isElement = (node: DefaultTreeAdapterTypes.ChildNode): node is Element => 'tagName' in node

/**
 * Элемент не в своём пространстве имён: MathML целиком, HTML внутри SVG (через <desc>) или SVG
 * вне <svg>. Такие смеси браузер при повторном разборе раскладывает иначе, чем при первом
 */
function misplacedElement(node: Element, parentNamespace: string | undefined) {
  if (node.namespaceURI === NS_MATHML) return true
  if (node.namespaceURI === NS_SVG) {
    return parentNamespace !== NS_SVG && node.tagName.toLowerCase() !== 'svg'
  }
  return parentNamespace === NS_SVG || parentNamespace === NS_MATHML
}

/**
 * Обёртка своего блока на странице — <div> (CustomBlock): разбор в том же контексте, что у
 * браузера, а не «где-то в body»
 */
const BLOCK_CONTEXT = parseFragment('<div></div>').childNodes[0] as Element

/** Сколько раз разбираем свой же вывод заново, пока разбор не перестанет менять дерево */
const PASSES_MAX = 3

/**
 * Очистка HTML после Liquid: разбор настоящим парсером HTML и сборка заново без запрещённых
 * элементов, обработчиков on* и опасных ссылок. Шаблон проверяют при сохранении, но ссылку
 * javascript: из текстового поля в href или атрибут, собранный {% if %}, видно только здесь.
 * Это граница защиты своих блоков.
 *
 * Одного разбора мало: собранный заново HTML браузер может разобрать иначе (мутационный XSS —
 * смена пространства имён SVG/MathML, и текст атрибута становится разметкой). Поэтому вывод
 * разбирается ещё раз так же, как его разберёт браузер (в <div>), и выдаётся только тот HTML,
 * повторный разбор которого очистка уже не меняет: дерево браузера проходит те же правила.
 * Не устоялось за PASSES_MAX кругов — блок не выводится вовсе.
 * trusted — адреса файлов медиатеки сайта: они могут быть абсолютными (медиа с адреса API), и
 * фильтр image выводит именно их; любой другой чужой адрес в src и srcset убирается
 */
export function sanitizeHtml(
  html: string,
  trusted?: ReadonlySet<string>,
  options: SanitizeOptions = {},
) {
  const { pageIds = [], ownId } = options
  // id блоков страницы (и их полей: «форма-имя») — якоря меню и подписи: копия в своём блоке
  // стояла бы раньше и перехватила бы их. «{{ block.id }}-имя» — свой, его можно
  const isTaken = (id: string) =>
    !(ownId !== undefined && id.startsWith(`${ownId}-`)) &&
    pageIds.some((one) => id === one || id.startsWith(`${one}-`))
  return untilStable(html, (input) => sanitizePass(input, trusted, isTaken))
}

/** Круг очистки: собранный HTML и сколько элементов, атрибутов и комментариев убрано */
export type SanitizePass = (html: string) => { html: string; removed: number }

/**
 * Очистка до неподвижной точки: выдаётся HTML, повторный разбор которого очистка уже не меняет
 * (removed = 0) — значит, дерево, которое из него построит браузер, проходит те же правила
 */
export function untilStable(html: string, pass: SanitizePass) {
  let output = pass(html).html
  for (let round = 0; round < PASSES_MAX; round++) {
    const again = pass(output)
    if (again.removed === 0) return output
    output = again.html
  }
  return ''
}

/** Один круг очистки: разбор в контексте блока, чистка, сборка. removed — сколько убрано */
function sanitizePass(
  html: string,
  trusted: ReadonlySet<string> | undefined,
  isTaken: (id: string) => boolean,
) {
  const fragment = parseFragment(BLOCK_CONTEXT, html, {})
  const counter = { removed: 0 }
  clean(fragment, undefined, trusted, isTaken, counter)
  const ids = new Set<string>()
  walkElements(fragment, (node) => {
    const id = node.attrs.find((attr) => attr.name === 'id')?.value
    if (id) ids.add(id)
  })
  walkElements(fragment, (node) => {
    const kept = node.attrs.filter(
      (attr) =>
        !ID_REFERENCE_ATTRIBUTES.has(attr.name.toLowerCase()) ||
        idsOf(attr.value).every((id) => ids.has(id)),
    )
    counter.removed += node.attrs.length - kept.length
    node.attrs = kept
  })
  return { html: serialize(fragment), removed: counter.removed }
}

type SanitizeOptions = {
  /** id блоков страницы: в своём блоке их нет, ни сами, ни с продолжением через «-» */
  pageIds?: readonly string[] | undefined
  /** id этого блока: «id-имя» внутри него — свои id шаблона ({{ block.id }}-имя) */
  ownId?: string | undefined
}

function walkElements(parent: ParentNode, visit: (node: Element) => void) {
  for (const node of parent.childNodes) {
    if (!isElement(node)) continue
    visit(node)
    walkElements(node, visit)
  }
}

function clean(
  parent: ParentNode,
  parentNamespace: string | undefined,
  trusted: ReadonlySet<string> | undefined,
  isTaken: (id: string) => boolean,
  counter: { removed: number },
) {
  const kept = parent.childNodes.filter((node) => {
    if (node.nodeName === '#comment') return false
    if (!isElement(node)) return true
    const tag = node.tagName.toLowerCase()
    if (FORBIDDEN_ELEMENTS.has(tag) || misplacedElement(node, parentNamespace)) return false
    const attrs = node.attrs.filter((attr) => {
      const name = attributeName(attr).toLowerCase()
      if (name === 'id' && isTaken(attr.value.trim())) return false
      return attributeProblem(tag, name, attr.value, trusted) === undefined
    })
    counter.removed += node.attrs.length - attrs.length
    node.attrs = attrs
    clean(node, node.namespaceURI, trusted, isTaken, counter)
    return true
  })
  counter.removed += parent.childNodes.length - kept.length
  parent.childNodes = kept
}

// Запасной разбор, если токенизатор LiquidJS отказал (незакрытый тег): шаблон всё равно не
// сохранится из-за ошибки Liquid, а маска нужна проверке HTML для понятных строк
const LIQUID_FALLBACK =
  /\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}|\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g

const NOT_CODE_FALLBACK =
  /\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}|\{%-?\s*raw\s*-?%\}[\s\S]*?\{%-?\s*endraw\s*-?%\}/g

/** Тег, который ничего не выполняет и не пишет: raw, endraw, комментарий, {% # … %} */
const SILENT_TAG_FALLBACK = /^\{%-?\s*(?:comment|raw|endraw|#)/

/** Замена той же длины, переводы строк на месте: номера строк и позиции не сдвигаются */
const blank = (text: string, fill: string) => text.replace(/[^\n]/g, fill)

/**
 * Срез пробелов вокруг тегов ({%- и -%}) в LiquidJS. Задаётся здесь один раз: движок (liquid.ts)
 * и проверка HTML обязаны читать его одинаково, иначе `h {%- … -%} ref` проверка видела бы двумя
 * атрибутами, а браузер получил бы один, `href`
 */
export const LIQUID_GREEDY = false

/**
 * Место вывода в тексте шаблона без Liquid: значение известно только при рендере. Символ из
 * области частного использования, записанный escape-последовательностью: самого символа в
 * исходнике не видно, при правке его легко потерять, и проверка молча перестала бы находить вывод.
 * Такой же символ в самом шаблоне заменяется на U+FFFD (`withoutMark`), иначе он сошёл бы за вывод
 */
const OUTPUT_MARK = '\uE000'

const withoutMark = (text: string) => text.replaceAll(OUTPUT_MARK, '\uFFFD')

/** Теги, которые что-то пишут в страницу: для проверки значения они — такой же вывод, как {{ }} */
const OUTPUT_TAGS: ReadonlySet<string> = new Set(['echo', 'liquid', 'increment', 'decrement'])

type Range = [number, number]

type LiquidScan = {
  masked: string
  /** Шаблон, где comment и raw (с тегами) вычеркнуты: в них нет кода Liquid */
  code: string
  /**
   * Все теги {% %}, в том числе немые, и комментарии целиком: рядом с именем атрибута они
   * склеили бы его из кусков
   */
  tags: Range[]
  /** Вывод {{ }} и теги, которые пишут в страницу (echo, liquid, increment, decrement) */
  outputs: Range[]
  /**
   * Что Liquid выполняет: вывод и все теги, кроме немых. Немые ничего не пишут и ничего не
   * делают: {% raw %} и {% endraw %} (текст между ними — настоящий текст), комментарии
   * {% comment %}…{% endcomment %} целиком и однострочные {% # … %}
   */
  live: Range[]
  /**
   * Что выведет LiquidJS, если не знать данных: HTML шаблона без тегов и без пробелов, которые
   * срезают {%- и -%}; ветки if, case и for идут подряд, вместо каждого вывода — OUTPUT_MARK.
   * `java{% comment %}x{% endcomment %}script:` и `h {%- if a -%}{% endif -%} ref` здесь уже
   * `javascript:` и `href`: так их соберёт Liquid и разберёт браузер
   */
  joined: string
  /** Для каждого символа joined — его позиция в шаблоне; в конце — длина шаблона */
  origin: number[]
}

/**
 * Разбор шаблона тем же токенизатором, что и рендер: границы raw, вывода и тегов совпадают с
 * LiquidJS дословно (аргументы raw, «%» в endraw, «{% # … %}», кавычки в выводе, срез пробелов).
 * Свой regexp расходился бы с ним, и разметка пряталась бы от проверки
 */
function scanLiquid(template: string): LiquidScan {
  const tags: Range[] = []
  const outputs: Range[] = []
  const live: Range[] = []
  const origin: number[] = []
  let commentFrom = -1
  let masked = ''
  let code = ''
  let joined = ''
  const put = (text: string, from: number) => {
    joined += text
    for (let i = 0; i < text.length; i++) origin.push(from + i)
  }
  try {
    const tokenizer = new Tokenizer(template)
    // Все токены сразу: так срез пробелов применяется к ним так же, как при рендере
    const tokens = tokenizer.readTopLevelTokens({ ...defaultOptions, greedy: LIQUID_GREEDY })
    let inRaw = false
    // Комментарии в LiquidJS не вложены: «comment» внутри ничего не открывает, первый endcomment
    // закрывает
    let inComment = false
    for (const token of tokens) {
      const text = template.slice(token.begin, token.end)
      if (token.kind === TokenKind.HTML) {
        // Внутри raw Liquid выводит текст как есть: разметка в нём — настоящая разметка страницы
        masked += inComment ? blank(text, ' ') : text
        code += inRaw || inComment ? blank(text, ' ') : text
        if (!inComment) {
          const { trimLeft, trimRight } = token as unknown as {
            trimLeft: number
            trimRight: number
          }
          put(
            withoutMark(template.slice(token.begin + trimLeft, token.end - trimRight)),
            token.begin + trimLeft,
          )
        }
        continue
      }
      const name = token.kind === TokenKind.Tag ? (token as TagToken).name : ''
      const range: Range = [token.begin, token.end]
      if (inRaw) {
        // Единственный токен-тег в режиме raw — endraw
        inRaw = false
        tags.push(range)
        masked += blank(text, ' ')
        code += blank(text, ' ')
      } else if (name === 'raw' && !inComment) {
        inRaw = true
        tags.push(range)
        masked += blank(text, ' ')
        code += blank(text, ' ')
      } else {
        if (name === 'comment' && !inComment) commentFrom = token.begin
        if (name === 'comment') inComment = true
        if (!inComment) {
          if (token.kind === TokenKind.Tag) {
            tags.push(range)
            if (name !== '#') live.push(range)
          } else {
            live.push(range)
          }
          if (token.kind === TokenKind.Output || OUTPUT_TAGS.has(name)) {
            outputs.push(range)
            put(OUTPUT_MARK, token.begin)
          }
        }
        const fill = token.kind === TokenKind.Output && !inComment ? 'x' : ' '
        masked += blank(text, fill)
        // raw внутри комментария токенизатор всё равно читает как raw: его текст — часть комментария
        code += inComment || name === 'endcomment' ? blank(text, ' ') : text
        if (name === 'endcomment') {
          inComment = false
          if (commentFrom >= 0) tags.push([commentFrom, token.end])
          commentFrom = -1
        }
      }
    }
    // Комментарий без endcomment — ошибка Liquid, шаблон не сохранится; для строк ошибок — до конца
    if (commentFrom >= 0) tags.push([commentFrom, template.length])
    origin.push(template.length)
    return { masked, code, tags, outputs, live, joined, origin }
  } catch {
    // Токенизатор отказал: маска как есть (теги — пробелы, вывод — «x»), позиции без сдвига
    const fallbackTags: Range[] = []
    const fallbackOutputs: Range[] = []
    const fallbackMasked = template.replace(LIQUID_FALLBACK, (part, offset: number) => {
      const range: Range = [offset, offset + part.length]
      fallbackTags.push(range)
      if (part.startsWith('{{')) fallbackOutputs.push(range)
      return blank(part, part.startsWith('{{') ? 'x' : ' ')
    })
    return {
      masked: fallbackMasked,
      code: template.replace(NOT_CODE_FALLBACK, (part) => blank(part, ' ')),
      tags: fallbackTags,
      outputs: fallbackOutputs,
      live: fallbackTags.filter(([start]) => !SILENT_TAG_FALLBACK.test(template.slice(start))),
      joined: fallbackMasked,
      origin: Array.from({ length: template.length + 1 }, (_, index) => index),
    }
  }
}

/**
 * Код Liquid шаблона для линтера: comment и raw (вместе с тегами) пробелами той же длины,
 * границы — как у LiquidJS и у проверки HTML
 */
export function liquidCode(template: string) {
  return scanLiquid(template).code
}

/**
 * Шаблон без Liquid: вывод {{ }} — буквами x (значение атрибута остаётся непустым), теги {% %}
 * и комментарии — пробелами. HTML вокруг (и внутри raw) остаётся на своих строках и колонках
 */
export function maskLiquid(template: string) {
  return scanLiquid(template).masked
}

/** Номер строки (с 1) по позиции в тексте: переводы строк считаются один раз, поиск двоичный */
function lineFinder(text: string) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return (offset: number) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if ((starts[middle] ?? 0) <= offset) low = middle
      else high = middle - 1
    }
    return low + 1
  }
}

/** Пересекается ли отрезок [from, to) хоть с одним из диапазонов */
const touches = (ranges: Range[], from: number, to: number) =>
  ranges.some(([start, end]) => start < to && end > from)

type Location = Element['sourceCodeLocation']

/** Место атрибута в тексте: у атрибутов с префиксом (xlink:href) ключ — полное имя */
function attributeLocation(
  location: Location,
  attr: { name: string; prefix?: string | undefined },
) {
  return location?.attrs?.[attributeName(attr)] ?? location?.attrs?.[attr.name]
}

/**
 * Вычисляет шаблон или кусок Liquid при пустых полях и возвращает выведенный текст (или undefined,
 * если не вышло): так константы шаблона — `{{ 'java' | append: 'script:' }}` и
 * `{{ x | default: '…' }}` — видны проверке адреса. Движок и лимиты у вычисления свои
 * (render.ts), поэтому оно передаётся снаружи. Дорогое: проверка зовёт его один раз на весь шаблон
 * (с метками вокруг выводов) и не больше EVALUATIONS_MAX раз на отдельные выражения
 */
export type LiquidEvaluate = (source: string) => string | undefined

/**
 * Фильтры, которые выводят готовый HTML мимо экранирования (raw: true в liquid.ts; тест сверяет
 * список с движком). В значении атрибута их кавычки закрыли бы его
 */
export const RAW_HTML_FILTERS = ['image', 'paragraphs', 'accent', 'newline_to_br'] as const

const RAW_FILTER_USE = new RegExp(`\\|\\s*(${RAW_HTML_FILTERS.join('|')})\\b`)

type CheckOptions = {
  evaluate?: LiquidEvaluate | undefined
  /**
   * Ставится в true, если проверка остановилась по времени: итог тогда зависит от нагрузки на
   * сервер, а не от шаблона, и запоминать его нельзя
   */
  timeLimit?: { hit: boolean } | undefined
  /** Лимит движка исчерпан: вычислять больше нечем, и значение адреса остаётся неизвестным */
  exhausted?: (() => boolean) | undefined
}

/**
 * Проверка HTML шаблона при сохранении: запрещённые элементы и атрибуты, опасные ссылки, вывод
 * {{ }} в атрибуте без кавычек (значение с пробелом добавило бы атрибуты) — ошибки со строкой.
 * Картинка без alt — предупреждение. h1 не предупреждаем: свой первый экран вправе его вывести,
 * а «несколько h1» скажет проверка SEO страницы.
 *
 * Разбирается не маска, а то, что выведет Liquid (`joined`): теги вычеркнуты вместе со срезом
 * пробелов, ветки if, case и for идут подряд. Поэтому имя атрибута и адрес, собранные из кусков
 * через любые теги, видны проверке такими, какими их увидит браузер. Атрибут, который браузер
 * отбросит как повтор (`{% if a %}href="/"{% else %}href="javascript:…"{% endif %}` — `href`
 * дважды), проверяется отдельно: парсер сообщает, где он (onParseError). Значение с выводом
 * известно только при рендере: при сохранении проверяется, с чего оно может начаться
 * (dynamicLinkProblem), а то, что соберут данные поля, чистит сайт (sanitizeHtml).
 *
 * Это подсказка автору, а не защита: полноты она не обещает (индекс от forloop, счётчики
 * increment, block.id и подобное без выполнения не вычислить). Граница защиты — sanitizeHtml при
 * каждом рендере (render-boundary.test.ts). Новые конструкции сюда не добавляем: каждая — риск
 * долгой проверки, а очистка их и так вырежет
 */
export function checkTemplateHtml(
  template: string,
  options: CheckOptions = {},
): CustomBlockProblem[] {
  const scan = scanLiquid(template)
  const { joined, origin, tags, outputs, live } = scan
  const problems: CustomBlockProblem[] = []
  const lineAt = lineFinder(template)
  const originOf = (offset: number) => origin[offset] ?? template.length
  const add = (level: CustomBlockProblem['level'], line: number | undefined, message: string) =>
    problems.push({ part: 'template', level, line, message })
  // Вычисления — только если есть вывод в адресе: первый вызов рендерит шаблон
  let valueState: ValueContext | undefined
  const values = () => {
    valueState ??= valueContext(
      template,
      scan,
      options.evaluate,
      options.timeLimit,
      options.exhausted,
    )
    return valueState
  }

  for (const match of template.matchAll(/<\/?\s*(?:[a-z][\w:-]*)?(?:\{\{|\{%)/gi)) {
    add(
      'error',
      lineAt(match.index),
      'Имя элемента не собирают из Liquid (и не приклеивают к нему вывод): <a {{ … }}> — с пробелом',
    )
  }

  let tooComplex = false
  // id элементов шаблона: на них ссылается значение, которое собрали теги (dynamicValueProblem)
  const ids = new Set<string>()
  const attributeWork = { left: ATTRIBUTE_WORK_MAX }
  // Повторы атрибута: парсер оставляет первый, остальные отбрасывает, но место сообщает
  const duplicates: number[] = []

  const checkAttribute = (
    tag: string,
    elementLine: number | undefined,
    name: string,
    value: string,
    attrLocation: { startOffset: number; endOffset: number } | undefined,
  ) => {
    const attrLine = attrLocation ? lineAt(originOf(attrLocation.startOffset)) : elementLine
    const start = attrLocation?.startOffset ?? 0
    const source = attrLocation ? joined.slice(start, attrLocation.endOffset) : ''
    // Где атрибут в шаблоне: от его первого символа до последнего, вместе с тегами между ними
    const from = originOf(start)
    const to = attrLocation ? originOf(attrLocation.endOffset - 1) + 1 : from
    const equals = source.indexOf('=')
    const nameLength = equals === -1 ? source.length : equals
    const nameTo = nameLength > 0 ? originOf(start + nameLength - 1) + 1 : from
    if (attrLocation && touches(tags, from, nameTo)) {
      // В маске теги были бы пробелами, и проверка видела бы два атрибута (`h` и `ref`), а
      // LiquidJS выведет один, `href`: так прячутся и href, и onerror
      add(
        'error',
        attrLine,
        'Тег Liquid вплотную к имени атрибута: имя склеилось бы из кусков. Отделите тег пробелом: Liquid — в значении или между атрибутами',
      )
      return
    }
    if (attrLocation && touches(outputs, from, nameTo)) {
      // Значение поля стало бы атрибутами (style, form, onclick…), а чистка видит только итог
      add('error', attrLine, 'Имя атрибута не собирают из Liquid: Liquid — только в значении')
      return
    }
    // Значение собрано Liquid: вывод или тег, который что-то выполняет. Комментарии, raw и
    // {% # %} ничего не выводят — значение известно целиком и проверяется как есть
    const dynamic = attrLocation !== undefined && touches(live, from, to)
    // Значение без кавычек — после первого «=» не кавычка. «==» внутри {% if a == b %} — не в счёт
    if (dynamic && /^[^=]*=\s*[^\s"']/.test(template.slice(from, to))) {
      add('error', attrLine, `Значение атрибута ${name} с Liquid — в кавычках: ${name}="{{ … }}"`)
    }
    if (dynamic) {
      // Фильтры с готовым HTML пишут кавычки: значение закрылось бы, а то, что проверка видит
      // текстом атрибута, стало бы разметкой
      const raw = live
        .filter(([start, end]) => start >= from && end <= to)
        .map(([start, end]) => RAW_FILTER_USE.exec(template.slice(start, end))?.[1])
        .find(Boolean)
      if (raw) {
        add(
          'error',
          attrLine,
          `Фильтр ${raw} выводит готовый HTML с кавычками: в значении атрибута ${name} он закрыл бы значение. Ставьте его между элементами, адрес картинки даёт image_url`,
        )
      }
    }
    const problem =
      attributeProblem(tag, name, dynamic ? undefined : value) ??
      (dynamic
        ? (dynamicLinkProblem(values(), name, valueSpan(source, start), [from, to]) ??
          dynamicValueProblem(
            values(),
            { tag, name, ids, hasOutput: touches(outputs, from, to), work: attributeWork },
            valueSpan(source, start),
            [from, to],
          ))
        : undefined)
    // Бюджет проверки один на шаблон: когда он кончился, «слишком хитро» — про весь шаблон, а не
    // про каждый из тысячи адресов
    if (problem?.includes('собран слишком хитро')) {
      if (tooComplex) return
      tooComplex = true
    }
    if (problem) add('error', attrLine, problem)
  }

  const visit = (parent: ParentNode) => {
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue
      const location = node.sourceCodeLocation
      const line = location ? lineAt(originOf(location.startOffset)) : undefined
      const tag = node.tagName.toLowerCase()
      if (FORBIDDEN_ELEMENTS.has(tag)) {
        add('error', line, forbiddenElementMessage(tag))
        continue
      }
      if (tag === 'img' && !node.attrs.some((attr) => attr.name === 'alt')) {
        add('warning', line, 'У картинки нет alt: возьмите фильтр image — он ставит alt из поля')
      }
      for (const attr of node.attrs) {
        checkAttribute(
          tag,
          line,
          attributeName(attr).toLowerCase(),
          attr.value,
          attributeLocation(location, attr),
        )
      }
      const startTag = location?.startTag
      for (const offset of duplicates) {
        if (!startTag || offset < startTag.startOffset || offset >= startTag.endOffset) continue
        const dropped = droppedAttribute(joined, offset)
        checkAttribute(tag, line, dropped.name, dropped.value, dropped.location)
      }
      visit(node)
    }
  }
  const tree = parseFragment(joined, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (error.code === 'duplicate-attribute') duplicates.push(error.startOffset)
    },
  })
  walkElements(tree, (node) => {
    const id = node.attrs.find((attr) => attr.name === 'id')?.value
    if (id) ids.add(id)
  })
  visit(tree)
  checkIdReferences(
    tree,
    {
      lineAt: (offset) => lineAt(originOf(offset)),
      hasLiquid: (start, end) => touches(live, originOf(start), originOf(end - 1) + 1),
    },
    add,
  )
  return problems
}

/** Текст значения атрибута, как его прочтёт браузер: &#106; — «j» */
function decodeAttributeText(text: string) {
  const fragment = parseFragment(`<i a="${text.replaceAll('"', '&quot;')}">`)
  const element = fragment.childNodes[0]
  return element && isElement(element) ? (element.attrs[0]?.value ?? text) : text
}

/**
 * Отброшенный как повтор атрибут: парсер сообщает место на конце его имени (на «=» или пробеле),
 * значение читается отсюда же. Имя — назад до разделителя, значение — вперёд: в кавычках или до
 * пробела, как в HTML
 */
function droppedAttribute(joined: string, nameEnd: number) {
  let start = nameEnd
  while (start > 0 && !/[\s"'<>/=]/.test(joined[start - 1] ?? ' ')) start--
  const rest = /^\s*=\s*(?:"([^"]*)"?|'([^']*)'?|([^\s>]*))/.exec(joined.slice(nameEnd))
  const raw = rest ? (rest[1] ?? rest[2] ?? rest[3] ?? '') : ''
  return {
    name: joined.slice(start, nameEnd).toLowerCase(),
    value: decodeAttributeText(raw.replaceAll(OUTPUT_MARK, 'x')),
    location: { startOffset: start, endOffset: nameEnd + (rest ? rest[0].length : 0) },
  }
}

/** Где в тексте атрибута (joined) его значение: без имени, «=» и кавычек */
function valueSpan(source: string, start: number): Range {
  const equals = source.indexOf('=')
  if (equals === -1) return [start + source.length, start + source.length]
  let at = equals + 1
  while (/\s/.test(source[at] ?? '')) at++
  const quote = source[at] === '"' || source[at] === "'" ? source[at] : undefined
  const closed = quote !== undefined && source.length > at + 1 && source.endsWith(quote)
  return [start + at + (quote ? 1 : 0), start + source.length - (closed ? 1 : 0)]
}

/**
 * Что выведет готовая страница: всё, что очистка сайта (sanitizeHtml) вырежет, — сообщения для
 * редактора. Это пробный рендер на примере и на пустых полях: константы шаблона
 * (`{% assign u = 'javascript:…' %}`, строки в фильтрах) и данные примера видны только в
 * выведенном HTML. Правила те же, что у очистки (запрещённые элементы, on*, ссылки, url()),
 * кроме id: у блока в примере id вымышленный, а занятые id очистка убирает по странице
 */
export function renderedProblems(html: string): string[] {
  const found = new Set<string>()
  const visit = (parent: ParentNode, parentNamespace: string | undefined) => {
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue
      const tag = node.tagName.toLowerCase()
      if (FORBIDDEN_ELEMENTS.has(tag)) {
        found.add(forbiddenElementMessage(tag))
        continue
      }
      if (misplacedElement(node, parentNamespace)) {
        found.add(
          `<${tag}> внутри <svg> недоступен: смесь SVG и HTML браузер разбирает иначе, чем при сохранении. Внутри <svg> — только элементы SVG`,
        )
        continue
      }
      for (const attr of node.attrs) {
        const name = attributeName(attr).toLowerCase()
        if (name === 'id') continue
        const problem = attributeProblem(tag, name, attr.value)
        if (problem) found.add(problem)
      }
      visit(node, node.namespaceURI)
    }
  }
  visit(parseFragment(BLOCK_CONTEXT, html, {}), undefined)
  return [...found]
}

/** Теги, внутри которых текст выводится не всегда (ветка, цикл) или не выводится вовсе (capture) */
const BRANCH_TAGS: ReadonlySet<string> = new Set(['if', 'unless', 'case', 'for', 'capture'])

/** Теги, которые начинают следующую ветку блока */
const BRANCH_SEPARATORS: ReadonlySet<string> = new Set(['else', 'elsif', 'when'])

const tagNameAt = (template: string, start: number) =>
  /^\{%-?\s*([\w#-]+)/.exec(template.slice(start, start + 40))?.[1]

/**
 * Метки вокруг вывода при вычислении: один рендер шаблона на пустых полях отдаёт значения всех
 * выводов сразу (а не рендер на каждый вывод). Символы частного использования, как OUTPUT_MARK
 */
const MARK_START = '\uE001'
const MARK_SEP = '\uE002'
const MARK_END = '\uE003'

/** Шаблон с метками вокруг каждого вывода: номер вывода — в порядке `outputs` */
function withOutputMarks(template: string, outputs: Range[]) {
  const clean = template.replace(/[\uE000-\uE003]/g, '�')
  let result = ''
  let last = 0
  outputs.forEach(([start, end], index) => {
    result += `${clean.slice(last, start)}${MARK_START}${index}${MARK_SEP}${clean.slice(start, end)}${MARK_END}`
    last = end
  })
  return result + clean.slice(last)
}

/** Значения выводов из текста с метками: номер вывода → что он выдал (в цикле — по разу за шаг) */
function markedValues(text: string) {
  const found = new Map<number, Set<string>>()
  const stack: { index: number; text: string }[] = []
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === MARK_START) {
      let end = i + 1
      while (end < text.length && text[end] !== MARK_SEP) end++
      stack.push({ index: Number(text.slice(i + 1, end)), text: '' })
      i = end
    } else if (char === MARK_END) {
      const frame = stack.pop()
      if (!frame) continue
      const values = found.get(frame.index) ?? new Set<string>()
      if (values.size < MARKED_VALUES_MAX) values.add(frame.text.slice(0, OPTION_LENGTH))
      found.set(frame.index, values)
      const parent = stack[stack.length - 1]
      if (parent) parent.text += frame.text
    } else {
      const top = stack[stack.length - 1]
      if (top) top.text += char
    }
  }
  return found
}

/** Сколько вычислений выражений по одному (assign, строки echo) позволяет одна проверка */
const EVALUATIONS_MAX = 200
/** И сколько времени на них: каждое вычисление ограничено движком, но их сумма — нет */
const EVALUATIONS_MS = 300
/** Сколько значений одного вывода при цикле, сколько вариантов у одного вывода и какой они длины */
const MARKED_VALUES_MAX = 50
const OPTIONS_MAX = 200
const OPTION_LENGTH = 400
/** Варианты одной переменной, сочетания одного определения и круги до неподвижной точки */
const CANDIDATES_MAX = 16
const COMBINATIONS_MAX = 24
const ROUNDS_MAX = 8
/**
 * Сколько работы (символ значения × состояние) позволяет обход значений на весь шаблон. Цена —
 * выводы × варианты × длина × состояния, и без общего предела её растят шаблоном в 20 000 знаков
 * до минут. Обычный шаблон тратит тысячи единиц, предел — десятые доли секунды
 */
const WORK_MAX = 200_000
/** Своя работа на значения не-адресных атрибутов (tabindex, id, url()): адресам она не вредит */
const ATTRIBUTE_WORK_MAX = 60_000

/**
 * Первый аргумент replace, remove, split и справа от contains — что искать, а не что вывести:
 * `replace: 'javascript:', ''` убирает схему, а не пишет её
 */
const SEARCH_ARGUMENT =
  /(?:\b(?:replace|replace_first|replace_last|remove|remove_first|remove_last|split)\s*:\s*|\bcontains\s+)$/

/** Строки в кавычках из выражения Liquid, которые могут попасть в вывод */
function literalsOf(expression: string) {
  const found: string[] = []
  for (const match of expression.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    if (SEARCH_ARGUMENT.test(expression.slice(0, match.index))) continue
    const text = match[1] ?? match[2] ?? ''
    if (text !== '') found.push(text)
  }
  return found
}

const LIQUID_WORDS: ReadonlySet<string> = new Set([
  'true',
  'false',
  'nil',
  'null',
  'blank',
  'empty',
  'and',
  'or',
  'contains',
])

/** Переменные, на которые ссылается выражение (корни путей; имена фильтров и строки — нет) */
function identifiersOf(expression: string) {
  const code = expression.replace(/'[^']*'|"[^"]*"/g, ' ').replace(/\|\s*[\w-]+/g, ' ')
  // Без повторов: иначе выражение с одной переменной в нескольких местах множит обход
  return [
    ...new Set(
      [...code.matchAll(/(?<![.\w-])[A-Za-z_][\w-]*/g)]
        .map((match) => match[0])
        .filter((word) => !LIQUID_WORDS.has(word)),
    ),
  ]
}

/** Строки тега `{% liquid %}`: без пустых и комментариев */
const liquidLines = (body: string) =>
  body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))

/** Тело тега без скобок и срезов пробелов: `assign x = y` */
const tagInner = (source: string) => source.replace(/^\{%-?\s*/, '').replace(/\s*-?%\}$/, '')

/** Чем может быть заполнена переменная: выражения, значение которых в неё идёт, и тело capture */
type Definition = {
  expressions: string[]
  /** Тело capture в шаблоне */
  body?: Range
  /** Переменная цикла: выражения — коллекции */
  loop?: boolean
  /** capture внутри {% liquid %}: выражения — строки echo в его теле */
  capture?: boolean
}

/**
 * Все места, где шаблон задаёт переменную: assign, переменная цикла for (её значение — из
 * коллекции) и capture (тело — диапазон в шаблоне), в том числе строки `{% liquid %}`. Порядок и
 * ветки не учитываются: любое из значений могло оказаться в переменной
 */
function definitionsOf(template: string, live: Range[]) {
  const definitions = new Map<string, Definition[]>()
  const add = (name: string, definition: Definition) => {
    const list = definitions.get(name) ?? []
    list.push(definition)
    definitions.set(name, list)
  }
  const statement = (inner: string) => {
    const assign = /^assign\s+([\w-]+)\s*=\s*([\s\S]*)$/.exec(inner)
    if (assign) add(assign[1] as string, { expressions: [assign[2] as string] })
    const loop = /^for\s+([\w-]+)\s+in\s+([\s\S]*)$/.exec(inner)
    if (loop) add(loop[1] as string, { expressions: [loop[2] as string], loop: true })
  }
  for (let i = 0; i < live.length; i++) {
    const [start, end] = live[i] ?? [0, 0]
    const name = tagNameAt(template, start)
    const inner = tagInner(template.slice(start, end))
    if (name === 'assign' || name === 'for') {
      statement(inner)
    } else if (name === 'capture') {
      const variable = /^capture\s+['"]?([\w-]+)/.exec(inner)?.[1]
      let depth = 0
      for (let j = i + 1; variable && j < live.length; j++) {
        const [from] = live[j] ?? [0, 0]
        const other = tagNameAt(template, from)
        if (other === 'capture') depth++
        if (other === 'endcapture' && depth-- === 0) {
          add(variable, { expressions: [], body: [end, from] })
          break
        }
      }
    } else if (name === 'liquid') {
      // Внутри {% liquid %} тело capture — строки echo между capture и endcapture
      let open: { name: string; definition: Definition } | undefined
      for (const line of liquidLines(inner.replace(/^liquid\b/, ''))) {
        const capture = /^capture\s+['"]?([\w-]+)/.exec(line)
        if (capture) {
          open = { name: capture[1] as string, definition: { expressions: [], capture: true } }
        } else if (line === 'endcapture') {
          if (open) add(open.name, open.definition)
          open = undefined
        } else if (open && /^echo\b/.test(line)) {
          open.definition.expressions.push(line.replace(/^echo\s*/, ''))
        } else {
          statement(line)
        }
      }
    }
  }
  return definitions
}

/** Выражения, которые вывод или тег пишет в страницу: `{{ x | f }}`, `echo x`, echo в liquid */
function outputExpressions(source: string) {
  const output = /^\{\{-?([\s\S]*?)-?\}\}$/.exec(source)
  if (output) return [output[1] as string]
  const inner = tagInner(source)
  if (/^echo\b/.test(inner)) return [inner.replace(/^echo\s*/, '')]
  if (/^liquid\b/.test(inner)) {
    return liquidLines(inner.replace(/^liquid\b/, ''))
      .filter((line) => /^echo\b/.test(line))
      .map((line) => line.replace(/^echo\s*/, ''))
  }
  return []
}

type ValueContext = {
  template: string
  scan: LiquidScan
  /** Что может быть на месте вывода, кроме «ничего»: вычисленное значение и константы шаблона */
  optionsOf: (range: Range) => string[]
  /** Позиция в joined по позиции в шаблоне */
  joinedIndex: (offset: number) => number
  /** Работа обхода значений на весь шаблон, что осталась; меньше нуля — не дошли до конца */
  work: { left: number }
  /** Нужное вычисление пропущено (бюджет кончился): значение выбранного адреса неизвестно */
  skipped: { total: number; flag: boolean }
}

/**
 * Текст из шаблона на месте вывода: `{{ }}` экранирует «&», поэтому `javascript&#58;` в capture
 * или строке на странице станет безобидным `javascript&amp;#58;`. Уже экранированное (результат
 * вычисления) экранируется ещё раз: безопаснее оно только становится
 */
const escaped = (found: readonly string[]) => found.map((value) => value.replaceAll('&', '&amp;'))

const SPACES = /[\s\p{Cc}]+/gu

/** Вариант значения для проверки адреса: пробелы сжаты (в адресе их нет), длина ограничена */
const compactOptions = (found: readonly string[]) =>
  [...new Set(found.map((value) => value.replace(SPACES, ' ').slice(0, OPTION_LENGTH)))]
    .filter((value) => value.trim() !== '')
    .slice(0, OPTIONS_MAX)

/** Текст из шаблона без знаков-меток: метки в нём не должны путать разбор вычисленного */
const withoutMarks = (text: string) => text.replace(/[\uE000-\uE003]/g, '\uFFFD').trim()

/** Строка в кавычках для `{% assign %}`: в Liquid у неё нет экранирования */
const quoted = (text: string) =>
  !text.includes("'") ? `'${text}'` : !text.includes('"') ? `"${text}"` : undefined

/**
 * Что может оказаться на месте вывода, пока данных полей не знаем. Источники:
 * 1. значение при пустых полях: шаблон один раз рендерится с метками вокруг выводов — assign,
 *    capture и условия выполнены так, как при пустых полях;
 * 2. константы шаблона без вычисления условий: строки в кавычках выражения и всех assign, for и
 *    capture, из которых оно собрано (по переменным, в том числе из другой ветки и из
 *    `{% liquid %}`), и то, что дают фильтры над одной константой (по одному вычислению
 *    выражения, пока хватает бюджета: число и время ограничены, одно вычисление стоит до 200 мс);
 * 3. тело capture целиком: текст и вывод в нём, ветки if — каждая отдельно;
 * 4. значения переменных до неподвижной точки (settle): варианты каждой переменной — вычисление
 *    каждого её определения при каждом сочетании уже известных вариантов переменных в нём (или
 *    без них: ветка мимо) — круг за кругом, пока появляются новые. Алиас, цепочка фильтров,
 *    capture и переменная цикла в ветке доходят до вывода сколько бы шагов ни было. Вариантов,
 *    сочетаний и кругов не больше пределов; не сошлось или не уместилось — переменная
 *    «неполная» (unsettled), и вывод, который от неё зависит, получает «слишком хитро».
 * Условия не вычисляются: ветка, мимо которой идут пример и пустые поля, считается выполненной.
 * Если нужное вычисление не уместилось в бюджет, `skipped.flag` — значение адреса неизвестно, и
 * проверка отвечает «слишком хитро», а не молчит
 */
function valueContext(
  template: string,
  scan: LiquidScan,
  evaluate: LiquidEvaluate | undefined,
  timeLimit?: { hit: boolean },
  exhausted?: () => boolean,
): ValueContext {
  const definitions = definitionsOf(template, scan.live)
  const marked =
    evaluate && scan.outputs.length > 0
      ? (() => {
          const text = evaluate(withOutputMarks(template, scan.outputs))
          return text === undefined ? new Map<number, Set<string>>() : markedValues(text)
        })()
      : new Map<number, Set<string>>()
  const indexOfStart = new Map(scan.outputs.map(([start], index) => [start, index]))
  const skipped = { total: 0, flag: false }
  const work = { left: WORK_MAX }
  const budget = { left: EVALUATIONS_MAX, until: Date.now() + EVALUATIONS_MS }
  const evaluated = new Map<string, string | undefined>()
  const evaluateOne = (source: string) => {
    if (!evaluate) return undefined
    if (evaluated.has(source)) return evaluated.get(source)
    // Движок упёрся в лимит: вычислять нечем, а молчать нельзя — значение адреса неизвестно
    if (exhausted?.()) {
      skipped.total++
      skipped.flag = true
      return undefined
    }
    const late = Date.now() > budget.until
    if (budget.left <= 0 || late) {
      if (late && timeLimit) timeLimit.hit = true
      skipped.total++
      skipped.flag = true
      return undefined
    }
    budget.left--
    const value = evaluate(source)
    evaluated.set(source, value)
    return value
  }
  // Что-то из пропущенного внутри вычисления: и свежее, и прочитанное из кеша (оно ставит флаг)
  const tracked = <Value>(compute: () => Value) => {
    const outer = skipped.flag
    skipped.flag = false
    const value = compute()
    const any = skipped.flag
    skipped.flag = outer || any
    return { value, any }
  }
  // Результат с пометкой, что при нём что-то пропущено: повторное чтение из кеша тоже «хитрое»
  const remember = <Key, Value>(
    cache: Map<Key, { value: Value; skipped: boolean }>,
    key: Key,
    compute: () => Value,
  ) => {
    const hit = cache.get(key)
    if (hit) {
      if (hit.skipped) skipped.flag = true
      return hit.value
    }
    const { value, any } = tracked(compute)
    cache.set(key, { value, skipped: any })
    return value
  }
  const literalOptions = (expression: string) => {
    const literals = literalsOf(expression)
    const found = [...literals]
    // append и prepend складывают строки: порядок слева направо и справа налево
    if (literals.length > 1) found.push(literals.join(''), [...literals].reverse().join(''))
    return found
  }
  const expressionCache = new Map<string, { value: string[]; skipped: boolean }>()
  const expressionOptions = (expression: string) =>
    remember(expressionCache, expression, () => {
      const found = literalOptions(expression)
      const value = evaluateOne(`{{ ${expression.trim()} }}`)
      if (value) found.push(value)
      return found
    })
  // Сколько раз обход упёрся в вычисление, которое уже идёт (цикл через capture): такой
  // результат неполон и не запоминается
  let cut = 0
  const resolving = new Set<string>()
  const computingLocal = new Set<string>()
  const localCache = new Map<string, { value: string[]; skipped: boolean }>()
  /** Варианты, которые дают определения самой переменной (без тех, на которые они опираются) */
  const localOf = (name: string): string[] => {
    const hit = localCache.get(name)
    if (hit) {
      if (hit.skipped) skipped.flag = true
      return hit.value
    }
    if (computingLocal.has(name)) {
      cut++
      return []
    }
    computingLocal.add(name)
    const before = cut
    const { value, any } = tracked(() => {
      const found: string[] = []
      for (const definition of definitions.get(name) ?? []) {
        for (const expression of definition.expressions) {
          found.push(...expressionOptions(expression))
        }
        if (definition.body) found.push(...captureOptions(definition.body))
      }
      return found
    })
    computingLocal.delete(name)
    if (cut === before) localCache.set(name, { value, skipped: any })
    return value
  }
  const resolveCache = new Map<string, { value: string[]; skipped: boolean }>()
  /**
   * Всё, чем может быть переменная: варианты её определений и переменных, от которых они зависят,
   * сколько бы шагов ни было. Обход один по графу (каждая переменная один раз), и результат
   * запоминается на любой глубине: цепочка assign, где каждый шаг ссылается на предыдущий
   * дважды, не растёт степенью двойки. Каждая посещённая переменная списывается с общей работы
   */
  function resolve(name: string): string[] {
    if (!definitions.has(name)) return []
    // Переменная, которая ссылается сама на себя через capture, второй раз не раскрывается
    if (resolving.has(name)) {
      cut++
      return []
    }
    const hit = resolveCache.get(name)
    if (hit) {
      if (hit.skipped) skipped.flag = true
      return hit.value
    }
    const before = cut
    resolving.add(name)
    const { value, any } = tracked(() => {
      const found: string[] = []
      const seen = new Set([name])
      const queue = [name]
      for (let i = 0; i < queue.length && found.length < OPTIONS_MAX; i++) {
        work.left -= 1
        if (work.left < 0) break
        const current = queue[i] as string
        found.push(...localOf(current))
        for (const definition of definitions.get(current) ?? []) {
          for (const expression of definition.expressions) {
            for (const other of identifiersOf(expression)) {
              if (definitions.has(other) && !seen.has(other)) {
                seen.add(other)
                queue.push(other)
              }
            }
          }
        }
      }
      return found.slice(0, OPTIONS_MAX)
    })
    resolving.delete(name)
    if (cut === before) resolveCache.set(name, { value, skipped: any })
    return value
  }
  const capturedCache = new Map<number, { value: string[]; skipped: boolean }>()
  const captureOptions = (body: Range) =>
    remember(capturedCache, body[0], () => {
      const nodes = valueTree(
        context,
        [context.joinedIndex(body[0]), context.joinedIndex(body[1])],
        body,
      )
      const { states } = walkValue(nodes, new Set(['']), appendFeed, work)
      return [...states].filter(Boolean)
    })
  // --- Значения переменных до неподвижной точки (см. описание valueContext, пункт 4) ---
  type Candidate = { prelude: string; value: string }
  /** Варианты переменной: как её задать перед вычислением (prelude) и что она при этом выводит */
  const candidates = new Map<string, Candidate[]>()
  /** Растёт с каждым новым вариантом: по нему кеши, зависящие от вариантов, считаются заново */
  let version = 0
  /** Переменные, чьи варианты могут быть неполны: бюджет, лимит вариантов, нет неподвижной точки */
  const unsettled = new Set<string>()
  const changedNow = new Set<string>()
  const definedIn = (expression: string) =>
    identifiersOf(expression).filter((id) => definitions.has(id))
  /** Сочетания значений переменных: каждая либо не задана (ветка мимо), либо один из вариантов */
  const combinations = (names: readonly string[]) => {
    let preludes = ['']
    let truncated = false
    for (const name of names) {
      const list = candidates.get(name) ?? []
      if (list.length === 0) continue
      const next: string[] = []
      for (const prelude of preludes) {
        next.push(prelude)
        for (const one of list) next.push(prelude + one.prelude)
      }
      truncated ||= next.length > COMBINATIONS_MAX
      preludes = next.slice(0, COMBINATIONS_MAX)
    }
    return { preludes, truncated }
  }
  const markUnsettled = (names: readonly string[]) => {
    for (const name of names) unsettled.add(name)
  }
  /** Вычисление, которое не состоялось из-за бюджета, делает переменную неполной */
  const settleEval = (source: string, name: string) => {
    const before = skipped.total
    const value = evaluateOne(source)
    // Не вычислилось (ошибка движка, лимит): что в переменной, неизвестно
    if (skipped.total !== before || (value === undefined && evaluate)) unsettled.add(name)
    return value
  }
  /**
   * Вариант как строка для `{% assign %}`. Теги и вывод внутри строки токенизатор LiquidJS
   * читает раньше кавычек (`'a%}b'` обрывается на «%}»), поэтому такой вариант подставить нельзя:
   * переменная неполная
   */
  const literalFor = (name: string, text: string) => {
    const literal = /\{[{%]|[}%]\}/.test(text) ? undefined : quoted(withoutMarks(text))
    if (literal === undefined) unsettled.add(name)
    return literal
  }
  const addCandidate = (name: string, prelude: string, value: string) => {
    // Пустое значение — то же, что «не задана»: такое сочетание уже есть
    if (value.trim() === '') return
    const list = candidates.get(name) ?? []
    if (list.some((one) => one.value === value)) return
    if (list.length >= CANDIDATES_MAX) {
      unsettled.add(name)
      return
    }
    list.push({ prelude, value })
    candidates.set(name, list)
    version++
    changedNow.add(name)
  }
  const overCache = new Map<string, { value: string[]; skipped: boolean }>()
  /** Что выводит выражение при известных вариантах переменных в нём: каждое сочетание считается */
  const outputsOver = (expression: string) =>
    remember(overCache, `${version}\0${expression}`, () => {
      const names = [...new Set(definedIn(expression))]
      if (names.length === 0) return []
      const found = names.flatMap((name) => (candidates.get(name) ?? []).map((one) => one.value))
      if (/^[\w-]+$/.test(expression.trim())) return found
      const { preludes, truncated } = combinations(names)
      if (truncated) markUnsettled(names)
      for (const prelude of preludes) {
        const before = skipped.total
        const value = evaluateOne(`${prelude}{{ ${withoutMarks(expression)} }}`)
        // С подстановкой не вычислилось (теги в тексте варианта, ошибка движка): значение неизвестно
        if (skipped.total !== before || (value === undefined && evaluate)) markUnsettled(names)
        if (value) found.push(value)
      }
      return found
    })
  /** Значения вывода внутри вычисления неподвижной точки: без кешей обычного обхода */
  const settleOptions = ([start, end]: Range) => {
    const known = marked.get(indexOfStart.get(start) ?? -1)
    const found = [...(known ?? [])]
    for (const expression of outputExpressions(template.slice(start, end))) {
      found.push(...escaped(literalOptions(expression)), ...escaped(outputsOver(expression)))
      if (!known) {
        const value = evaluateOne(`{{ ${expression.trim()} }}`)
        if (value) found.push(value)
      }
    }
    return compactOptions(found)
  }
  const settleCaptured = new Map<string, { value: string[]; skipped: boolean }>()
  /** Тела capture, чей обход не уместился: их варианты неполны */
  const cutBodies = new Set<number>()
  const settleCapture = (body: Range) =>
    remember(settleCaptured, `${version}\0${body[0]}`, () => {
      const inner: ValueContext = { ...context, optionsOf: settleOptions }
      const nodes = valueTree(
        inner,
        [context.joinedIndex(body[0]), context.joinedIndex(body[1])],
        body,
      )
      const walked = walkValue(nodes, new Set(['']), appendFeed, work)
      if (walked.overflow) cutBodies.add(body[0])
      return [...walked.states].filter(Boolean)
    })
  const settleExpression = (expression: string) => [
    ...literalOptions(expression),
    ...expressionOptions(expression),
    ...outputsOver(expression),
  ]
  const settleStep = (name: string, definition: Definition) => {
    if (definition.loop) {
      for (const collection of definition.expressions) {
        const { preludes, truncated } = combinations(definedIn(collection))
        if (truncated) unsettled.add(name)
        for (const prelude of preludes) {
          const text = settleEval(
            `${prelude}{% for ${name} in ${withoutMarks(collection)} %}{{ ${name} }}${MARK_SEP}{% endfor %}`,
            name,
          )
          for (const item of (text ?? '').split(MARK_SEP).slice(0, MARKED_VALUES_MAX)) {
            if (item.trim() === '') continue
            const literal = literalFor(name, item)
            if (literal) addCandidate(name, `{% assign ${name} = ${literal} %}`, item)
          }
        }
      }
    } else if (definition.body || definition.capture) {
      const texts = definition.body
        ? settleCapture(definition.body)
        : definition.expressions.flatMap(settleExpression)
      // Обрезанный вариант (appendFeed, compactOptions) — не весь текст: хвост мог решить дело
      if (texts.some((text) => text.replace(SPACES, ' ').length >= OPTION_LENGTH)) {
        unsettled.add(name)
      }
      if (definition.body && cutBodies.has(definition.body[0])) unsettled.add(name)
      for (const text of compactOptions(texts)) {
        const literal = literalFor(name, text)
        if (literal) addCandidate(name, `{% assign ${name} = ${literal} %}`, text)
      }
    } else {
      for (const expression of definition.expressions) {
        const { preludes, truncated } = combinations(definedIn(expression))
        if (truncated) unsettled.add(name)
        for (const prelude of preludes) {
          const assign = `${prelude}{% assign ${name} = ${withoutMarks(expression)} %}`
          const value = settleEval(`${assign}{{ ${name} }}`, name)
          if (value) addCandidate(name, assign, value)
        }
      }
    }
  }
  let settled = false
  /**
   * Варианты значений переменных шаблона до неподвижной точки: на каждом круге каждое определение
   * считается при каждом сочетании уже известных вариантов переменных, на которые оно ссылается
   * (или без них: ветка могла пройти мимо). Так алиас, цепочка фильтров, capture и переменная
   * цикла в ветке доходят до адреса, сколько бы шагов ни было. Не сошлось, кончился бюджет или
   * вариантов слишком много — переменная и всё, что от неё зависит, «неполная»
   */
  const settle = () => {
    if (settled) return
    settled = true
    // Идёт из проверки адреса: что в ней уже пропущено, не наше
    const outer = skipped.flag
    let converged = false
    for (let round = 0; round < ROUNDS_MAX && work.left >= 0; round++) {
      changedNow.clear()
      for (const [name, list] of definitions) {
        for (const definition of list) settleStep(name, definition)
      }
      if (changedNow.size === 0) {
        converged = true
        break
      }
    }
    if (!converged) markUnsettled([...changedNow])
    skipped.flag = outer
  }
  const varDeps = new Map<string, string[]>()
  const dependenciesOf = (name: string) => {
    const known = varDeps.get(name)
    if (known) return known
    const found = new Set<string>()
    for (const definition of definitions.get(name) ?? []) {
      for (const expression of definition.expressions) {
        for (const id of definedIn(expression)) found.add(id)
      }
      if (definition.body) {
        const [from, to] = definition.body
        for (const [start, end] of scan.outputs) {
          if (start < from || start >= to) continue
          for (const expression of outputExpressions(template.slice(start, end))) {
            for (const id of definedIn(expression)) found.add(id)
          }
        }
      }
    }
    const list = [...found]
    varDeps.set(name, list)
    return list
  }
  const reachesUnsettled = (names: readonly string[]) => {
    const seen = new Set<string>()
    const stack = [...names]
    while (stack.length > 0) {
      const name = stack.pop() as string
      if (seen.has(name)) continue
      seen.add(name)
      if (unsettled.has(name)) return true
      stack.push(...dependenciesOf(name))
    }
    return false
  }
  /** Что выводит выражение над переменными шаблона: по вариантам из неподвижной точки */
  const derived = (expression: string) => {
    const names = definedIn(expression)
    if (names.length === 0) return []
    settle()
    if (reachesUnsettled(names)) skipped.flag = true
    return outputsOver(expression)
  }
  const optionsOf = ([start, end]: Range) => {
    const known = marked.get(indexOfStart.get(start) ?? -1)
    const found = [...(known ?? [])]
    for (const expression of outputExpressions(template.slice(start, end))) {
      found.push(...escaped(literalOptions(expression)))
      // Значение на месте вывода при пустых полях уже есть; нет его — ветка мимо этого рендера
      if (!known) {
        const value = evaluateOne(`{{ ${expression.trim()} }}`)
        if (value) found.push(value)
      }
      found.push(
        ...escaped(identifiersOf(expression).flatMap(resolve)),
        ...escaped(derived(expression)),
      )
    }
    return compactOptions(found)
  }
  const joinedIndex = (offset: number) => {
    const { origin } = scan
    let low = 0
    let high = origin.length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if ((origin[middle] ?? 0) >= offset) high = middle
      else low = middle + 1
    }
    return low
  }
  const context: ValueContext = { template, scan, optionsOf, joinedIndex, work, skipped }
  return context
}

type ValueNode =
  | { kind: 'text'; text: string }
  | { kind: 'output'; options: () => string[] }
  | { kind: 'block'; repeat: boolean; branches: ValueNode[][] }

/**
 * Значение атрибута как дерево: текст, вывод (с вариантами) и блоки if, unless, case, for,
 * capture с ветками. `window` — диапазон в шаблоне, чьи теги читаются: у атрибута это он сам
 * целиком (закрывающие теги за значением тоже), у capture — его тело. Текст оставлен как в
 * шаблоне: сущность может быть разорвана блоками (`&#{% if a %}106{% endif %};`), её разбирает
 * тот, кто идёт по значению (`step`)
 */
function valueTree(context: ValueContext, [from, to]: Range, [windowFrom, windowTo]: Range) {
  const { template, scan } = context
  const { joined, origin, live, outputs } = scan
  type Frame = { name: string; branches: ValueNode[][]; current: ValueNode[] }
  const stack: Frame[] = [{ name: '', branches: [], current: [] }]
  const top = () => stack[stack.length - 1] as Frame
  const outputAt = new Map(outputs.map((range) => [range[0], range]))
  const events = live.filter(
    ([start, end]) => start < windowTo && end > windowFrom && !outputAt.has(start),
  )
  let piece = ''
  let next = 0
  const flush = () => {
    if (piece !== '') top().current.push({ kind: 'text', text: piece })
    piece = ''
  }
  const close = () => {
    const frame = stack.pop() as Frame
    frame.branches.push(frame.current)
    // В capture ничего не выводится; в case до первого when — тоже
    const branches =
      frame.name === 'capture'
        ? []
        : frame.name === 'case'
          ? frame.branches.slice(1)
          : frame.branches
    top().current.push({ kind: 'block', repeat: frame.name === 'for', branches })
  }
  const handle = ([start]: Range) => {
    flush()
    const name = tagNameAt(template, start)
    if (name === undefined) return
    if (BRANCH_TAGS.has(name)) {
      stack.push({ name, branches: [], current: [] })
    } else if (BRANCH_SEPARATORS.has(name) && stack.length > 1) {
      const frame = top()
      frame.branches.push(frame.current)
      frame.current = []
    } else if (name.startsWith('end') && stack.length > 1 && top().name === name.slice(3)) {
      close()
    }
  }
  for (let i = from; i < to; i++) {
    const at = origin[i] ?? 0
    for (let event = events[next]; event && event[1] <= at; event = events[next]) {
      handle(event)
      next++
    }
    if (joined[i] === OUTPUT_MARK) {
      flush()
      const range = outputAt.get(at)
      // Варианты считаются, когда до них дошла очередь: если по значению уже нечего читать
      // (схема адреса определена), вычисления вывода не нужны и бюджет на них не тратится
      let options: string[] | undefined
      top().current.push({
        kind: 'output',
        options: () => (options ??= range ? context.optionsOf(range) : []),
      })
    } else {
      piece += joined[i]
    }
  }
  flush()
  for (; next < events.length; next++) handle(events[next] as Range)
  while (stack.length > 1) close()
  return stack[0]?.current ?? []
}

/** Состояния после того, как по ним прошёл кусок значения */
type Feed = (states: ReadonlySet<string>, text: string) => Set<string>

/** Сколько вариантов состояния держим: больше — значение собрано слишком хитро */
const MAX_STATES = 200

/**
 * Обход дерева значения по всем путям: блок может не вывести ничего или любую из веток, цикл —
 * один раз или два. Что делать с куском текста, решает `feed`: для адреса — идти по схеме, для
 * capture — копить строки. Результат — состояния в конце и `overflow`, если вариантов стало
 * слишком много
 */
function walkValue(
  nodes: readonly ValueNode[],
  start: ReadonlySet<string>,
  feed: Feed,
  work: { left: number },
) {
  let overflow = false
  // Работа списывается до шага. Исчерпана — обход кончается, а проверка отвечает «слишком хитро»
  const spend = (units: number) => {
    work.left -= units
    if (work.left >= 0) return true
    overflow = true
    return false
  }
  const run = (list: readonly ValueNode[], states: ReadonlySet<string>): Set<string> => {
    let current = new Set(states)
    for (const node of list) {
      if (!spend(1)) return current
      if (node.kind === 'text') {
        if (!spend(node.text.length * current.size)) return current
        current = feed(current, node.text)
      } else if (node.kind === 'output') {
        // Состояний нет: схема определена раньше, чем дошло до вывода
        if (current.size === 0) continue
        const next = new Set(current)
        for (const option of node.options()) {
          if (!spend(option.length * current.size)) return current
          for (const state of feed(current, option)) next.add(state)
        }
        current = next
      } else {
        const next = new Set(current)
        let from: ReadonlySet<string> = current
        for (let round = 0; round < (node.repeat ? 2 : 1); round++) {
          const after = new Set<string>()
          for (const branch of node.branches) {
            for (const state of run(branch, from)) after.add(state)
            if (work.left < 0) return next
          }
          for (const state of after) next.add(state)
          from = after
        }
        current = next
      }
      if (current.size > MAX_STATES) {
        overflow = true
        current = new Set([...current].slice(0, MAX_STATES))
      }
    }
    return current
  }
  return { states: run(nodes, start), overflow }
}

/** Копит строки: так видно, чем может оказаться переменная из capture */
const appendFeed: Feed = (states, text) =>
  new Set([...states].map((state) => (state + text).slice(0, OPTION_LENGTH)))

/** Схема адреса определена: дальше по значению смотреть незачем (в srcset — до запятой) */
const DONE = '\0'

const entityCache = new Map<string, string>()
const decodeEntity = (text: string) => {
  const known = entityCache.get(text)
  if (known !== undefined) return known
  const decoded = decodeAttributeText(text)
  if (entityCache.size > 500) entityCache.clear()
  entityCache.set(text, decoded)
  return decoded
}

/**
 * Один символ значения, без сущностей: состояние — начало адреса, пока в нём может быть схема
 * (буквы, цифры, +.-). «:» определяет схему, любой другой знак — что схемы нет. Пробелы и
 * управляющие знаки браузер выбрасывает (а в srcset пробел заканчивает адрес, запятая
 * начинает следующий)
 */
function plain(state: string, char: string, srcset: boolean, report: (prefix: string) => void) {
  if (state === DONE) return srcset && char === ',' ? '' : DONE
  if (srcset && char === ',') return ''
  if (/[\s\p{Cc}]/u.test(char)) return srcset && state !== '' ? DONE : state
  const next = state + char.toLowerCase()
  if (char === ':') {
    if (!isSafeUrl(next)) report(next)
    return DONE
  }
  if (next.length > 64 || !/^[a-z][a-z0-9+.-]*$/.test(next)) return DONE
  return next
}

/**
 * Шаг по одному символу значения с сущностями (`&#106;`, `&colon;`): пока схема не определена,
 * «&» открывает сущность, и она копится до «;» или знака, который в сущность не входит. Состояние
 * с «&» — начало адреса и недочитанная сущность. Сущность может быть разорвана блоками
 * (`&#{% if a %}106{% endif %};`), поэтому читаем сквозь них, а не по кускам
 */
function step(
  state: string,
  char: string,
  srcset: boolean,
  report: (prefix: string) => void,
): string {
  const open = state === DONE ? -1 : state.indexOf('&')
  if (open === -1)
    return char === '&' && state !== DONE ? `${state}&` : plain(state, char, srcset, report)
  const prefix = state.slice(0, open)
  const pending = state.slice(open)
  if (char !== ';' && /[#a-z0-9]/i.test(char) && pending.length < 32) return state + char
  let next = prefix
  for (const decoded of decodeEntity(char === ';' ? `${pending};` : pending)) {
    next = plain(next, decoded, srcset, report)
  }
  return char === ';' ? next : step(next, char, srcset, report)
}

const tooComplexMessage = (name: string) =>
  `Адрес в ${name} собран слишком хитро для проверки: упростите условия в значении`

/**
 * Ссылка в атрибуте со значением из Liquid: чем бы оно ни начиналось при каком-то выборе
 * веток и значений, схема не должна быть опасной. Значение — дерево: текст, вывод и блоки if,
 * unless, case, for. Блок может не вывести ничего (условие ложно), поэтому текст после него —
 * тоже начало значения: `{% if a %}/{% endif %}javascript:…` при a = false — javascript:…
 * Вывод — «ничего» (поле пустое: `java{{ x }}script:`) либо константа (`valueContext`): значение
 * при пустых полях, строки выражения, assign и capture шаблона. Что подставят данные полей,
 * чистит сайт при рендере
 */
function dynamicLinkProblem(context: ValueContext, name: string, span: Range, window: Range) {
  if (!URL_ATTRIBUTES.has(name) && !name.endsWith(':href')) return undefined
  const srcset = name.endsWith('srcset')
  let unsafe: string | undefined
  const report = (prefix: string) => {
    if (unsafe === undefined) unsafe = prefix
  }
  const feed: Feed = (states, text) => {
    let current = states
    for (const char of text) {
      const next = new Set<string>()
      for (const state of current) {
        const after = step(state, char, srcset, report)
        if (after !== DONE || srcset) next.add(after)
      }
      current = next
    }
    return new Set(current)
  }
  // Вычисления, которые не уместились в бюджет, помечают значение как неизвестное (skipped.flag)
  context.skipped.flag = false
  const { overflow } = walkValue(
    valueTree(context, span, window),
    new Set(['']),
    feed,
    context.work,
  )
  if (unsafe !== undefined) return unsafeLinkMessage(unsafe)
  return overflow || context.work.left < 0 || context.skipped.flag
    ? tooComplexMessage(name)
    : undefined
}

/**
 * Не-адресный атрибут со значением из Liquid (tabindex, id, ссылка на id, url() в fill и
 * подобных): значение собирается так же, как у адреса, — по веткам и вариантам выводов, — и
 * каждое целиком идёт в ту же проверку, что и значение без Liquid. Ссылка на id с выводом
 * внутри здесь не проверяется: id из данных известен только при рендере
 */
function dynamicValueProblem(
  context: ValueContext,
  attribute: {
    tag: string
    name: string
    ids: ReadonlySet<string>
    hasOutput: boolean
    work: { left: number }
  },
  span: Range,
  window: Range,
) {
  const { tag, name, ids, hasOutput, work } = attribute
  if (URL_ATTRIBUTES.has(name) || name.endsWith(':href')) return undefined
  const isReference = ID_REFERENCE_ATTRIBUTES.has(name)
  if (isReference ? hasOutput : INERT_ATTRIBUTE.test(name)) return undefined
  const { states } = walkValue(valueTree(context, span, window), new Set(['']), appendFeed, work)
  for (const value of states) {
    if (value.trim() === '') continue
    if (isReference) {
      const missing = idsOf(value).find((id) => !ids.has(id))
      if (missing !== undefined) {
        return `${name}="${missing.slice(0, 40)}" ссылается на элемент вне блока: только на id из этого шаблона`
      }
      continue
    }
    const problem = attributeProblem(tag, name, value)
    if (problem) return problem
  }
  return undefined
}

type IdCheckContext = {
  lineAt: (offset: number) => number
  /** Есть ли в значении атрибута (позиции в тексте без Liquid) вывод или выполняемый тег */
  hasLiquid: (start: number, end: number) => boolean
}

/**
 * popovertarget, for, aria-labelledby… с id не из этого шаблона — ошибка: ссылка ушла бы на
 * элемент страницы. Значение из Liquid проверяется только при рендере
 */
function checkIdReferences(
  tree: ParentNode,
  context: IdCheckContext,
  add: (level: CustomBlockProblem['level'], line: number | undefined, message: string) => void,
) {
  const ids = new Set<string>()
  walkElements(tree, (node) => {
    const id = node.attrs.find((attr) => attr.name === 'id')?.value
    if (id) ids.add(id)
  })
  walkElements(tree, (node) => {
    for (const attr of node.attrs) {
      const name = attr.name.toLowerCase()
      if (!ID_REFERENCE_ATTRIBUTES.has(name)) continue
      const location = attributeLocation(node.sourceCodeLocation, attr)
      if (location && context.hasLiquid(location.startOffset, location.endOffset)) continue
      const missing = idsOf(attr.value).find((id) => !ids.has(id))
      if (missing === undefined) continue
      const where = location ?? node.sourceCodeLocation
      add(
        'error',
        where ? context.lineAt(where.startOffset) : undefined,
        `${name}="${missing}" ссылается на элемент вне блока: только на id из этого шаблона`,
      )
    }
  })
}

function forbiddenElementMessage(tag: string) {
  if (tag === 'script' || tag === 'noscript') {
    return `<${tag}> запрещён: свой блок работает без JavaScript`
  }
  if (tag === 'style') return '<style> не нужен: стили блока — во вкладке CSS'
  if (['plaintext', 'xmp', 'listing', 'noembed', 'noframes'].includes(tag)) {
    return `<${tag}> запрещён: браузер показал бы текстом всё, что после него на странице`
  }
  if (tag === 'form') return '<form> запрещён: заявки принимает блок «Форма»'
  if (tag === 'math' || tag === 'mglyph' || tag === 'malignmark') {
    return `<${tag}> запрещён: MathML в своём блоке недоступен — формулу дайте картинкой или текстом`
  }
  if (['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal'].includes(tag)) {
    return `<${tag}> запрещён: блок не встраивает чужие страницы и плагины`
  }
  return `<${tag}> в своём блоке недоступен`
}
