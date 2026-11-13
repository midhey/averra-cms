import { MailTemplateText } from '@averra/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { mailTemplateTexts } from '../db/schema'
import type { DbOrTx } from './outbox'
import { type MailTemplateId, mailTemplates } from './templates'

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
