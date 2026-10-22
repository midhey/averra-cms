import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { media, pageRevisions, pages, sites } from '../../db/schema'
import { type MediaStorage, mediaKey } from '../../media/storage'
import { notificationSettingsRepo } from '../../notifications/settings'
import { type ExportCursor, LEADS_EXPORT_BATCH, leadsRepo } from '../leads/repo'
import { readStoredSettings } from '../settings/read'
import type { ZipEntry } from './zip'

// Полный экспорт данных сайта (принцип 8 «клиент не заложник»): всё, что человек завёл в этой
// установке, в открытом формате — JSON и оригиналы картинок. Без секретов установки (SMTP,
// токены, пароли): это данные сайта, а не сервера

/** Формат файла site.json. Меняется — растёт номер, а README.txt в архиве описывает поля */
const EXPORT_FORMAT_VERSION = 1

const README = `Выгрузка сайта из Averra CMS
============================

site.json — все данные сайта (формат averra-site-export, версия ${EXPORT_FORMAT_VERSION}):
  site      — название, тема оформления (цвета, шрифты), настройки заявок (leadSettings:
              recipients — адреса почты для заявок, notificationRecipients — все получатели
              уведомлений о заявках: канал, адрес или id чата Telegram, название, события)
              и SEO (settings:
              шаблон заголовка, описание, язык, адрес, индексация, иконка, коды проверки,
              счётчики аналитики, организация, редиректы);
  pages     — страницы: адрес (slug), черновик (draft) и опубликованная версия (published)
              с заголовками; блоки страницы — JSON по схемам блоков Averra;
              revisions — история публикаций страницы;
  media     — картинки: исходное имя, тип, размеры и путь к оригиналу в этом архиве (file);
  leads     — заявки с форм: поля с подписями, согласие на обработку персональных данных
              (текст, политика, версия страницы, время), состояние;
  missingFiles — картинки, файла которых не оказалось в хранилище при выгрузке.

media/<id>/original.* — оригиналы картинок в полном размере, без метаданных (EXIF удалён
при загрузке).

В заявках — персональные данные посетителей сайта. Храните выгрузку как сами заявки:
не пересылайте в открытом виде и удалите, когда она больше не нужна (152-ФЗ).

Готовый сайт статикой (HTML, CSS, картинки) выгружается отдельно: «Скачать сайт архивом».
`

const iso = (value: Date | null) => value?.toISOString() ?? null

/** Значение JSON с отступами, сдвинутое на depth уровней: так site.json читается глазами */
function pretty(value: unknown, depth: number) {
  return JSON.stringify(value, null, 2).replaceAll('\n', `\n${'  '.repeat(depth)}`)
}

/** Сколько байт займут оригиналы картинок: для предела ZIP до начала выгрузки */
export async function siteMediaBytes(db: Db, siteId: string) {
  const rows = await db.select({ size: media.size }).from(media).where(eq(media.siteId, siteId))
  return rows.reduce((sum, row) => sum + row.size, 0)
}

type ExportSource = {
  db: Db
  storage: MediaStorage
  siteId: string
  version: string
  now: Date
  /** Порция заявок (по умолчанию — как у CSV): тесты берут маленькую */
  leadsBatch?: number
}

/**
 * Файлы архива данных сайта: сначала оригиналы картинок (по одному — в памяти один файл),
 * потом site.json — в нём уже известно, каких файлов не нашлось. Порядок в ZIP не важен.
 * site.json пишется потоком: страницы по одной (с историей этой страницы), заявки порциями
 * с курсором, как CSV заявок, — в памяти API порция, а не все данные сайта
 */
