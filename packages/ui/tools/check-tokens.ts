import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import type { Node } from 'postcss'
import scss from 'postcss-scss'

/**
 * Граница токенов (перенос tools/check-tokens.mjs и tools/lib/tokens.mjs из frontend-kit f904954).
 * Сырые цвета (HEX, функции цвета CSS, именованные цвета) живут только в файлах токенов и тем,
 * а стили компонентов берут семантические роли. Кит ловит только HEX, rgb() и hsl() — здесь шире.
 * Добавка к киту: палитру (--palette-*) вне токенов и тем тоже нельзя ни объявлять, ни брать —
 * иначе тёмная тема не переключила бы такой цвет. То же для примитивов радиусов, теней и шкалы
 * текста: тема меняет роли, а не примитивы. Системные цвета — только внутри
 * @media (forced-colors: active), иначе нарушение вида system.
 * Разбираются объявления и параметры at-правил, поэтому селектор #id и комментарий — не нарушение
 */

/** HEX и функции цвета CSS. color-mix() сам не цвет: сырой цвет внутри него поймают остальные шаблоны */
const COLOR_PATTERN =
  /#[\da-f]{3,8}\b|(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/giu
const PALETTE_PATTERN = /--palette-[\w-]+/gu
/**
 * Примитивы формы и типографики (радиусы, тени, шкала текста) берутся только через роли:
 * тема переопределяет роли, а не примитивы. Шкала отступов --space-1…8 общая, её брать можно
 */
const PRIMITIVE_PATTERN =
  /--(?:radius-(?:small|medium|round)|shadow-(?:small|surface)|type-\d+)(?![\w-])/gu

/**
 * Именованные цвета CSS. transparent и currentcolor можно; системные цвета (Highlight,
 * CanvasText…) — отдельный вид нарушения system: их можно только внутри
 * @media (forced-colors: active)
 */
const NAMED_COLORS = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
]
/**
 * Слово-цвет само по себе: не часть имени (--color-red, $red, ui.red, red-dot) и не функция (tan()).
 * Строки и url() вырезаются до поиска: "Golos Text" и имена файлов не цвета
 */
const NAMED_COLOR_PATTERN = new RegExp(
  `(?<![\\w$@#.-])(?:${NAMED_COLORS.join('|')})(?![\\w(-])`,
  'giu',
)
/**
 * Системные цвета CSS (CSS Color 4) и устаревшие системные цвета CSS2, которые браузеры ещё
 * понимают (WindowText, ThreeDShadow…). Ими браузер рисует контрастную тему, поэтому брать их можно
 * только внутри @media (forced-colors: active): в обычном режиме они мимо темы и токенов
 */
const SYSTEM_COLORS = [
  'AccentColor',
  'AccentColorText',
  'ActiveText',
  'ButtonBorder',
  'ButtonFace',
  'ButtonText',
  'Canvas',
  'CanvasText',
  'Field',
  'FieldText',
  'GrayText',
  'Highlight',
  'HighlightText',
  'LinkText',
  'Mark',
  'MarkText',
  'SelectedItem',
  'SelectedItemText',
  'VisitedText',
  // Устаревшие (CSS2), браузер подставляет вместо них цвета из списка выше
  'ActiveBorder',
  'ActiveCaption',
  'AppWorkspace',
  'Background',
  'ButtonHighlight',
  'ButtonShadow',
  'CaptionText',
  'InactiveBorder',
  'InactiveCaption',
  'InactiveCaptionText',
  'InfoBackground',
  'InfoText',
  'Menu',
  'MenuText',
  'Scrollbar',
  'ThreeDDarkShadow',
  'ThreeDFace',
  'ThreeDHighlight',
  'ThreeDLightShadow',
  'ThreeDShadow',
  'Window',
  'WindowFrame',
  'WindowText',
]
const SYSTEM_COLOR_PATTERN = new RegExp(
  `(?<![\\w$@#.-])(?:${SYSTEM_COLORS.join('|')})(?![\\w(-])`,
  'giu',
)
/** (forced-colors: active) или краткая запись (forced-colors) — то же самое */
const FORCED_COLORS_PATTERN = /\(\s*forced-colors\s*(?::\s*active\s*)?\)/iu
/**
 * Свойства, где слово — имя, а не цвет: grid-area: field, animation: marker, font-family: Menu.
 * Системный цвет в них не ищем (именованные цвета — ищем: их имена не совпадают с обычными словами)
 */
const NAME_PROPERTY_PATTERN =
  /^(?:grid(?:-area|-row|-column|-template(?:-areas)?)?(?:-start|-end)?|animation(?:-name)?|transition(?:-property)?|font(?:-family)?|counter-(?:reset|increment|set)|list-style(?:-type)?|view-transition-name|container(?:-name)?|will-change|content)$/iu
const STRINGS_PATTERN = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\)/gu
const STYLE_EXTENSIONS = new Set(['.scss', '.css'])

export type TokenCheckConfig = {
  /** Папки, где искать стили (.scss и .css) */
  includeDirs: string[]
  /** Папки токенов и тем: в них сырые цвета и палитра разрешены */
  allowedDirs: string[]
  /** Отдельные файлы, которые не проверяются (закрытый список старых стилей) */
  skipFiles?: string[]
}

