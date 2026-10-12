import { demoPage, demoPageTitle, PageContent } from '@cms/schema'
import { defaultTheme } from '@cms/tokens'
import type { Db } from './client'
import { pages, sites } from './schema'

/** Для разработки: в пустую базу кладём демо-сайт с опубликованным лендингом */
export async function seedDemo(db: Db) {
  const [existing] = await db.select({ id: sites.id }).from(sites).limit(1)
  if (existing) return

  const [site] = await db
    .insert(sites)
    .values({ name: 'Демо: ремонт квартир', theme: defaultTheme })
    .returning({ id: sites.id })
  if (!site) throw new Error('Не удалось создать демо-сайт')

  const content = PageContent.parse(demoPage)
  await db.insert(pages).values({
    siteId: site.id,
    slug: 'index',
    title: demoPageTitle,
    draft: content,
    published: content,
    publishedTitle: demoPageTitle,
    publishedAt: new Date(),
  })
}
