import {
  type CustomBlockDraft,
  type CustomBlockPlacement,
  customBlockProps,
  exampleIssues,
  type MediaMap,
  parsedExample,
} from '@averra/schema'
import { fullSizeUrl } from '../ui/media-file'
import { compileCustomCss } from './css'
import { checkTemplateHtml, renderedProblems, sanitizeHtml } from './html'
import {
  CUSTOM_FILTERS,
  liquid,
  liquidErrorOf,
  liquidLint,
  parseTemplate,
  renderTemplate,
} from './liquid'
import { PLACE_SHAPE, type PlaceData, type PlaceShape, samplePlaceData } from './place-data'
import { legalFooterCssProblems } from './place-legal'
import { type CustomBlockProblem, CustomBlockRenderError } from './problems'
import { scriptProblems } from './script'

/**
 * Определение, которое нужно рендеру: ключ, поля, шаблон и CSS. Скрипт — для рендерера сайта и
 * изолированного предпросмотра: Page его не выводит, разметка блока работает без него
 */
export type RenderableCustomBlock = Pick<
  CustomBlockDraft,
  'key' | 'title' | 'fields' | 'template' | 'css'
> & {
  script?: string | undefined
  /** Место: блок страницы (нет — тоже), свой вид шапки или подвала */
  placement?: CustomBlockPlacement | undefined
}

/** Опубликованные определения по ключу: так их получают Page и рендерер */
export type CustomBlockMap = Readonly<Record<string, RenderableCustomBlock>>

type RenderContext = {
  /** Id блока на странице: он же якорь */
  id: string
  media: MediaMap
  /** Первый блок страницы: картинку грузить сразу */
  priority: boolean
  /** id всех блоков страницы: шаблон их не повторяет (якоря меню, подписи полей форм) */
  pageIds?: readonly string[] | undefined
}

/** Адреса всех файлов медиатеки сайта: фильтр image выводит их, и чистка их оставляет */
const mediaUrls = (media: MediaMap) =>
  new Set(Object.values(media).flatMap((file) => file.variants.map((variant) => variant.url)))

/**
 * HTML своего блока: данные проверяются схемой определения (умолчания подставлены), шаблон
 * рендерится Liquid, результат чистится. Данные не подходят или шаблон упал —
 * CustomBlockRenderError: блок не выводится, а сайт собирается дальше
 */
export function renderCustomBlockHtml(
  definition: RenderableCustomBlock,
  props: unknown,
  context: RenderContext,
) {
  return renderWith(definition, props, {}, context)
}

/**
 * HTML своего вида шапки или подвала: поля вида и данные места (site, page). Ошибка —
 * CustomBlockRenderError: на сайте тогда стандартная шапка или подвал
 */
export function renderCustomPlaceHtml(
  definition: RenderableCustomBlock,
  props: unknown,
  data: PlaceData,
  context: RenderContext,
) {
  return renderWith(definition, props, data, context)
}

function renderWith(
  definition: RenderableCustomBlock,
  props: unknown,
  extra: Partial<PlaceData>,
  context: RenderContext,
) {
  const parsed = customBlockProps(definition.fields).safeParse(props)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    throw new CustomBlockRenderError(
      `Данные блока не подходят под определение «${definition.title}» — ${where}${issue?.message ?? ''}`,
    )
  }
  const scope = { ...parsed.data, ...extra, block: { id: context.id, key: definition.key } }
  const html = renderTemplate(definition.template, scope, {
    media: context.media,
    priority: context.priority,
  })
  return sanitizeHtml(html, mediaUrls(context.media), {
    pageIds: context.pageIds,
    ownId: context.id,
  })
}

/** Адрес картинки медиатеки для url(media:…) в CSS: самый широкий вариант, как ссылка на снимок */
export const mediaUrlIn = (media: MediaMap) => (mediaId: string) => {
  const file = media[mediaId]
  return file ? fullSizeUrl(file) : undefined
}

/**
 * CSS блока, готовый для страницы. Ошибочные правила в нём уже выброшены (опубликованное
 * определение их и не содержит). Разбор postcss быстрый, поэтому без кеша
 */
export function customBlockCss(definition: RenderableCustomBlock, media: MediaMap) {
  try {
    return compileCustomCss(definition.css, definition.key, { mediaUrl: mediaUrlIn(media) }).css
  } catch {
    return ''
  }
}

/** CSS своих блоков страницы — по одному разу на тип, в порядке первого появления */
export function customBlocksCss(
  keys: readonly string[],
  definitions: CustomBlockMap,
  media: MediaMap,
) {
  return keys
    .flatMap((key) => {
      const definition = definitions[key]
      return definition ? [customBlockCss(definition, media)] : []
    })
    .filter(Boolean)
    .join('\n')
}

