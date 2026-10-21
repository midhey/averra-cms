import {
  type FormField,
  form,
  type LeadSettings,
  type LeadValue,
  MAIN_PAGE_SLUG,
  type MailAddress,
} from '@averra/schema'
import { and, eq, gt, isNotNull, max } from 'drizzle-orm'
import type { SessionUser } from '../../auth/access'
import type { Db } from '../../db/client'
import {
  mailOutbox,
  pageRevisions,
  pages,
  type StoredLeadField,
  sites,
  users,
} from '../../db/schema'
import { mailboxKey } from '../../mail/mailbox-key'
import { type DbOrTx, enqueueMail } from '../../mail/outbox'
import { toMailLine } from '../../mail/templates/line'
import { leadsRepo } from './repo'

// Приём заявки: поиск формы в опубликованной версии страницы и запись заявки вместе
// с письмами о ней. HTTP и антиспам — в public-routes.ts

/** Подтверждение посетителю — не чаще раза в сутки в один ящик с одного сайта */
const CONFIRMATION_PERIOD_MS = 24 * 60 * 60 * 1000

/** Адрес страницы на сайте: главная открывается по корню */
export const pagePath = (slug: string) => (slug === MAIN_PAGE_SLUG ? '/' : `/${slug}`)

/** Форма из опубликованной версии страницы и всё, что нужно, чтобы принять по ней заявку */
export type PublishedForm = NonNullable<Awaited<ReturnType<typeof findPublishedForm>>>

/**
 * Блок «Форма» с этим id в ОПУБЛИКОВАННОЙ версии страницы — не в черновике: принимаем то, что
 * видит посетитель. Данные из базы снова идут в работу, поэтому блок проверяется нынешней схемой.
 * undefined — страница не опубликована, блока нет, это не форма или он не проходит схему
 */
export async function findPublishedForm(
  db: Db,
  siteId: string,
  slug: string,
  blockId: string,
  log?: (message: string) => void,
) {
  const [row] = await db
    .select({
      siteName: sites.name,
      recipients: sites.leadRecipients,
      confirmation: sites.leadConfirmation,
      pageId: pages.id,
      published: pages.published,
    })
    .from(pages)
    .innerJoin(sites, eq(sites.id, pages.siteId))
    .where(and(eq(pages.siteId, siteId), eq(pages.slug, slug), isNotNull(pages.published)))
  const block = row?.published?.blocks.find(
    (candidate) => candidate.id === blockId && candidate.type === 'form',
  )
  if (!row || !block) return undefined
  const props = form.props.safeParse(block.props)
  if (!props.success) {
    // Опубликовали до того, как схема стала строже (например, вариант выбора с табуляцией из
    // Excel): заявки этой формы не принимаются целиком, пока страницу не переопубликуют.
    // Строка в лог — чтобы студия заметила; данных посетителя в ней нет
    log?.(
      `Форма ${siteId}/${slug}/${blockId}: опубликованный блок не проходит схему, заявки не принимаются — переопубликуйте страницу`,
    )
    return undefined
  }
  const [revision] = await db
    .select({ version: max(pageRevisions.version) })
    .from(pageRevisions)
    .where(eq(pageRevisions.pageId, row.pageId))
  return {
    site: {
      id: siteId,
      name: row.siteName,
      recipients: row.recipients,
      confirmation: row.confirmation,
    },
    page: { id: row.pageId, slug, version: revision?.version ?? null },
    blockId,
    props: props.data,
  }
}

/** Значение поля так, как его читает человек: в письме, карточке и CSV */
export function displayValue(field: Pick<StoredLeadField, 'type' | 'value'>) {
  if (typeof field.value === 'boolean') return field.value ? 'да' : 'нет'
  return field.value
}

/** Снимок заявки: ключ, подпись и тип поля рядом со значением — форму потом переименуют */
export function leadSnapshot(fields: readonly FormField[], values: Record<string, LeadValue>) {
  return fields.map(
    (field): StoredLeadField => ({
      name: field.name,
      label: field.label,
      type: field.type,
      // Только своё свойство: ключ поля «constructor» иначе нашёлся бы у Object.prototype
      value:
        (Object.hasOwn(values, field.name) ? values[field.name] : undefined) ??
        (field.type === 'checkbox' ? false : ''),
    }),
  )
}

/** Почта посетителя — первое заполненное поле «Почта». Она уже прошла MailAddress в схеме формы */
function visitorEmail(data: readonly StoredLeadField[]): MailAddress | undefined {
  const email = data.find((field) => field.type === 'email' && field.value !== '')
  return typeof email?.value === 'string' ? email.value : undefined
}

async function ownerEmails(tx: DbOrTx) {
  const rows = await tx.select({ email: users.email }).from(users).where(eq(users.role, 'owner'))
  return rows.map((row) => row.email)
}

/**
 * Ставили ли подтверждение с этого сайта за последние сутки в этот же ящик. Сравниваем ящики
 * (mailboxKey), а не адреса: иначе vasya+1@…, vasya+2@… и V.asya@gmail.com получали бы каждый
 * своё письмо, и форму можно было бы превратить в рассылку в один ящик
 */
