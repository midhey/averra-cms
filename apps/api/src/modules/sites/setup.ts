import { LEGAL_NOTE_BLOCK_ID, legalPages } from '@averra/schema'
import { eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { notificationRecipients, pages } from '../../db/schema'
import { readStoredSettings } from '../settings/read'
import { effectiveSiteUrl } from '../settings/repo'

export async function setupChecklist(
  db: Db,
  site: { id: string; settings: unknown },
  smtp: boolean,
  siteUrl?: string,
) {
  const settings = readStoredSettings(site.settings)
  const organization = settings.organization
  const documents = await db.select().from(pages).where(eq(pages.siteId, site.id))
  const recipients = await db
    .select({ id: notificationRecipients.id, events: notificationRecipients.events })
    .from(notificationRecipients)
    .where(eq(notificationRecipients.siteId, site.id))
  return [
    {
      key: 'organization',
      label: 'Организация и реквизиты',
      to: '/seo' as const,
      done: Boolean(
        organization.name &&
          organization.inn &&
          organization.ogrn &&
          organization.email &&
          organization.address.street,
      ),
    },
    {
      key: 'documents',
      label: 'Документы — подставить своё',
      to: '/pages' as const,
      done: Object.values(legalPages).every(({ slug }) => {
        const document = documents.find((page) => page.slug === slug)
        return (
          document?.published &&
          document.published.blocks.length > 0 &&
          !document.published.blocks.some((block) => block.id === LEGAL_NOTE_BLOCK_ID) &&
          !/\[(?:Заполните своё|укажите [^\]]+|Город[^\]]*)\]/i.test(
            JSON.stringify(document.published),
          )
        )
      }),
    },
    { key: 'smtp', label: 'Почта (SMTP)', to: '/mail' as const, done: smtp },
    {
      key: 'recipients',
      label: 'Получатели заявок',
      to: '/notifications' as const,
      done: recipients.some((recipient) => recipient.events.includes('lead.new')),
    },
    {
      key: 'domain',
      label: 'Домен',
      to: '/seo' as const,
      done: Boolean(effectiveSiteUrl(settings, siteUrl)),
    },
  ]
    .filter((item) => !item.done)
    .map(({ done: _done, ...item }) => item)
}
