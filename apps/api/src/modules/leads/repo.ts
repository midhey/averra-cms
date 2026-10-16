import type { LeadSettings, LeadStatus } from '@averra/schema'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { leads, type StoredLeadField, sites } from '../../db/schema'
import type { DbOrTx } from '../../mail/outbox'

/** Сколько заявок отдаёт список в админке за раз: новые сверху */
export const LEADS_LIST_LIMIT = 500

export type NewLead = {
  siteId: string
  pageId: string
  pageSlug: string
  blockId: string
  formTitle: string
  data: StoredLeadField[]
  consentText: string
  consentPolicyUrl: string
  pageVersion: number | null
  now: Date
}

const leadColumns = {
  id: leads.id,
  pageSlug: leads.pageSlug,
  blockId: leads.blockId,
  formTitle: leads.formTitle,
  data: leads.data,
  consentText: leads.consentText,
  consentPolicyUrl: leads.consentPolicyUrl,
  pageVersion: leads.pageVersion,
  consentedAt: leads.consentedAt,
  status: leads.status,
  processedAt: leads.processedAt,
  createdAt: leads.createdAt,
}

export function leadsRepo(db: Db) {
  const leadIs = (siteId: string, id: string) => and(eq(leads.siteId, siteId), eq(leads.id, id))

  return {
    /** Пишет заявку тем же объектом, что и письма о ней: откатится одно — откатится и другое */
    async insert(tx: DbOrTx, lead: NewLead) {
      const { now, ...values } = lead
      const [row] = await tx
        .insert(leads)
        .values({ ...values, consentedAt: now, createdAt: now })
        .returning({ id: leads.id })
      if (!row) throw new Error('База не вернула сохранённую заявку')
      return row
    },

    /**
     * Заявки сайта, новые сверху. status — только новые или только обработанные. Список
     * в админке — последние LEADS_LIST_LIMIT, выгрузка CSV — все (limit: null): их и так
     * не больше, чем живёт за срок хранения сайта
     */
    list(
      siteId: string,
      { status, limit = LEADS_LIST_LIMIT }: { status?: LeadStatus; limit?: number | null } = {},
    ) {
      const query = db
        .select(leadColumns)
        .from(leads)
        .where(
          status
            ? and(eq(leads.siteId, siteId), eq(leads.status, status))
            : eq(leads.siteId, siteId),
        )
        .orderBy(desc(leads.createdAt), desc(leads.id))
      return limit === null ? query : query.limit(limit)
    },

    async find(siteId: string, id: string) {
      const [row] = await db.select(leadColumns).from(leads).where(leadIs(siteId, id))
      return row
    },

    /** Новая или обработанная. undefined — заявки нет (или она чужого сайта) */
    async setStatus(siteId: string, id: string, status: LeadStatus, now: Date) {
      const [row] = await db
        .update(leads)
        .set({ status, processedAt: status === 'processed' ? now : null })
        .where(leadIs(siteId, id))
        .returning(leadColumns)
      return row
    },

    /** false — такой заявки не было */
    async remove(siteId: string, id: string) {
      const deleted = await db.delete(leads).where(leadIs(siteId, id)).returning({ id: leads.id })
      return deleted.length > 0
    },

    async countNew(siteId: string) {
      const [row] = await db
        .select({ value: count() })
        .from(leads)
        .where(and(eq(leads.siteId, siteId), eq(leads.status, 'new')))
      return row?.value ?? 0
    },

    /**
     * Удаляет заявки старше срока своего сайта (lead_retention_days): в них персональные данные,
     * дольше срока они не лежат (152-ФЗ). Зовёт обработчик очереди писем раз в час
     */
    async cleanup(now: Date) {
      const deleted = await db
        .delete(leads)
        .where(
          sql`${leads.createdAt} < ${now.toISOString()}::timestamptz - make_interval(days => (select ${sites.leadRetentionDays} from ${sites} where ${sites.id} = ${leads.siteId}))`,
        )
        .returning({ id: leads.id })
      return deleted.length
    },

    async settings(siteId: string): Promise<LeadSettings | undefined> {
      const [row] = await db
        .select({
          recipients: sites.leadRecipients,
          retentionDays: sites.leadRetentionDays,
          confirmToVisitor: sites.leadConfirmation,
        })
        .from(sites)
        .where(eq(sites.id, siteId))
      return row
    },

    async saveSettings(siteId: string, settings: LeadSettings, tx: DbOrTx = db) {
      const [row] = await tx
        .update(sites)
        .set({
          leadRecipients: settings.recipients,
          leadRetentionDays: settings.retentionDays,
          leadConfirmation: settings.confirmToVisitor,
        })
        .where(eq(sites.id, siteId))
        .returning({
          recipients: sites.leadRecipients,
          retentionDays: sites.leadRetentionDays,
          confirmToVisitor: sites.leadConfirmation,
        })
      return row
    },
  }
}
