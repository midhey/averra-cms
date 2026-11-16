import { MailTemplateText } from '@averra/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { mailTemplateTexts, sites } from '../db/schema'
import { publishedTheme } from '../modules/theme/read'
import { siteMailStyle } from './layout'
import type { DbOrTx } from './outbox'
import { type MailTemplateId, mailTemplates } from './templates'
import { toMailLine } from './templates/line'

export const templateScope = (siteId: string | null) =>
  siteId === null ? isNull(mailTemplateTexts.siteId) : eq(mailTemplateTexts.siteId, siteId)

export async function publishedMailText(db: DbOrTx, template: MailTemplateId, siteId?: string) {
  if (mailTemplates[template].scope === 'site' && !siteId) return undefined
  const [row] = await db
    .select({ published: mailTemplateTexts.published })
    .from(mailTemplateTexts)
    .where(
      and(
        templateScope(mailTemplates[template].scope === 'site' ? (siteId ?? null) : null),
        eq(mailTemplateTexts.template, template),
      ),
    )
  const parsed = MailTemplateText.safeParse(row?.published)
  return parsed.success ? parsed.data : undefined
}

/**
 * Оформление писем сайта: его название и опубликованная тема. Берётся при отправке, а не при
 * постановке в очередь: письмо уходит в том виде, какой у сайта сейчас. Сайта нет — undefined,
 * и письмо уйдёт в оформлении Averra CMS
 */
export async function siteMailStyleOf(db: DbOrTx, siteId: string | null | undefined) {
  if (!siteId) return undefined
  const [site] = await db
    .select({ name: sites.name, theme: sites.theme, themePublished: sites.themePublished })
    .from(sites)
    .where(eq(sites.id, siteId))
  return site && siteMailStyle(toMailLine(site.name, 80, 'Сайт'), publishedTheme(site))
}