const ALLOWED_GLOBALS = new Set(['block'])
/** У шапки и подвала ещё данные места */
const PLACE_GLOBALS = new Set(['block', 'site', 'page'])

const isPlace = (definition: { placement?: CustomBlockPlacement | undefined }) =>
  (definition.placement ?? 'block') !== 'block'

/** Элемент списка по пути: first, last, номер */
const isItem = (segment: Segment | undefined) =>
  segment === 'first' || segment === 'last' || typeof segment === 'number'

/** Форма по пути от site или page; переменная цикла по site.menu — форма пункта меню */
function placeShapeOf(
  path: readonly Segment[],
  aliases: ReadonlyMap<string, string[] | undefined>,
  depth = 0,
): PlaceShape | undefined {
  const [head, ...rest] = path
  if (typeof head !== 'string' || depth > 8) return undefined
  let shape: PlaceShape | undefined
  if (head === 'site' || head === 'page') shape = PLACE_SHAPE[head]
  else if (aliases.has(head)) {
    const collection = aliases.get(head)
    const list = collection && placeShapeOf(collection, aliases, depth + 1)
    shape = Array.isArray(list) ? list[0] : undefined
  }
  for (const segment of rest) {
    if (shape === undefined || shape === 'value') return undefined
    if (Array.isArray(shape)) shape = isItem(segment) ? shape[0] : undefined
    else
      shape =
        typeof segment === 'string' ? (shape as Record<string, PlaceShape>)[segment] : undefined
  }
  return shape
}

/**
 * Опечатка в данных места на любом уровне: site.manu, site.organization.phon, item.hreff в цикле
 * по site.menu. Значения (site.name.size) и списки (site.menu.size) не проверяются
 */
function placeVariableProblem(
  segments: readonly Segment[],
  aliases: ReadonlyMap<string, string[] | undefined>,
) {
  for (let end = 1; end < segments.length; end += 1) {
    const shape = placeShapeOf(segments.slice(0, end), aliases)
    if (shape === undefined || shape === 'value' || Array.isArray(shape)) return undefined
    const key = segments[end]
    if (typeof key !== 'string' || key === 'size') return undefined
    if (key in shape) continue
    const prefix = segments.slice(0, end).map(String).join('.')
    const known = Object.keys(shape).map((one) => `${prefix}.${one}`)
    return `Нет данных «${prefix}.${key}»: есть ${known.join(', ')}`
  }
  return undefined
}

/**
 * Всё, что не так с определением, — для редактора своего блока (на лету) и для API (публикация
 * только без ошибок): пример, шаблон (Liquid, переменные, HTML, пробный рендер на примере), CSS
 */
export function customBlockProblems(
  definition: CustomBlockDraft,
  options: {
    media?: MediaMap
    mediaIds?: ReadonlySet<string>
    /** Станет true, если проверка остановилась по времени: итог зависит от нагрузки, не от шаблона */
    timeLimit?: { hit: boolean }
  } = {},
): CustomBlockProblem[] {
  const problems: CustomBlockProblem[] = []

  for (const issue of exampleIssues(definition)) {
    problems.push({ part: 'example', level: 'error', message: issue.message, path: issue.path })
  }

  if (definition.template.trim() === '') {
    problems.push({
      part: 'template',
      level: 'error',
      message: 'Шаблон пустой: блоку нечего показать',
    })
  } else {
    problems.push(...templateProblems(definition, options.timeLimit))
  }

  const known = options.mediaIds
  const css = compileCustomCss(definition.css, definition.key, {
    mediaUrl: known ? (id) => (known.has(id) ? `/media/${id}` : undefined) : undefined,
  })
  problems.push(...css.problems)
  if (definition.placement === 'footer') problems.push(...legalFooterCssProblems(definition.css))
  problems.push(...scriptProblems(definition.script))
  return problems
}

