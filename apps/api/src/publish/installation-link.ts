import { randomBytes } from 'node:crypto'
import { mkdir, readlink, rename, symlink, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'

/**
 * Ссылка на папку сайта установки в PUBLISH_DIR: <PUBLISH_DIR>/main → <id сайта>. Caddy отдаёт
 * на домене сайта /srv/sites/main/current, поэтому id сайта ему знать не нужно: ни SITE_ID в .env,
 * ни правки .env при восстановлении из бэкапа, где сайт с другим id
 */
export const INSTALLATION_LINK = 'main'

/** На какой сайт смотрит ссылка main, или undefined, если её нет */
export async function installationLinkTarget(publishDir: string) {
  try {
    // На Windows ссылка — junction с абсолютным путём: id сайта — последняя часть пути
    return basename(await readlink(join(publishDir, INSTALLATION_LINK)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Ставит ссылку main на папку сайта siteId: API зовёт это при старте, когда сайт установки
 * известен. Папка сайта создаётся пустой, если сайт ещё не собирали: до первой публикации Caddy
 * отвечает «Страница не найдена», как и раньше. Подмена — как у current (releases.ts): новая
 * ссылка под временным именем переименовывается поверх старой, на Linux это атомарно
 */
export async function linkInstallationSite(publishDir: string, siteId: string) {
  if ((await installationLinkTarget(publishDir)) === siteId) return false
  await mkdir(join(publishDir, siteId), { recursive: true })
  const link = join(publishDir, INSTALLATION_LINK)
  const tmpLink = join(publishDir, `.main-${randomBytes(4).toString('hex')}`)
  // Цель относительная: у Caddy тот же том под другим путём. 'junction' — только на Windows
  await symlink(siteId, tmpLink, 'junction')
  try {
    await rename(tmpLink, link)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EEXIST' && code !== 'EISDIR') {
      await unlink(tmpLink).catch(() => {})
      throw error
    }
    // Windows (разработка, тесты) не переименовывает ссылку-папку поверх существующей
    await unlink(link)
    await rename(tmpLink, link)
  }
  return true
}