export async function* siteDataEntries(source: ExportSource): AsyncGenerator<ZipEntry> {
  const { db, storage, siteId, now } = source
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId))
  if (!site) throw new Error(`Сайт ${siteId} пропал во время выгрузки`)
  // Получатели — из модуля уведомлений, а не из устаревшей sites.lead_recipients: там только
  // почта, и колонку удалят. recipients оставлен ради формата версии 1
  const recipients = (await notificationSettingsRepo(db).recipients(siteId)).map((row) => ({
    channel: row.channel,
    address: row.address,
    label: row.label,
    events: row.events,
  }))
  // Строки медиатеки — описания картинок, по сотне байт: их держим, а файлы — по одному
  const mediaRows = await db
    .select()
    .from(media)
    .where(eq(media.siteId, siteId))
    .orderBy(asc(media.createdAt), asc(media.id))

  const missingFiles: string[] = []
  const mediaView = []
  for (const item of mediaRows) {
    const path = `media/${item.id}/${item.originalFile}`
    const data = await storage.get(mediaKey(siteId, item.id, item.originalFile))
    if (data) yield { name: path, compress: false, data, mtime: item.createdAt }
    else missingFiles.push(path)
    mediaView.push({
      id: item.id,
      originalName: item.originalName,
      mimeType: item.mimeType,
      width: item.width,
      height: item.height,
      size: item.size,
      createdAt: item.createdAt.toISOString(),
      file: data ? path : null,
      variants: item.variants.map(({ format, width, height, size }) => ({
        format,
        width,
        height,
        size,
      })),
    })
  }

  const header = {
    format: 'averra-site-export',
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    averraVersion: source.version,
    site: {
      id: site.id,
      name: site.name,
      theme: site.theme,
      createdAt: site.createdAt.toISOString(),
      leadSettings: {
        recipients: recipients
          .filter((row) => row.channel === 'email' && row.events.includes('lead.new'))
          .map((row) => row.address),
        notificationRecipients: recipients,
        retentionDays: site.leadRetentionDays,
        confirmToVisitor: site.leadConfirmation,
      },
      settings: readStoredSettings(site.settings),
    },
  }
  const tail = { media: mediaView, missingFiles }
  yield {
    name: 'site.json',
    compress: true,
    data: siteJson(source, header, tail),
    mtime: now,
  }
  yield { name: 'README.txt', compress: true, data: new TextEncoder().encode(README), mtime: now }
}

/**
 * site.json кусками: шапка, страницы по одной, медиатека, заявки порциями, missingFiles. Поля
 * верхнего уровня — те же, что в формате версии 1
 */
async function* siteJson(
  { db, siteId, leadsBatch = LEADS_EXPORT_BATCH }: ExportSource,
  header: Record<string, unknown>,
  tail: { media: unknown[]; missingFiles: string[] },
): AsyncGenerator<Uint8Array> {
  const text = new TextEncoder()
  const head = pretty(header, 0)
  // Шапка без закрывающей «}»: дальше идут массивы
  yield text.encode(`${head.slice(0, -2)},\n  "pages": [`)

  // Страниц у лендинга — десятки: список берём целиком, историю — по одной странице
  const pageRows = await db
    .select()
    .from(pages)
    .where(eq(pages.siteId, siteId))
    .orderBy(asc(pages.slug))
  for (const [index, page] of pageRows.entries()) {
    const revisions = await db
      .select({
        version: pageRevisions.version,
        title: pageRevisions.title,
        content: pageRevisions.content,
        publishedAt: pageRevisions.publishedAt,
      })
      .from(pageRevisions)
      .where(and(eq(pageRevisions.siteId, siteId), eq(pageRevisions.pageId, page.id)))
      .orderBy(asc(pageRevisions.version))
    const view = {
      slug: page.slug,
      title: page.title,
      draft: page.draft,
      publishedTitle: page.publishedTitle,
      published: page.published,
      publishedAt: iso(page.publishedAt),
      updatedAt: page.updatedAt.toISOString(),
      revisions: revisions.map((revision) => ({
        version: revision.version,
        title: revision.title,
        content: revision.content,
        publishedAt: revision.publishedAt.toISOString(),
      })),
    }
    yield text.encode(`${index === 0 ? '' : ','}\n    ${pretty(view, 2)}`)
  }

  const pagesEnd = pageRows.length > 0 ? '\n  ' : ''
  yield text.encode(`${pagesEnd}],\n  "media": ${pretty(tail.media, 1)},\n  "leads": [`)
  // Заявки — порциями с курсором, новые сверху (как CSV): их может быть много за срок хранения
  const repo = leadsRepo(db)
  let after: ExportCursor | undefined
  let first = true
  for (;;) {
    const batch = await repo.exportBatch(siteId, after, leadsBatch)
    const last = batch.at(-1)
    if (!last) break
    const chunk = batch
      .map((lead) => {
        const view = {
          id: lead.id,
          pageSlug: lead.pageSlug,
          blockId: lead.blockId,
          formTitle: lead.formTitle,
          data: lead.data,
          consentText: lead.consentText,
          consentPolicyUrl: lead.consentPolicyUrl,
          pageVersion: lead.pageVersion,
          consentedAt: lead.consentedAt.toISOString(),
          status: lead.status,
          processedAt: iso(lead.processedAt),
          createdAt: lead.createdAt.toISOString(),
        }
        const line = `${first ? '' : ','}\n    ${pretty(view, 2)}`
        first = false
        return line
      })
      .join('')
    yield text.encode(chunk)
    if (batch.length < leadsBatch) break
    after = { at: last.cursorAt, id: last.id }
  }
  const leadsEnd = first ? '' : '\n  '
  yield text.encode(`${leadsEnd}],\n  "missingFiles": ${pretty(tail.missingFiles, 1)}\n}\n`)
}