function templateProblems(
  definition: CustomBlockDraft,
  timeLimit?: { hit: boolean },
): CustomBlockProblem[] {
  const problems: CustomBlockProblem[] = []
  const add = (level: CustomBlockProblem['level'], message: string, line?: number) =>
    problems.push({ part: 'template', level, message, line })
  try {
    const templates = parseTemplate(definition.template)
    const fields = new Set(definition.fields.map((field) => field.name))
    const analysis = liquid.analyzeSync(templates, { partials: false })
    const globals = isPlace(definition) ? PLACE_GLOBALS : ALLOWED_GLOBALS
    for (const [name, uses] of Object.entries(analysis.globals)) {
      if (fields.has(name) || globals.has(name)) continue
      add(
        'error',
        `Нет поля «${name}»: ключи полей — ${[...fields].join(', ')}`,
        uses[0]?.location.row,
      )
    }
    for (const lint of liquidLint(definition.template)) add('error', lint.message, lint.line)
    const aliases = loopAliases(definition.template, new Set(Object.keys(analysis.locals)))
    for (const uses of Object.values(analysis.variables)) {
      for (const use of uses) {
        const message =
          (isPlace(definition) && !fields.has(String(use.segments[0]))
            ? placeVariableProblem(use.segments, aliases)
            : undefined) ?? nestedFieldProblem(definition.fields, use.segments, aliases)
        if (message) add('error', message, use.location.row)
      }
    }
    // Меню шапки на телефоне без JS открывается только через <details>: скрипт Averra его ещё и
    // закрывает по Esc. Без него меню на узком экране либо не видно, либо не закрывается
    if (
      definition.placement === 'header' &&
      /\bsite\.menu\b/.test(definition.template) &&
      !/<details\b/i.test(definition.template)
    ) {
      add(
        'warning',
        'Меню без <details>: на телефоне без JavaScript его не открыть. Оберните меню телефона в <details><summary>Меню</summary>…</details>',
      )
    }
  } catch (error) {
    const { message, line } = liquidErrorOf(error)
    add('error', message, line)
    return problems
  }
  const block = { id: 'example', key: definition.key }
  // Шапка и подвал рисуются на образце данных сайта: меню, кнопка, «Организация», документы
  const place = isPlace(definition) ? samplePlaceData() : {}
  const state = { media: {}, priority: false }
  // Пробный рендер на примере: ошибки, которые видно только при выполнении (лимиты, аргументы).
  // Он первый: если шаблон упёрся в лимит, вычислять дальше нечем — каждое вычисление было бы
  // таким же долгим, а проверка идёт в обработчике API и в редакторе на каждую правку
  const rendered: string[] = []
  const example = parsedExample(definition)
  let exhausted = false
  if (example) {
    try {
      rendered.push(renderTemplate(definition.template, { ...example, ...place, block }, state))
    } catch (error) {
      if (error instanceof CustomBlockRenderError) {
        add('error', error.message, error.line)
        exhausted = LIMIT_MESSAGE.test(error.message)
        // Предел рендера считается по часам: на нагрузке тот же шаблон его не достиг бы
        if (timeLimit && TIME_MESSAGE.test(error.message)) timeLimit.hit = true
      }
    }
  }
  // Пустые поля: что выведут константы шаблона и его assign, когда данных нет. Без кеша разбора:
  // разовые шаблоны проверки не вытесняют из него шаблоны сайта. Лимит исчерпан один раз — дальше
  // не вычисляем
  const evaluate = (source: string) => {
    if (exhausted) return undefined
    try {
      return renderTemplate(source, { block }, state, { cache: false })
    } catch (error) {
      if (error instanceof CustomBlockRenderError && LIMIT_MESSAGE.test(error.message)) {
        exhausted = true
        if (timeLimit && TIME_MESSAGE.test(error.message)) timeLimit.hit = true
      }
      return undefined
    }
  }
  const html = checkTemplateHtml(definition.template, {
    evaluate,
    timeLimit,
    exhausted: () => exhausted,
  })
  problems.push(...html)
  // Второй рендер без данных: другая сторона условий. Его ошибки не показываем — они зависят
  // от пустых полей, а не от шаблона
  const empty = evaluate(definition.template)
  if (empty !== undefined) rendered.push(empty)
  // Константы шаблона (assign, строки в фильтрах) и данные примера попадают в разметку только
  // при выполнении: готовый HTML сверяется с очисткой сайта. Что статическая проверка уже назвала,
  // не повторяем — по тексту, а не «все ошибки про ссылки разом»: остальное автор увидел бы только
  // после следующего сохранения
  const known = html.filter((one) => one.level === 'error').map((one) => one.message)
  // Статическая проверка адреса, собранного Liquid, называет его начало («javascript:»), пробный
  // рендер — весь адрес («javascript:alert(1)»): это одна и та же ссылка
  const knownLinks = known.flatMap((message) =>
    linkOf(message) ? [linkOf(message) as string] : [],
  )
  for (const message of new Set(rendered.flatMap(renderedProblems))) {
    const link = linkOf(message)
    if (known.includes(message) || (link && knownLinks.some((one) => link.startsWith(one))))
      continue
    add(
      'error',
      `${message}. Так выглядит блок при подстановке примера или пустых полей: на сайте это будет убрано`,
    )
  }
  return problems
}

