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
])

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
  if (!urls.every(isSafeUrl)) {
    return `Ссылка «${value.trim().slice(0, 40)}» запрещена: только https://, /, #, mailto: и tel:`
  }
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
 * Очистка HTML после Liquid: разбор настоящим парсером HTML и сборка заново без запрещённых
 * элементов, обработчиков on* и опасных ссылок. Шаблон проверяют при сохранении, но ссылку
 * javascript: из текстового поля в href или атрибут, собранный {% if %}, видно только здесь.
 * Сборка из дерева, а не замена по тексту: браузер разберёт ровно то, что разобрали мы.
 * trusted — адреса файлов медиатеки сайта: они могут быть абсолютными (медиа с адреса API), и
 * фильтр image выводит именно их; любой другой чужой адрес в src и srcset убирается
 */
export function sanitizeHtml(
  html: string,
  trusted?: ReadonlySet<string>,
  options: SanitizeOptions = {},
) {
  const fragment = parseFragment(html)
  const { pageIds = [], ownId } = options
  // id блоков страницы (и их полей: «форма-имя») — якоря меню и подписи: копия в своём блоке
  // стояла бы раньше и перехватила бы их. «{{ block.id }}-имя» — свой, его можно
  const isTaken = (id: string) =>
    !(ownId !== undefined && id.startsWith(`${ownId}-`)) &&
    pageIds.some((one) => id === one || id.startsWith(`${one}-`))
  clean(fragment, trusted, isTaken)
  const ids = new Set<string>()
  walkElements(fragment, (node) => {
    const id = node.attrs.find((attr) => attr.name === 'id')?.value
    if (id) ids.add(id)
  })
  walkElements(fragment, (node) => {
    node.attrs = node.attrs.filter(
      (attr) =>
        !ID_REFERENCE_ATTRIBUTES.has(attr.name.toLowerCase()) ||
        idsOf(attr.value).every((id) => ids.has(id)),
    )
  })
  return serialize(fragment)
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
  trusted: ReadonlySet<string> | undefined,
  isTaken: (id: string) => boolean,
) {
  parent.childNodes = parent.childNodes.filter((node) => {
    if (node.nodeName === '#comment') return false
    if (!isElement(node)) return true
    if (FORBIDDEN_ELEMENTS.has(node.tagName.toLowerCase())) return false
    const tag = node.tagName.toLowerCase()
    node.attrs = node.attrs.filter((attr) => {
      const name = attributeName(attr).toLowerCase()
      if (name === 'id' && isTaken(attr.value.trim())) return false
      return attributeProblem(tag, name, attr.value, trusted) === undefined
    })
    clean(node, trusted, isTaken)
    return true
  })
}

// Запасной разбор, если токенизатор LiquidJS отказал (незакрытый тег): шаблон всё равно не
// сохранится из-за ошибки Liquid, а маска нужна проверке HTML для понятных строк
const LIQUID_FALLBACK =
  /\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}|\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g

const NOT_CODE_FALLBACK =
  /\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}|\{%-?\s*raw\s*-?%\}[\s\S]*?\{%-?\s*endraw\s*-?%\}/g

/** Замена той же длины, переводы строк на месте: номера строк и позиции не сдвигаются */
const blank = (text: string, fill: string) => text.replace(/[^\n]/g, fill)

type LiquidScan = {
  masked: string
  /** Шаблон, где comment и raw (с тегами) вычеркнуты: в них нет кода Liquid */
  code: string
  raws: Array<[number, number]>
}

/**
 * Разбор шаблона тем же токенизатором, что и рендер: границы raw, вывода и тегов совпадают с
 * LiquidJS дословно (аргументы raw, «%» в endraw, «{% # … %}», кавычки в выводе). Свой regexp
 * расходился бы с ним, и разметка пряталась бы от проверки
 */
