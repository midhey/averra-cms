import {
  type FormField,
  form,
  type LeadValue,
  MAIN_PAGE_SLUG,
  type MailAddress,
} from '@averra/schema'
import { and, eq, gt, isNotNull, max } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { mailOutbox, pageRevisions, pages, type StoredLeadField, sites } from '../../db/schema'
import { mailboxKey } from '../../mail/mailbox-key'
import { type DbOrTx, enqueueMail } from '../../mail/outbox'
import { toMailLine } from '../../mail/templates/line'
import { type NotifyDeps, notify } from '../../notifications/notify'
import { leadsRepo } from './repo'

// Приём заявки: поиск формы в опубликованной версии страницы и запись заявки вместе
// с уведомлениями о ней (модуль уведомлений) и подтверждением посетителю. HTTP и антиспам —
// в public-routes.ts

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
  /** Каналы уведомлений и состояние почты: что не готово, туда не ставим */
  notifications: NotifyDeps
  /** Адрес админки: ссылка на заявку в уведомлении */
  adminUrl: string
  now?: Date
}

/**
 * Заявка и уведомления о ней — одной транзакцией: упадёт запись уведомления — не будет и заявки,
 * а посетитель увидит ошибку, а не «отправлено», о котором никто не узнает. Уведомление «Новая
 * заявка» — получателям сайта по готовым каналам (никого — владельцам письмом, notify).
 * Подтверждение посетителю с фиксированным текстом — письмом, если почта работает, он указал
 * почту, подтверждение на сайте включено и сутки ему его не ставили
 */
export async function acceptLead(db: Db, input: AcceptInput) {
  const { form: published, values, notifications, adminUrl, now = new Date() } = input
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
    const siteName = toMailLine(site.name, 80, 'сайт')
    const { queued } = await notify(tx, notifications, {
      event: 'lead.new',
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
      siteId: site.id,
      leadId: lead.id,
      now,
    })

    let confirmed = false
    if (
      notifications.readiness.mailEnabled &&
      email &&
      site.confirmation &&
      !(await confirmedRecently(tx, site.id, email, now))
    ) {
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
    return { id: lead.id, notified: queued, confirmed }
  })
}
