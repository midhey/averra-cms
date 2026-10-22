import { pluralRu } from '@averra/schema'
import { defaultTheme } from '@averra/tokens'
import type { Db } from './db/client'
import { seedDemo } from './db/seed'
import { defaultSiteName, sitesRepo } from './modules/sites/repo'
import { linkInstallationSite } from './publish/installation-link'

type PrepareOptions = {
  db: Db
  /** SITE_NAME: его пишет install.sh */
  siteName: string | undefined
  /** SITE_URL: без SITE_NAME название — его домен */
  siteUrl: string | undefined
  /** Учебный режим: в пустую базу сначала ложится демо-сайт, он и становится сайтом установки */
  demo: boolean
  /** PUBLISH_DIR: ссылка main в нём ведёт на папку сайта установки. Без него публикации нет */
  publishDir?: string | undefined
}

/**
 * Сайт установки при старте API. Одна установка — один сайт: его нет (первый запуск на пустой
 * базе) — API создаёт его сам, название — SITE_NAME, иначе домен сайта, иначе «Мой сайт». В
 * учебном режиме сайт установки — демо-сайт, второго не создаём. Лишние сайты старых баз не
 * трогаем: они целы и доступны по id через API, но админка работает с сайтом установки
 * (modules/sites/repo.ts). Ссылка main ставится при каждом старте: после восстановления из
 * бэкапа сайт может быть другим. lines — что напечатать в лог
 */
export async function prepareInstallationSite({
  db,
  siteName,
  siteUrl,
  demo,
  publishDir,
}: PrepareOptions) {
  if (demo) await seedDemo(db)
  const sites = sitesRepo(db)
  const { site, created } = await sites.ensureInstallationSite(
    siteName ?? defaultSiteName(siteUrl),
    defaultTheme,
  )
  const lines: string[] = []
  if (created) lines.push(`Создан сайт установки «${site.name}»`)
  const count = await sites.count()
  if (count > 1) {
    lines.push(
      `В базе ${count} ${pluralRu(count, ['сайт', 'сайта', 'сайтов'])}. Averra работает с одним — ` +
        `«${site.name}» (${site.id}), созданным первым. Остальные сохранены и доступны по id ` +
        'через API, но в админке не видны (https://midhey.github.io/averra-cms/decisions/single-site/)',
    )
  }
  if (publishDir) await linkInstallationSite(publishDir, site.id)
  return { site, lines }
}