/** Адрес из сообщения «Ссылка «…» запрещена»: без пробелов, в нижнем регистре, как у браузера */
const linkOf = (message: string) =>
  /^Ссылка «(.*?)» запрещена/s.exec(message)?.[1]?.replace(/\s/g, '').toLowerCase()

/** Лимит движка исчерпан (время, память, объём): шаблон слишком тяжёлый, повторять его незачем */
const LIMIT_MESSAGE = /слишком/

/** Из них — предел времени рендера: он зависит от нагрузки на сервер, а не только от шаблона */
const TIME_MESSAGE = /рендерится слишком долго/

type Field = RenderableCustomBlock['fields'][number]
type Segment = string | number | object

/**
 * Переменные циклов: {% for plan in plans %} → plan — элемент plans. Разбор LiquidJS связи
 * переменной цикла с коллекцией не отдаёт, поэтому — по тексту тегов for (и строк
 * {% liquid %}). Имя, которое привязано к разным коллекциям или задано assign, не проверяем
 */
function loopAliases(template: string, locals: ReadonlySet<string>) {
  const aliases = new Map<string, string[] | undefined>()
  const loop = /\bfor\s+([A-Za-z_][\w-]*)\s+in\s+([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)/g
  for (const [, alias, collection] of template.matchAll(loop)) {
    if (!alias || !collection || locals.has(alias)) continue
    const path = collection.split('.')
    const known = aliases.get(alias)
    aliases.set(alias, aliases.has(alias) && known?.join('.') !== collection ? undefined : path)
  }
  return aliases
}

type Scope = { fields: readonly Field[]; rest: readonly Segment[]; owner: string | undefined }

/** Откуда начинается путь: переменная цикла — поля элемента её повторителя, иначе — корень */
function scopeOf(
  root: readonly Field[],
  segments: readonly Segment[],
  aliases: ReadonlyMap<string, string[] | undefined>,
  depth: number,
): Scope | undefined {
  const [head] = segments
  if (typeof head !== 'string') return undefined
  if (!aliases.has(head)) return { fields: root, rest: segments, owner: undefined }
  const collection = aliases.get(head)
  // Вложенные циклы ссылаются друг на друга; глубина полей и так ограничена схемой
  if (!collection || depth > 8) return undefined
  const item = repeaterItemFields(root, collection, aliases, depth + 1)
  return item ? { fields: item, rest: segments.slice(1), owner: head } : undefined
}

/** Поля элемента повторителя по пути коллекции цикла (plans, plan.features, group.items) */
function repeaterItemFields(
  root: readonly Field[],
  path: readonly Segment[],
  aliases: ReadonlyMap<string, string[] | undefined>,
  depth: number,
): readonly Field[] | undefined {
  const scope = scopeOf(root, path, aliases, depth)
  if (!scope) return undefined
  let fields = scope.fields
  const rest = [...scope.rest]
  while (rest.length > 0) {
    const field = fields.find((one) => one.name === rest[0])
    rest.shift()
    if (!field) return undefined
    if (field.type === 'group') fields = field.fields
    else if (field.type === 'repeater') {
      if (rest.length === 0) return field.fields
      const next = rest.shift()
      if (next !== 'first' && next !== 'last' && typeof next !== 'number') return undefined
      fields = field.fields
    } else return undefined
  }
  return undefined
}

/**
 * Опечатка во вложенном поле: {{ plan.nam }} при поле «name» повторителя plans. Путь проверяется,
 * пока идёт по группам и повторителям; дальше (alt картинки, href ссылки) — значение поля
 */
function nestedFieldProblem(
  root: readonly Field[],
  segments: readonly Segment[],
  aliases: ReadonlyMap<string, string[] | undefined>,
): string | undefined {
  const scope = scopeOf(root, segments, aliases, 0)
  if (!scope) return undefined
  let { fields, owner } = scope
  const rest = [...scope.rest]
  while (rest.length > 0) {
    const segment = rest.shift()
    if (typeof segment !== 'string') return undefined
    const field = fields.find((one) => one.name === segment)
    if (!field) {
      // Неизвестный корень уже назван выше (globals): здесь — только вложенные поля
      if (owner === undefined) return undefined
      const names = fields.map((one) => one.name).join(', ')
      return `Нет поля «${segment}» в «${owner}»: ключи полей — ${names}`
    }
    if (field.type === 'group') {
      fields = field.fields
      owner = field.name
    } else if (field.type === 'repeater') {
      // plans.first.name и plans[0].name — элемент повторителя; plans.size — число
      const next = rest.shift()
      if (next !== 'first' && next !== 'last' && typeof next !== 'number') return undefined
      fields = field.fields
      owner = field.name
    } else return undefined
  }
  return undefined
}

export { CUSTOM_FILTERS }
