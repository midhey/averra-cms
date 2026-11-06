import { createHash } from 'node:crypto'
import { customBlockScriptFile, scriptSyntaxError, siteScriptFile } from '@averra/blocks'
import { type SiteScript, siteCsp } from '@averra/schema'

// Свой JS на сайте: каждый скрипт — отдельный файл /_scripts/<имя>.<хеш>.js. Хеш содержимого в
// имени: файл не меняется под своим адресом, сервер отдаёт его с кешем навсегда, а новая версия
// скрипта — новый адрес. Отдельный файл на скрипт: синтаксическая ошибка или исключение одного не
// ломают другие. Inline-скриптов нет — их запрещает CSP сайта. Чистые функции: их проверяют тесты
// рендерера, page.astro и маршрут /_scripts/ только подставляют результат

/** Папка своих скриптов в корне сайта */
export const SCRIPTS_DIR = '_scripts'

export type ScriptFile = {
  /** Имя файла без .js: site.<хеш>, block-<ключ>.<хеш> */
  name: string
  /** Адрес от корня сайта */
  src: string
  content: string
}

/** Свой блок, как его даёт снимок: нужен только ключ и скрипт */
type BlockScriptSource = { key: string; script?: string | undefined }

const hash = (content: string) => createHash('sha256').update(content).digest('hex').slice(0, 10)

function fileOf(prefix: string, content: string): ScriptFile {
  const name = `${prefix}.${hash(content)}`
  return { name, src: `/${SCRIPTS_DIR}/${name}.js`, content }
}

/**
 * Код, который можно вывести: не пустой и разбирается. Публикация ошибку разбора не пропускает,
 * но определение из базы могли записать в обход (откат, старая версия) — такой скрипт не выводится,
 * страница остаётся без него, а не с ошибкой в консоли каждого посетителя
 */
function usable(code: string | undefined, what: string): code is string {
  if (!code || code.trim() === '') return false
  const error = scriptSyntaxError(code)
  if (error) console.warn(`${what} не выведен: ${error}`)
  return error === undefined
}

/** Файл скрипта сайта. undefined — скрипта нет */
export function siteScriptFileOf(script: Pick<SiteScript, 'script'>): ScriptFile | undefined {
  if (!usable(script.script, 'Скрипт сайта')) return undefined
  return fileOf('site', siteScriptFile(script.script))
}

/** Файл скрипта своего блока. undefined — у блока нет скрипта */
export function blockScriptFileOf(block: BlockScriptSource): ScriptFile | undefined {
  if (!usable(block.script, `Скрипт своего блока «${block.key}»`)) return undefined
  return fileOf(`block-${block.key}`, customBlockScriptFile(block.key, block.script))
}

/**
 * Скрипты страницы по порядку: скрипт сайта, потом скрипты своих блоков в порядке первого блока на
 * странице. Каждый — один раз, сколько бы экземпляров блока ни стояло; блока нет — нет и скрипта
 */
export function pageScriptFiles(input: {
  siteScript: Pick<SiteScript, 'script'>
  /** Ключи своих блоков страницы (customBlockKeysOf) — уже без повторов */
  blockKeys: readonly string[]
  customBlocks: Readonly<Record<string, BlockScriptSource>>
}): ScriptFile[] {
  const files: ScriptFile[] = []
  const site = siteScriptFileOf(input.siteScript)
  if (site) files.push(site)
  for (const key of new Set(input.blockKeys)) {
    const block = input.customBlocks[key]
    const file = block && blockScriptFileOf(block)
    if (file) files.push(file)
  }
  return files
}

/** Все файлы скриптов сайта: их пишет сборка в /_scripts/ */
export function allScriptFiles(input: {
  siteScript: Pick<SiteScript, 'script'>
  customBlocks: Readonly<Record<string, BlockScriptSource>>
}): ScriptFile[] {
  return pageScriptFiles({ ...input, blockKeys: Object.keys(input.customBlocks) })
}

/**
 * CSP сайта по снимку: счётчики из настроек, домены владельца из скрипта сайта. apiOrigin — когда
 * картинки и формы ведут на API (dev, CMS_LINKS=api)
 */
export function siteCspOf(input: {
  analytics: { metrika: string; ga4: string }
  siteScript: Pick<SiteScript, 'origins'>
  apiOrigin: string | null
}) {
  return siteCsp({
    metrika: input.analytics.metrika,
    ga4: input.analytics.ga4,
    origins: input.siteScript.origins,
    apiOrigin: input.apiOrigin,
  })
}