export type TokenViolation = {
  file: string
  line: number
  column: number
  /**
   * color — сырой цвет, palette — палитра мимо ролей, primitive — примитив формы мимо ролей,
   * system — системный цвет вне @media (forced-colors: active)
   */
  kind: 'color' | 'palette' | 'primitive' | 'system'
  value: string
}

function isInside(dir: string, file: string) {
  const rel = relative(dir, file)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-z]:/iu.test(rel))
}

/** Все файлы стилей в папке, по алфавиту. node_modules и dist не смотрим */
export async function findStyleFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await findStyleFiles(path)))
    else if (entry.isFile() && STYLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path)
    }
  }
  return files
}

type Kind = TokenViolation['kind']

function position(node: Node, file: string) {
  return { file, line: node.source?.start?.line ?? 1, column: node.source?.start?.column ?? 1 }
}

/**
 * Медиазапрос действует только в режиме принудительных цветов: каждый запрос списка требует
 * (forced-colors: active) или (forced-colors) и нигде не отрицает его через not
 */
function isForcedColorsQuery(params: string) {
  return params
    .split(',')
    .every((query) => FORCED_COLORS_PATTERN.test(query) && !/(?<![\w-])not(?![\w-])/iu.test(query))
}

/** Узел лежит внутри @media (forced-colors: active) — на любой глубине вложенности Sass */
function inForcedColors(node: Node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      parent.type === 'atrule' &&
      'name' in parent &&
      parent.name === 'media' &&
      isForcedColorsQuery(String((parent as { params?: string }).params))
    ) {
      return true
    }
  }
  return false
}

/** Значение свойства или параметры at-правила: цвета, палитра, примитивы */
function collect(value: string, node: Node, file: string, prop?: string): TokenViolation[] {
  const at = position(node, file)
  const bare = value.replace(STRINGS_PATTERN, '""')
  const system =
    inForcedColors(node) || (prop !== undefined && NAME_PROPERTY_PATTERN.test(prop))
      ? []
      : [...bare.matchAll(SYSTEM_COLOR_PATTERN)].map(
          (m) => ['system', m] as [Kind, RegExpMatchArray],
        )
  const found: [Kind, RegExpMatchArray][] = [
    ...[...bare.matchAll(COLOR_PATTERN), ...bare.matchAll(NAMED_COLOR_PATTERN)].map(
      (m) => ['color', m] as [Kind, RegExpMatchArray],
    ),
    ...[...value.matchAll(PALETTE_PATTERN)].map((m) => ['palette', m] as [Kind, RegExpMatchArray]),
    ...[...value.matchAll(PRIMITIVE_PATTERN)].map(
      (m) => ['primitive', m] as [Kind, RegExpMatchArray],
    ),
    ...system,
  ]
  return found.map(([kind, m]) => ({ ...at, kind, value: m[0] }))
}

/** Имя свойства: объявить палитру или примитив нельзя, а слово-цвет в имени (border-color) — не цвет */
function collectDeclared(prop: string, node: Node, file: string): TokenViolation[] {
  const at = position(node, file)
  return [
    ...[...prop.matchAll(PALETTE_PATTERN)].map((m) => ({
      ...at,
      kind: 'palette' as const,
      value: m[0],
    })),
    ...[...prop.matchAll(PRIMITIVE_PATTERN)].map((m) => ({
      ...at,
      kind: 'primitive' as const,
      value: m[0],
    })),
  ]
}

/** Нарушения в одном тексте стилей (для тестов на образцах и для файлов) */
export function findViolationsInSource(source: string, file: string): TokenViolation[] {
  const root = scss.parse(source, { from: file })
  const violations: TokenViolation[] = []
  root.walkDecls((decl) => {
    violations.push(
      ...collectDeclared(decl.prop, decl, file),
      ...collect(decl.value, decl, file, decl.prop),
    )
  })
  root.walkAtRules((rule) => {
    violations.push(...collect(rule.params, rule, file))
  })
  return violations
}

export async function findTokenViolations(config: TokenCheckConfig): Promise<TokenViolation[]> {
  const allowed = config.allowedDirs.map((dir) => resolve(dir))
  const skipped = new Set((config.skipFiles ?? []).map((file) => resolve(file)))
  const files = (await Promise.all(config.includeDirs.map((dir) => findStyleFiles(resolve(dir)))))
    .flat()
    .sort()
  const violations: TokenViolation[] = []
  for (const file of files) {
    if (skipped.has(file) || allowed.some((dir) => isInside(dir, file))) continue
    violations.push(...findViolationsInSource(await readFile(file, 'utf8'), file))
  }
  return violations
}

/** Строка для сообщения теста: путь от корня, место и что нашлось */
export function formatViolation(violation: TokenViolation, root: string) {
  const what = {
    color: 'прямой цвет',
    palette: 'палитра мимо ролей',
    primitive: 'примитив мимо ролей',
    system: 'системный цвет вне forced-colors',
  }[violation.kind]
  return `${relative(root, violation.file)}:${violation.line}:${violation.column} — ${what} ${violation.value}`
}