function scanLiquid(template: string): LiquidScan {
  const raws: Array<[number, number]> = []
  let masked = ''
  let code = ''
  try {
    const tokenizer = new Tokenizer(template)
    let inRaw = false
    // Комментарии в LiquidJS не вложены: «comment» внутри ничего не открывает, первый endcomment
    // закрывает
    let inComment = false
    while (tokenizer.p < tokenizer.N) {
      const token = tokenizer.readTopLevelToken(defaultOptions)
      const text = template.slice(token.begin, token.end)
      if (token.kind === TokenKind.HTML) {
        if (inRaw) {
          // Внутри raw Liquid выводит текст как есть: разметка в нём — настоящая разметка страницы
          raws.push([token.begin, token.end])
          masked += text
          code += blank(text, ' ')
        } else {
          masked += inComment ? blank(text, ' ') : text
          code += inComment ? blank(text, ' ') : text
        }
        continue
      }
      const name = token.kind === TokenKind.Tag ? (token as TagToken).name : ''
      if (inRaw) {
        // Единственный токен-тег в режиме raw — endraw
        inRaw = false
        masked += blank(text, ' ')
        code += blank(text, ' ')
      } else if (name === 'raw' && !inComment) {
        inRaw = true
        masked += blank(text, ' ')
        code += blank(text, ' ')
      } else {
        if (name === 'comment') inComment = true
        const fill = token.kind === TokenKind.Output && !inComment ? 'x' : ' '
        masked += blank(text, fill)
        // raw внутри комментария токенизатор всё равно читает как raw: его текст — часть комментария
        code += inComment || name === 'endcomment' ? blank(text, ' ') : text
        if (name === 'endcomment') inComment = false
      }
    }
    return { masked, code, raws }
  } catch {
    return {
      masked: template.replace(LIQUID_FALLBACK, (part) =>
        blank(part, part.startsWith('{{') ? 'x' : ' '),
      ),
      code: template.replace(NOT_CODE_FALLBACK, (part) => blank(part, ' ')),
      raws: [],
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

/**
 * Проверка HTML шаблона при сохранении: запрещённые элементы и атрибуты, опасные ссылки, вывод
 * {{ }} в атрибуте без кавычек (значение с пробелом добавило бы атрибуты) — ошибки со строкой.
 * h1 и картинка без alt — предупреждения
 */
export function checkTemplateHtml(template: string): CustomBlockProblem[] {
  const { masked, raws } = scanLiquid(template)
  const problems: CustomBlockProblem[] = []
  const add = (level: CustomBlockProblem['level'], line: number | undefined, message: string) =>
    problems.push({ part: 'template', level, line, message })

  for (const match of template.matchAll(/<\/?\s*(?:[a-z][\w:-]*)?(?:\{\{|\{%)/gi)) {
    add(
      'error',
      lineOf(template, match.index),
      'Имя элемента не собирают из Liquid (и не приклеивают к нему вывод): <a {{ … }}> — с пробелом',
    )
  }

  const visit = (parent: ParentNode) => {
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue
      const location = node.sourceCodeLocation
      const line = location?.startLine
      const tag = node.tagName.toLowerCase()
      if (FORBIDDEN_ELEMENTS.has(tag)) {
        add('error', line, forbiddenElementMessage(tag))
        continue
      }
      if (tag === 'h1') {
        add(
          'warning',
          line,
          'h1 на странице один — у первого экрана. Заголовок своего блока — h2, внутри — h3',
        )
      }
      if (tag === 'img' && !node.attrs.some((attr) => attr.name === 'alt')) {
        add('warning', line, 'У картинки нет alt: возьмите фильтр image — он ставит alt из поля')
      }
      for (const attr of node.attrs) {
        const name = attributeName(attr).toLowerCase()
        const attrLocation = location?.attrs?.[attr.name]
        const attrLine = attrLocation?.startLine ?? line
        const source = attrLocation
          ? template.slice(attrLocation.startOffset, attrLocation.endOffset)
          : ''
        const sourceStart = attrLocation?.startOffset ?? 0
        // Скобки Liquid внутри raw — обычные символы значения, не вывод
        const liquidAt = (from: number, to: number) =>
          [...source.slice(from, to).matchAll(/{{|{%/g)].some(
            (hit) =>
              !raws.some(
                ([start, end]) =>
                  sourceStart + from + hit.index >= start && sourceStart + from + hit.index < end,
              ),
          )
        const hasOutput = liquidAt(0, source.length)
        const nameSource = source.split('=')[0] ?? ''
        if (liquidAt(0, nameSource.length)) {
          // Значение поля стало бы атрибутами (style, form, onclick…), а чистка видит только итог
          add('error', attrLine, 'Имя атрибута не собирают из Liquid: Liquid — только в значении')
          continue
        }
        // Значение без кавычек — после первого «=» не кавычка. «==» внутри {% if a == b %} — не в счёт
        if (hasOutput && /^[^=]*=\s*[^\s"']/.test(source)) {
          add(
            'error',
            attrLine,
            `Значение атрибута ${name} с Liquid — в кавычках: ${name}="{{ … }}"`,
          )
        }
        const problem = attributeProblem(tag, name, hasOutput ? undefined : attr.value)
        if (problem) add('error', attrLine, problem)
      }
      visit(node)
    }
  }
  const tree = parseFragment(masked, { sourceCodeLocationInfo: true })
  visit(tree)
  checkIdReferences(template, tree, add)
  return problems
}

/**
 * popovertarget, for, aria-labelledby… с id не из этого шаблона — ошибка: ссылка ушла бы на
 * элемент страницы. Значение из Liquid (маска «x…») проверяется только при рендере
 */
function checkIdReferences(
  template: string,
  tree: ParentNode,
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
      const location = node.sourceCodeLocation?.attrs?.[attr.name]
      const source = location ? template.slice(location.startOffset, location.endOffset) : ''
      if (source.includes('{{') || source.includes('{%')) continue
      const missing = idsOf(attr.value).find((id) => !ids.has(id))
      if (missing === undefined) continue
      const line = location?.startLine
      add(
        'error',
        line ?? node.sourceCodeLocation?.startLine,
        `${name}="${missing}" ссылается на элемент вне блока: только на id из этого шаблона`,
      )
    }
  })
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

function forbiddenElementMessage(tag: string) {
  if (tag === 'script' || tag === 'noscript') {
    return `<${tag}> запрещён: свой блок работает без JavaScript`
  }
  if (tag === 'style') return '<style> не нужен: стили блока — во вкладке CSS'
  if (['plaintext', 'xmp', 'listing', 'noembed', 'noframes'].includes(tag)) {
    return `<${tag}> запрещён: браузер показал бы текстом всё, что после него на странице`
  }
  if (tag === 'form') return '<form> запрещён: заявки принимает блок «Форма»'
  if (['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal'].includes(tag)) {
    return `<${tag}> запрещён: блок не встраивает чужие страницы и плагины`
  }
  return `<${tag}> в своём блоке недоступен`
}