async function confirmedRecently(tx: DbOrTx, siteId: string, email: string, now: Date) {
  const [row] = await tx
    .select({ id: mailOutbox.id })
    .from(mailOutbox)
    .where(
      and(
        eq(mailOutbox.siteId, siteId),
        eq(mailOutbox.template, 'lead-received'),
        eq(mailOutbox.recipientKey, mailboxKey(email)),
        gt(mailOutbox.createdAt, new Date(now.getTime() - CONFIRMATION_PERIOD_MS)),
      ),
    )
    .limit(1)
  return row !== undefined
}

type AcceptInput = {
  form: PublishedForm
  /** Проверенные значения по leadValuesSchema: только поля формы и согласие */
  values: Record<string, LeadValue>
  /** Работает ли почта. Нет — заявка сохраняется, письма не ставятся */
  mailEnabled: boolean
  /** Адрес админки: ссылка на заявку в письме владельцу */
  adminUrl: string
  now?: Date
}

/**
 * Заявка и письма о ней — одной транзакцией: упадёт запись письма — не будет и заявки, а посетитель
 * увидит ошибку, а не «отправлено», о котором никто не узнает. Письма: уведомление на адреса сайта
 * (пусто — владельцам админки) с Reply-To посетителя и подтверждение посетителю с фиксированным
 * текстом — если он указал почту, подтверждение на сайте включено и сутки ему его не ставили
 */
export async function acceptLead(db: Db, input: AcceptInput) {
  const { form: published, values, mailEnabled, adminUrl, now = new Date() } = input
  const { site, page, props } = published
  const data = leadSnapshot(props.fields, values)
  const email = visitorEmail(data)

  return db.transaction(async (tx) => {
    const lead = await leadsRepo(db).insert(tx, {
      siteId: site.id,
      pageId: page.id,
      pageSlug: page.slug,
      blockId: published.blockId,
      formTitle: props.title,
      data,
      consentText: props.consentText,
      consentPolicyUrl: props.policyUrl,
      pageVersion: page.version,
      now,
    })
    if (!mailEnabled) return { id: lead.id, notified: 0, confirmed: false }

    const recipients = site.recipients.length > 0 ? site.recipients : await ownerEmails(tx)
    const siteName = toMailLine(site.name, 80, 'сайт')
    for (const to of recipients) {
      await enqueueMail(
        tx,
        {
          template: 'lead-new',
          data: {
            siteName,
            formTitle: toMailLine(props.title, 120, 'Форма'),
            pagePath: pagePath(page.slug),
            fields: data.map((field) => ({
              label: toMailLine(field.label, 80, field.name),
              value: displayValue(field),
            })),
            createdAt: now.toISOString(),
            // Админка без id сайта в адресе: в установке один сайт
            url: `${adminUrl}/leads/${lead.id}`,
            ...(email === undefined ? {} : { replyTo: email }),
          },
          to,
          siteId: site.id,
          leadId: lead.id,
        },
        now,
      )
    }

    let confirmed = false
    if (email && site.confirmation && !(await confirmedRecently(tx, site.id, email, now))) {
      await enqueueMail(
        tx,
        {
          template: 'lead-received',
          data: { siteName },
          to: email,
          siteId: site.id,
          leadId: lead.id,
        },
        now,
      )
      confirmed = true
    }
    return { id: lead.id, notified: recipients.length, confirmed }
  })
}

type SettingsInput = {
  siteId: string
  settings: LeadSettings
  /** Кто меняет: имя и почта уйдут в письмо о смене адресов */
  user: SessionUser
  mailEnabled: boolean
  now?: Date
}

/**
 * Сохраняет настройки заявок сайта. Сменились адреса уведомлений — в той же транзакции письмо
 * всем владельцам и прежним адресам: клиент может направить заявки (персональные данные) куда
 * угодно, и это не должно пройти молча. undefined — сайта нет
 */
export async function saveLeadSettings(db: Db, input: SettingsInput) {
  const { siteId, settings, user, mailEnabled, now = new Date() } = input
  const repo = leadsRepo(db)
  return db.transaction(async (tx) => {
    const [site] = await tx
      .select({ name: sites.name, recipients: sites.leadRecipients })
      .from(sites)
      .where(eq(sites.id, siteId))
      .for('update')
    if (!site) return undefined
    const saved = await repo.saveSettings(siteId, settings, tx)
    const before = [...site.recipients].sort().join(',')
    const after = [...settings.recipients].sort().join(',')
    if (!mailEnabled || before === after) return saved

    const notify = new Set([...(await ownerEmails(tx)), ...site.recipients])
    for (const to of notify) {
      await enqueueMail(
        tx,
        {
          template: 'lead-recipients-changed',
          data: {
            siteName: toMailLine(site.name, 80, 'сайт'),
            changedBy: toMailLine(user.name, 100, 'Пользователь'),
            changedByEmail: user.email,
            changedAt: now.toISOString(),
            recipients: settings.recipients,
          },
          to,
          siteId,
        },
        now,
      )
    }
    return saved
  })
}
