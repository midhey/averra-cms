import { link, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { type MediaStorage, mediaKey } from '../media/storage'

// Что кладётся в папку релиза кроме того, что собрал Astro, и что из неё убирается

/**
 * Ссылка на файл картинки на собранном сайте: /media/<id картинки>/<ширина>.<формат>
 * (CMS_LINKS=relative у рендерера). Оригинал (original.*) наружу не отдаётся — его здесь нет
 */
const MEDIA_REF =
  /\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(\d{1,5}\.(?:avif|webp|jpg|png))/g

/** Все файлы папки, рекурсивно, путями от неё */
async function filesOf(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const isPage = (path: string) => extname(path) === '.html'

/** Какие файлы картинок упоминают страницы сайта: пары id и имя файла, без повторов */
export function referencedMedia(html: string) {
  const found = new Map<string, { mediaId: string; file: string }>()
  for (const [, mediaId, file] of html.matchAll(MEDIA_REF)) {
    if (mediaId && file) found.set(`${mediaId}/${file}`, { mediaId, file })
  }
  return [...found.values()]
}

/**
 * Кладёт в релиз файлы картинок, на которые ссылаются его страницы, — и только их: медиатека
 * целиком наружу не видна. Файл под своим адресом не меняется никогда (новая картинка — новый id),
 * поэтому файл, который уже есть в прежнем релизе, связывается жёсткой ссылкой, а не копируется:
 * пять хранимых версий сайта не занимают пятикратно места под картинки. Файла нет в медиатеке —
 * ошибка сборки, а не сайт с дырой вместо картинки
 */
export async function copyReferencedMedia({
  outDir,
  siteId,
  storage,
  previousDir,
}: {
  outDir: string
  siteId: string
  storage: MediaStorage
  previousDir?: string
}) {
  const pages = (await filesOf(outDir)).filter(isPage)
  const html = (await Promise.all(pages.map((page) => readFile(page, 'utf8')))).join('\n')
  const refs = referencedMedia(html)
  for (const { mediaId, file } of refs) {
    const target = join(outDir, 'media', mediaId, file)
    await mkdir(dirname(target), { recursive: true })
    if (previousDir) {
      try {
        await link(join(previousDir, 'media', mediaId, file), target)
        continue
      } catch {
        // В прежнем релизе файла нет (новая картинка) или жёсткую ссылку не сделать — берём из медиатеки
      }
    }
    // mediaKey проверяет вид ключа: строка из HTML не уведёт запись за пределы папки
    const data = await storage.get(mediaKey(siteId, mediaId, file))
    if (!data) throw new Error(`В медиатеке сайта нет файла картинки ${mediaId}/${file}`)
    await writeFile(target, data)
  }
  return refs.length
}

/** Файлы, которые собирает Astro: _astro/<имя>.<хеш>.<расширение> */
const ASSETS_DIR = '_astro'

/**
 * Убирает из _astro файлы, на которые не ссылается ни одна страница (ни прямо, ни через CSS и JS,
 * на которые она ссылается). Astro кладёт туда бандл React для интерактивных островов, даже когда
 * страница его не грузит (PLAN, модуль 9): лишние 200 КБ в каждой версии и в архиве сайта.
 * Возвращает имена удалённых
 */
export async function pruneUnusedAssets(outDir: string) {
  const assetsDir = join(outDir, ASSETS_DIR)
  const assets = (await filesOf(assetsDir)).map((path) => ({
    path,
    name: path.slice(assetsDir.length + 1).replaceAll('\\', '/'),
  }))
  if (assets.length === 0) return []
  const pages = (await filesOf(outDir)).filter(isPage)
  const used = new Set<string>()
  // Обход в ширину: страницы → их CSS и JS → то, на что ссылаются те
  const pending = await Promise.all(pages.map((page) => readFile(page, 'utf8')))
  for (let text = pending.pop(); text !== undefined; text = pending.pop()) {
    for (const asset of assets) {
      if (used.has(asset.name) || !text.includes(asset.name)) continue
      used.add(asset.name)
      if (/\.(css|js|mjs)$/.test(asset.name)) pending.push(await readFile(asset.path, 'utf8'))
    }
  }
  const unused = assets.filter((asset) => !used.has(asset.name))
  for (const asset of unused) await rm(asset.path, { force: true })
  return unused.map((asset) => asset.name)
}
