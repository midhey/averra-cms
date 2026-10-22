import {
  type LegalFacts,
  type NotificationChannelKind,
  type PageContent,
  parseVideoUrl,
  type SiteSettings,
  type VideoProvider,
  videoProviders,
} from '@averra/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { notificationChannels, notificationRecipients, pages } from '../../db/schema'
import type { EventId } from '../../notifications/events'
import { carries, type NotifyDeps } from '../../notifications/notify'
import { channelConfigs } from '../../notifications/settings'

// Факты сайта для шаблонов политики и согласия (legalPageContent): что на сайте включено на
// самом деле. Шаблон называет только эти сервисы — политика не обещает того, чего нет, и не
// умалчивает о том, что есть

const LEAD_EVENT = 'lead.new' satisfies EventId

type Block = PageContent['blocks'][number]

const blocksOf = (rows: { draft: PageContent | null; published: PageContent | null }[]) =>
  rows.flatMap((row) => [...(row.draft?.blocks ?? []), ...(row.published?.blocks ?? [])])

const isForm = (block: Block): block is Extract<Block, { type: 'form' }> => block.type === 'form'

/** Площадки роликов в блоках «Видео» — в порядке videoProviders, без повторов */
function videoProvidersOf(blocks: Block[]): VideoProvider[] {
  const found = new Set<VideoProvider>()
  for (const block of blocks) {
    if (block.type !== 'video') continue
    // Данные из базы: старая запись могла не пройти нынешнюю схему
    const ref = typeof block.props.url === 'string' ? parseVideoUrl(block.props.url) : undefined
    if (ref) found.add(ref.provider)
  }
  return videoProviders.filter((provider) => found.has(provider))
}

/**
 * Есть ли у сайта получатель «новой заявки» в канале, и канал не выключен в «Уведомлениях».
 * Строки канала в базе нет — он не выключался: по умолчанию каналы включены
 */
async function leadRecipients(db: Db, siteId: string, channel: 'email' | 'telegram') {
  const [row] = await db
    .select({ id: notificationRecipients.id })
    .from(notificationRecipients)
    .leftJoin(notificationChannels, eq(notificationChannels.kind, notificationRecipients.channel))
    .where(
      and(
        eq(notificationRecipients.siteId, siteId),
        eq(notificationRecipients.channel, channel),
        sql`${notificationRecipients.events} @> ${JSON.stringify([LEAD_EVENT])}::jsonb`,
        sql`coalesce(${notificationChannels.enabled}, true)`,
      ),
    )
    .limit(1)
  return row !== undefined
}

/**
 * Уходят ли заявки сотрудникам письмом — так же, как решает notify: письмом их получают
 * подписанные получатели на почте, а если ни один получатель заявку не повезёт (Telegram без
 * бота, токен не расшифровать) — владельцы админки (ownerTargets). Готовность каналов — та же
 * carries, что у отправки. Почту без SMTP считаем работающей: её настроят позже, а политика,
 * которая называет лишний сервис, безопаснее той, что умалчивает об обработке
 */
async function mailsLeads(db: Db, siteId: string, deps: NotifyDeps) {
  const configs = await channelConfigs(db, deps.channels, deps.secretBox)
  if (configs.get('email')?.enabled === false) return false
  const rows = await db
    .select({ channel: notificationRecipients.channel })
    .from(notificationRecipients)
    .where(
      and(
        eq(notificationRecipients.siteId, siteId),
        sql`${notificationRecipients.events} @> ${JSON.stringify([LEAD_EVENT])}::jsonb`,
      ),
    )
  if (rows.some((row) => row.channel === 'email')) return true
  const known = (channel: string): channel is NotificationChannelKind => channel in deps.channels
  return !rows.some(({ channel }) => known(channel) && carries(deps, configs, channel, LEAD_EVENT))
}

/** Дата по Москве, ГГГГ-ММ-ДД: дата редакции документа */
export const moscowDate = (now: Date) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(now)

export async function legalFacts(
  db: Db,
  site: { id: string; leadRetentionDays: number; leadConfirmation: boolean },
  settings: SiteSettings,
  siteUrl: string | null,
  now: Date,
  notify: NotifyDeps,
): Promise<LegalFacts> {
  // Форма и ролик в черновике тоже считаются: политику пишут до того, как они выйдут на сайт
  const rows = await db
    .select({ draft: pages.draft, published: pages.published })
    .from(pages)
    .where(eq(pages.siteId, site.id))
  const blocks = blocksOf(rows)
  const forms = blocks.filter(isForm)
  // Подтверждение посетителю уходит, только если он оставил почту — значит, в форме есть её поле
  const emailField = forms.some((form) =>
    form.props.fields?.some((field) => field.type === 'email'),
  )
  const telegram = await leadRecipients(db, site.id, 'telegram')
  const mail = await mailsLeads(db, site.id, notify)

  return {
    siteName: settings.name,
    siteUrl,
    organization: settings.organization,
    metrika: settings.analytics.metrika !== '',
    ga4: settings.analytics.ga4 !== '',
    cookieMode: settings.cookies.mode,
    forms: forms.length > 0,
    telegram,
    mail,
    visitorConfirmation: site.leadConfirmation && emailField,
    video: videoProvidersOf(blocks),
    leadRetentionDays: site.leadRetentionDays,
    policyPage: settings.cookies.policyPage,
    date: moscowDate(now),
  }
}
