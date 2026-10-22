import { pluralRu } from '@averra/schema'
import { defaultTheme } from '@averra/tokens'
import type { Config } from './config'
import type { Db } from './db/client'
import { seedDemo } from './db/seed'
import { defaultSiteName, sitesRepo } from './modules/sites/repo'
import { linkInstallationSite } from './publish/installation-link'

/**
 * Что из конфига API нужно сайту установки. Функция получает сам конфиг, а не поля по одному:
 * связку «переменная окружения → сайт» проверяет тест, а не только чтение index.ts.
 * - SITE_NAME — название (его пишет install.sh);
 * - SITE_URL — без SITE_NAME названием станет его домен;
 * - devSeed — учебный режим: сайтом установки становится демо-сайт, который первым ложится
 *   в пустую базу;
 * - PUBLISH_DIR — ссылка main в нём ведёт на папку сайта установки. Без него публикации нет
 */
export type InstallationSiteConfig = Pick<
  Config,
  'SITE_NAME' | 'SITE_URL' | 'devSeed' | 'PUBLISH_DIR'
>

/**
 * Сайт установки при старте API. Одна установка — один сайт: его нет (первый запуск на пустой
 * базе) — API создаёт его сам, название — SITE_NAME, иначе домен сайта, иначе «Мой сайт». В
 * учебном режиме сайт установки — демо-сайт, второго не создаём. Лишние сайты старых баз не
 * трогаем: они целы и доступны по id через API, но админка работает с сайтом установки
 * (modules/sites/repo.ts). Ссылка main ставится при каждом старте: после восстановления из
 * бэкапа сайт может быть другим. lines — что напечатать в лог
 */
export async function prepareInstallationSite(db: Db, config: InstallationSiteConfig) {
  if (config.devSeed) await seedDemo(db)
  const sites = sitesRepo(db)
  const { site, created } = await sites.ensureInstallationSite(
    config.SITE_NAME ?? defaultSiteName(config.SITE_URL),
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
  if (config.PUBLISH_DIR) await linkInstallationSite(config.PUBLISH_DIR, site.id)
  return { site, lines }
}
