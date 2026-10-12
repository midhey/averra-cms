import { demoPage, demoPageTitle, demoSiteId, MAIN_PAGE_SLUG, PageContent } from '@cms/schema'
import { defaultTheme } from '@cms/tokens'
import type { Auth } from '../auth/auth'
import { usersRepo } from '../modules/users/repo'
import type { Db } from './client'
import { pageRevisions, pages, sites } from './schema'

/** Для разработки: в пустую базу кладём демо-сайт с опубликованным лендингом */
export async function seedDemo(db: Db) {
  const [existing] = await db.select({ id: sites.id }).from(sites).limit(1)
  if (existing) return

  const content = PageContent.parse(demoPage)
  const publishedAt = new Date()
  // Демо-главная опубликована, значит, у неё есть и версия в истории — как после публикации
  await db.transaction(async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({ id: demoSiteId, name: 'Демо: ремонт квартир', theme: defaultTheme })
      .returning({ id: sites.id })
    if (!site) throw new Error('Не удалось создать демо-сайт')

    const [page] = await tx
      .insert(pages)
      .values({
        siteId: site.id,
        slug: MAIN_PAGE_SLUG,
        title: demoPageTitle,
        draft: content,
        published: content,
        publishedTitle: demoPageTitle,
        publishedAt,
      })
      .returning({ id: pages.id })
    if (!page) throw new Error('Не удалось создать демо-страницу')

    await tx.insert(pageRevisions).values({
      siteId: site.id,
      pageId: page.id,
      version: 1,
      title: demoPageTitle,
      content,
      publishedAt,
    })
  })
}

export type DevOwner = { email: string; password: string }

/**
 * Только для разработки: если в базе нет ни одного пользователя, создаёт владельца из
 * DEV_OWNER_EMAIL / DEV_OWNER_PASSWORD. Возвращает, что получилось, — для строки в логе
 */
export async function seedDevOwner(db: Db, auth: Auth, owner: DevOwner | undefined) {
  const users = usersRepo(db, auth)
  if ((await users.count()) > 0) return 'exists' as const
  if (!owner) return 'missing' as const
  await users.create({ ...owner, name: 'Владелец (разработка)', role: 'owner' })
  return 'created' as const
}
