import type {
  LegalFacts,
  NOTIFICATION_EVENT_TITLES,
  PageContent,
  SiteSettings,
} from '@averra/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { notificationChannels, notificationRecipients, pages } from '../../db/schema'

// Факты сайта для шаблонов политики и согласия (legalPageContent): что на сайте включено на
// самом деле. Шаблон называет только эти сервисы — политика не обещает того, чего нет, и не
// умалчивает о том, что есть

const LEAD_EVENT = 'lead.new' satisfies keyof typeof NOTIFICATION_EVENT_TITLES

const hasForm = (content: PageContent | null) =>
  content?.blocks.some((block) => block.type === 'form') ?? false

/** Дата по Москве, ГГГГ-ММ-ДД: дата редакции документа */
export const moscowDate = (now: Date) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(now)

export async function legalFacts(
  db: Db,
  site: { id: string; leadRetentionDays: number },
  settings: SiteSettings,
  siteUrl: string | null,
  now: Date,
): Promise<LegalFacts> {
  // Форма в черновике тоже считается: политику пишут до того, как форма выйдет на сайт
  const rows = await db
    .select({ draft: pages.draft, published: pages.published })
    .from(pages)
    .where(eq(pages.siteId, site.id))
  const forms = rows.some((row) => hasForm(row.draft) || hasForm(row.published))

  // Заявки уходят в Telegram: у сайта есть чат-получатель «новой заявки», и канал не выключен
  const [telegram] = await db
    .select({ id: notificationRecipients.id })
    .from(notificationRecipients)
    .leftJoin(notificationChannels, eq(notificationChannels.kind, notificationRecipients.channel))
    .where(
      and(
        eq(notificationRecipients.siteId, site.id),
        eq(notificationRecipients.channel, 'telegram'),
        sql`${notificationRecipients.events} @> ${JSON.stringify([LEAD_EVENT])}::jsonb`,
        sql`coalesce(${notificationChannels.enabled}, true)`,
      ),
    )
    .limit(1)

  return {
    siteName: settings.name,
    siteUrl,
    organization: settings.organization,
    metrika: settings.analytics.metrika !== '',
    ga4: settings.analytics.ga4 !== '',
    cookieMode: settings.cookies.mode,
    forms,
    telegram: telegram !== undefined,
    leadRetentionDays: site.leadRetentionDays,
    policyPage: settings.cookies.policyPage,
    date: moscowDate(now),
  }
}
