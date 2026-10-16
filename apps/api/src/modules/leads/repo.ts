import type { LeadSettings, LeadStatus } from '@averra/schema'
import { and, count, desc, eq, gt, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { leads, type StoredLeadField, sites } from '../../db/schema'
import type { DbOrTx } from '../../mail/outbox'

/** Сколько заявок отдаёт список в админке за раз: новые сверху */
export const LEADS_LIST_LIMIT = 500

/** Порция выгрузки CSV: в памяти API лежит она, а не все заявки сайта */
export const LEADS_EXPORT_BATCH = 500

/**
 * Размер данных заявки в байтах — UTF-8 её JSON. Его пишет колонка data_bytes, по нему считаются
 * дневной предел объёма и порог «маленькой» заявки. Веб-стандартный TextEncoder, не Node API
 */
export function storedLeadBytes(data: readonly StoredLeadField[]) {
  return new TextEncoder().encode(JSON.stringify(data)).length
}

/** Курсор выгрузки: время последней строки порции текстом (с микросекундами) и её id */
export type ExportCursor = { at: string; id: string }

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
        .values({
          ...values,
          dataBytes: storedLeadBytes(values.data),
          consentedAt: now,
          createdAt: now,
        })
        .returning({ id: leads.id })
      if (!row) throw new Error('База не вернула сохранённую заявку')
      return row
    },

    /**
     * Заявки сайта, новые сверху, последние LEADS_LIST_LIMIT. status — только новые или только
     * обработанные. Все заявки сайта — порциями через exportBatch
     */
    list(siteId: string, { status }: { status?: LeadStatus } = {}) {
      return db
        .select(leadColumns)
        .from(leads)
        .where(
          status
            ? and(eq(leads.siteId, siteId), eq(leads.status, status))
            : eq(leads.siteId, siteId),
        )
        .orderBy(desc(leads.createdAt), desc(leads.id))
        .limit(LEADS_LIST_LIMIT)
    },

    /**
     * Подписи полей всех заявок сайта — колонки CSV. Каждая подпись берётся из самой свежей
     * заявки, где она есть (distinct on), вместе со своим местом в ней. Порядок: подписи свежих
     * заявок слева и в порядке полей этой заявки, старые подписи справа. Переставили поля
     * в форме — колонки идут как в новой форме
     */
    async exportLabels(siteId: string) {
      const rows = await db.execute<{ label: string }>(sql`
        select label from (
          select distinct on (field.value ->> 'label')
            field.value ->> 'label' as label, l.created_at, l.id, field.position
          from ${leads} l
            cross join lateral jsonb_array_elements(l.data) with ordinality as field(value, position)
          where l.site_id = ${siteId}
          order by field.value ->> 'label', l.created_at desc, l.id desc
        ) latest
        order by created_at desc, id desc, position, label`)
      return rows.rows.map((row) => row.label)
    },

    /**
     * Следующая порция заявок сайта для выгрузки, новые сверху. after — курсор последней строки
     * прошлой порции (cursorAt и id из неё). Время ходит текстом timestamptz, без перевода в Date:
     * микросекунды не теряются, строки не повторяются и не пропадают. Курсор — значения, а не
     * ссылка на строку: удалили граничную заявку во время выгрузки (руками или чисткой по сроку) —
     * выгрузка продолжается со следующей
     */
    exportBatch(siteId: string, after?: ExportCursor, size = LEADS_EXPORT_BATCH) {
      const cursor = after
        ? sql`(${leads.createdAt}, ${leads.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`
        : undefined
      return db
        .select({ ...leadColumns, cursorAt: sql<string>`${leads.createdAt}::text` })
        .from(leads)
        .where(cursor ? and(eq(leads.siteId, siteId), cursor) : eq(leads.siteId, siteId))
        .orderBy(desc(leads.createdAt), desc(leads.id))
        .limit(size)
    },

    /**
     * Сколько байт данных заявок сайт принял с момента since — для дневного предела объёма.
     * Считается в базе, поэтому переживает перезапуск API. Сумма колонки data_bytes по индексу
     * сайта и времени — jsonb заявок не распаковывается
     */
    async storedBytesSince(siteId: string, since: Date) {
      const [row] = await db
        .select({
          bytes: sql`coalesce(sum(${leads.dataBytes}), 0)`.mapWith(Number),
        })
        .from(leads)
        .where(and(eq(leads.siteId, siteId), gt(leads.createdAt, since)))
      return row?.bytes ?? 0
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
