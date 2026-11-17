import { customBlockProblems } from '@averra/blocks/custom-engine'
import {
  applyCustomBlocks,
  collectMediaRefs,
  customPlaceIssues,
  footerMediaIds,
  headerMediaIds,
  LEGAL_NOTE_BLOCK_ID,
  legacyTheme,
  MAIN_PAGE_SLUG,
  PageContent,
  readSiteScript,
  SiteTemplate,
  TEMPLATE_FORMAT_VERSION,
  TEMPLATE_JSON_MAX_BYTES,
  TEMPLATE_MAX_BYTES,
  TemplateSettings,
  themeMediaIds,
} from '@averra/schema'
import { eq, sql } from 'drizzle-orm'
import { Unzip, UnzipInflate } from 'fflate'
import type { Db } from '../../db/client'
import {
  customBlockRevisions,
  customBlocks,
  mailTemplateTexts,
  media,
  pages,
  sites,
} from '../../db/schema'
import { type EditableTemplate, validateTemplateText } from '../../mail/template-text'
import { MailTemplateId, mailTemplates } from '../../mail/templates'
import type { ImageProcessor } from '../../media/processor'
import { type MediaStorage, mediaKey } from '../../media/storage'
import { readDefinition, storedParts } from '../custom-blocks/repo'
import { cssMediaIds } from '../custom-blocks/service'
import { draftFooter, publishedFooter } from '../footer/read'
import { draftHeader, publishedHeader } from '../header/read'
import { contentMediaIssues } from '../media/refs'
import { createMediaPreparer, displayName } from '../media/routes'
import { readStoredSettings } from '../settings/read'
import { recordSiteRevision } from '../site-revisions/repo'
import { publishPage } from '../sites/repo'
import { publishedTheme } from '../theme/read'
import type { ZipEntry } from './zip'

export class TemplateError extends Error {
  override name = 'TemplateError'
}

/** Ссылки считаются по переносимому снимку, поэтому лишние оригиналы в шаблон не попадут. */
function usedMedia(template: SiteTemplate) {
  return new Set([
    ...template.pages.flatMap((page) => collectMediaRefs(page.content).map((ref) => ref.mediaId)),
    ...themeMediaIds(template.site.theme),
    ...headerMediaIds(template.site.header),
    ...footerMediaIds(template.site.footer),
    ...[template.site.settings.icon, template.site.settings.ogImage].filter((id) => id !== null),
    ...template.customBlocks.flatMap(({ definition }) => [
      ...cssMediaIds(definition.css),
      ...collectMediaRefs(definition.example).map((ref) => ref.mediaId),
    ]),
  ])
}

/** Известные реквизиты убираются и из копий в документах, подвале и текстах писем. */
function withoutOrganization<T>(
  value: T,
  organization: ReturnType<typeof readStoredSettings>['organization'],
  siteUrl: string,
): T {
  const privateValues = [
    organization.name,
    organization.phone,
    organization.email,
    organization.inn,
    organization.ogrn,
    ...Object.values(organization.address),
    ...organization.socials,
  ]
    .filter((text) => text.length > 0)
    .sort((a, b) => b.length - a.length)
  const clean = (item: unknown): unknown => {
    if (typeof item === 'string') {
      if (/^(?:mailto:|tel:)/i.test(item)) return '#'
      if (organization.socials.includes(item)) return 'https://example.invalid'
      let text = item
      if (siteUrl) {
        text = text.replaceAll(siteUrl, 'https://example.invalid')
        text = text.replaceAll(new URL(siteUrl).hostname, 'example.invalid')
      }
      // Адрес должен остаться адресом: название организации может совпасть с частью домена.
      if (/^https?:\/\//i.test(text)) return text
      return privateValues.reduce(
        (text, secret) => text.replaceAll(secret, '[Заполните своё]'),
        text,
      )
    }
    if (Array.isArray(item)) return item.map(clean)
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item).map(([key, child]) => [
          key,
          [
            'id',
            'type',
            'key',
            'mediaId',
            'slug',
            'file',
            'format',
            'averraVersion',
            'script',
            'css',
            'template',
            'windowCss',
            'origins',
          ].includes(key)
            ? child
            : clean(child),
        ]),
      )
    }
    return item
  }
  return clean(value) as T
}

export async function templateEntries({
  db,
  storage,
  siteId,
  version,
  siteUrl,
}: {
  db: Db
  storage: MediaStorage
  siteId: string
  version: string
  siteUrl?: string | undefined
}): Promise<ZipEntry[]> {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId))
  if (!site) throw new TemplateError('Сайт не найден')
  const settings = readStoredSettings(site.settings)
  const pageRows = await db.select().from(pages).where(eq(pages.siteId, siteId))
  const blockRows = await db.select().from(customBlocks).where(eq(customBlocks.siteId, siteId))
  const mailRows = await db
    .select()
    .from(mailTemplateTexts)
    .where(eq(mailTemplateTexts.siteId, siteId))
  const template = SiteTemplate.parse(
    withoutOrganization(
      {
        format: 'averra-site-template',
        formatVersion: TEMPLATE_FORMAT_VERSION,
        averraVersion: version,
        site: {
          name: site.name,
          theme: publishedTheme(site),
          header: publishedHeader(site) ?? (site.headerDraft ? draftHeader(site) : null),
          footer: publishedFooter(site) ?? (site.footerDraft ? draftFooter(site) : null),
          script: readSiteScript(site.scriptPublished ?? site.scriptDraft),
          settings: TemplateSettings.parse(
            Object.fromEntries(
              Object.keys(TemplateSettings.shape).map((key) => [
                key,
                settings[key as keyof typeof settings],
              ]),
            ),
          ),
        },
        pages: pageRows.map((page) => {
          const content = structuredClone(page.published ?? page.draft)
          // Canonical принадлежит прежнему домену, на новой установке его вычисляет рендерер.
          if (content.seo) delete content.seo.canonical
          for (const block of content.blocks) {
            if (block.type === 'contacts') {
              for (const key of ['phone', 'email', 'coordinates', 'mapImage'] as const)
                delete block.props[key]
              block.props.address = '[Город, улица, дом, офис]'
            }
          }
          return {
            slug: page.slug,
            title: page.publishedTitle ?? page.title,
            content,
            published: page.published !== null,
          }
        }),
        customBlocks: blockRows.map((block) => {
          const definition = readDefinition(
            block.published ?? block.draft,
            block.published ? block.scriptPublished : block.scriptDraft,
          )
          if (!definition) throw new TemplateError(`Свой блок «${block.key}» не прошёл проверку`)
          return { definition, published: block.published !== null }
        }),
        mailTemplates: mailRows.flatMap((row) => {
          const text = row.published ?? row.draft
          return text ? [{ template: row.template, text, published: row.published !== null }] : []
        }),
        media: [],
      },
      settings.organization,
      settings.url || siteUrl || '',
    ),
  )
  // Код нельзя переписывать подстановками: это может сломать JS, CSS или Liquid. При известных
  // реквизитах в нём отказываем до начала ответа, чтобы они не попали в переносимый архив.
  const code = [
    template.site.script.script,
    template.site.theme.windowCss,
    ...template.customBlocks.flatMap(({ definition }) => [
      definition.script,
      definition.css,
      definition.template,
    ]),
  ].join('\n')
  const organization = settings.organization
  const privateValues = [
    organization.name,
    organization.phone,
    organization.email,
    organization.inn,
    organization.ogrn,
    ...Object.values(organization.address),
    ...organization.socials,
  ]
  if (privateValues.some((value) => value.length >= 3 && code.includes(value))) {
    throw new TemplateError(
      'В коде сайта остались контакты или реквизиты организации. Уберите их из скрипта, CSS и шаблонов своих блоков перед выгрузкой',
    )
  }
  const refs = usedMedia(template)
  const mediaRows = await db.select().from(media).where(eq(media.siteId, siteId))
  const entries: ZipEntry[] = []
  let total = 0
  for (const id of refs) {
    const row = mediaRows.find((item) => item.id === id)
    if (!row) throw new TemplateError(`Картинки ${id} нет в медиатеке`)
    total += row.size
    if (total > TEMPLATE_MAX_BYTES) throw new TemplateError('Шаблон больше 256 МБ')
    const file = `media/${id}/${row.originalFile}`
    template.media.push({ id, originalName: 'картинка', file })
    const originalFile = row.originalFile
    async function* original() {
      const data = await storage.get(mediaKey(siteId, id, originalFile))
      if (!data) throw new TemplateError(`Не найден оригинал картинки ${id}`)
      yield data
    }
    entries.push({ name: file, compress: false, data: original() })
  }
  const json = new TextEncoder().encode(JSON.stringify(SiteTemplate.parse(template), null, 2))
  if (json.length > TEMPLATE_JSON_MAX_BYTES || total + json.length > TEMPLATE_MAX_BYTES) {
    throw new TemplateError(
      'Шаблон больше допустимого размера: JSON до 16 МБ, весь архив до 256 МБ',
    )
  }
  entries.push({ name: 'template.json', compress: true, data: json })
  return entries
}

/** Не извлекает пути на диск; предел проверяется по распакованным байтам, а не заголовку ZIP. */
export function readTemplateArchive(bytes: Uint8Array) {
  if (bytes.length > TEMPLATE_MAX_BYTES) throw new TemplateError('Архив шаблона больше 256 МБ')
  const files = new Map<string, Uint8Array>()
  let total = 0
  let count = 0
  let completed = 0
  const unzip = new Unzip((file) => {
    if (
      ++count > 2001 ||
      files.has(file.name) ||
      !/^(template\.json|media\/[0-9a-f-]{36}\/(original\.(jpg|png|webp|avif)|image\.svg))$/.test(
        file.name,
      )
    ) {
      throw new TemplateError('Недопустимые или повторяющиеся файлы в шаблоне')
    }
    files.set(file.name, new Uint8Array())
    const chunks: Uint8Array[] = []
    let size = 0
    file.ondata = (error, chunk, final) => {
      if (error) throw new TemplateError('Повреждённый ZIP шаблона')
      total += chunk.length
      size += chunk.length
      if (
        total > TEMPLATE_MAX_BYTES ||
        (file.name === 'template.json' && size > TEMPLATE_JSON_MAX_BYTES)
      ) {
        throw new TemplateError('Распакованный шаблон больше допустимого размера')
      }
      chunks.push(chunk)
      if (final) {
        const data = new Uint8Array(size)
        let offset = 0
        for (const part of chunks) {
          data.set(part, offset)
          offset += part.length
        }
        files.set(file.name, data)
        completed++
      }
    }
    const limit = file.name === 'template.json' ? TEMPLATE_JSON_MAX_BYTES : TEMPLATE_MAX_BYTES
    if (file.originalSize !== undefined && file.originalSize > limit) {
      throw new TemplateError('Распакованный файл шаблона больше допустимого размера')
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  try {
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      unzip.push(bytes.subarray(offset, offset + 65536), offset + 65536 >= bytes.length)
    }
    const json = files.get('template.json')
    if (!json || completed !== count) throw new TemplateError('Неполный архив шаблона')
    const parsed = SiteTemplate.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)),
    )
    if (!parsed.success)
      throw new TemplateError(
        `Шаблон не прошёл проверку: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} — ${issue.message}`).join('; ')}`,
      )
    for (const item of parsed.data.media) {
      if (!files.has(item.file) || !item.file.startsWith(`media/${item.id}/`))
        throw new TemplateError('В архиве нет оригинала картинки из template.json')
    }
    if (files.size !== parsed.data.media.length + 1)
      throw new TemplateError('В архиве есть файлы вне template.json')
    return { template: parsed.data, files }
  } catch (error) {
    if (error instanceof TemplateError) throw error
    throw new TemplateError('Архив шаблона повреждён или не содержит корректный template.json')
  }
}

/** Только нетронутая главная: даже пустая опубликованная страница уже может быть живым сайтом. */
async function assertEmpty(db: Pick<Db, 'select'>, siteId: string) {
  const rows = await db.select().from(pages).where(eq(pages.siteId, siteId))
  if (
    rows.some(
      (page) =>
        page.slug !== MAIN_PAGE_SLUG ||
        page.published !== null ||
        JSON.stringify(page.draft) !== '{"blocks":[]}',
    )
  ) {
    throw new TemplateError(
      'На сайте уже есть свои страницы или содержимое главной. Шаблон можно импортировать только в новую установку',
    )
  }
  const blocks = await db
    .select({ id: customBlocks.id })
    .from(customBlocks)
    .where(eq(customBlocks.siteId, siteId))
  if (blocks.length)
    throw new TemplateError(
      'На сайте уже есть свои блоки. Импорт разрешён только в новую установку',
    )
}

export async function importTemplate({
  db,
  storage,
  images,
  maxBytes,
  siteId,
  bytes,
}: {
  db: Db
  storage: MediaStorage
  images: ImageProcessor
  maxBytes: number
  siteId: string
  bytes: Uint8Array
}) {
  await assertEmpty(db, siteId)
  const { template, files } = readTemplateArchive(bytes)
  const refs = usedMedia(template)
  if ([...refs].some((id) => !template.media.some((item) => item.id === id)))
    throw new TemplateError('Шаблон ссылается на отсутствующую картинку')
  if (template.media.some((item) => !refs.has(item.id)))
    throw new TemplateError('В шаблоне есть неиспользуемые картинки')
  const definitions = template.customBlocks
    .filter((block) => block.published)
    .map((block) => block.definition)
  for (const [custom, placement] of [
    [template.site.header?.custom, 'header'],
    [template.site.footer?.custom, 'footer'],
  ] as const) {
    if (customPlaceIssues(custom ?? null, placement, definitions).length) {
      throw new TemplateError('Свой вид шапки или подвала не прошёл проверку')
    }
  }
  for (const page of template.pages) {
    const applied = applyCustomBlocks(page.content, definitions)
    if (applied.issues.length)
      throw new TemplateError(`Свои блоки страницы «${page.slug}» не прошли проверку`)
    page.content = PageContent.parse(applied.content)
  }
  for (const { definition } of template.customBlocks) {
    if (
      customBlockProblems(definition, { mediaIds: refs }).some(
        (problem) => problem.level === 'error',
      )
    ) {
      throw new TemplateError(`Свой блок «${definition.key}» не прошёл проверку`)
    }
  }
  for (const mail of template.mailTemplates) {
    const id = MailTemplateId.safeParse(mail.template)
    if (!id.success || mailTemplates[id.data].scope !== 'site')
      throw new TemplateError('В шаблоне есть служебное письмо установки')
    try {
      validateTemplateText(mailTemplates[id.data] as EditableTemplate, mail.text)
    } catch {
      throw new TemplateError(`Текст письма «${mail.template}» не прошёл проверку`)
    }
  }
  const prepare = createMediaPreparer(images)
  const prepared: {
    item: SiteTemplate['media'][number]
    upload: Extract<Awaited<ReturnType<typeof prepare>>, { ok: true }>
    size: number
    id: string
  }[] = []
  // До первой записи проверяем все оригиналы тем же обработчиком, что POST медиатеки.
  for (const item of template.media) {
    const data = files.get(item.file)
    if (!data) throw new TemplateError('Не найден оригинал картинки в архиве')
    if (data.length > maxBytes)
      throw new TemplateError('Картинка в шаблоне превышает лимит медиатеки')
    const upload = await prepare(data)
    if (!upload.ok) throw new TemplateError(upload.failure.message)
    prepared.push({ item, upload, size: upload.size ?? data.length, id: crypto.randomUUID() })
  }
  const types = new Map(prepared.map(({ item, upload }) => [item.id, upload.mimeType]))
  for (const page of template.pages) {
    const issues = contentMediaIssues(types, page.content)
    if (issues.length)
      throw new TemplateError(
        `Картинки страницы «${page.slug}»: ${issues.map((issue) => issue.message).join('; ')}`,
      )
  }
  for (const { definition } of template.customBlocks) {
    for (const ref of collectMediaRefs(definition.example)) {
      if (types.get(ref.mediaId) === 'image/svg+xml')
        throw new TemplateError('В примере своего блока нужна растровая картинка')
    }
  }
  if (
    template.site.settings.ogImage &&
    types.get(template.site.settings.ogImage) === 'image/svg+xml'
  ) {
    throw new TemplateError('Картинка для соцсетей должна быть растровой')
  }
  const replacements = new Map(prepared.map(({ item, id }) => [item.id, id]))
  const remapped = SiteTemplate.parse(
    JSON.parse(
      JSON.stringify(template).replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        (id) => replacements.get(id) ?? id,
      ),
    ),
  )
  const keys: string[] = []
  try {
    await db.transaction(async (tx) => {
      // Сериализует два импорта и изменения страниц, включая добавление страницы (FK к sites).
      await tx.execute(sql`LOCK TABLE pages IN SHARE ROW EXCLUSIVE MODE`)
      const [site] = await tx.select().from(sites).where(eq(sites.id, siteId)).for('update')
      if (!site) throw new TemplateError('Сайт не найден')
      await assertEmpty(tx, siteId)
      for (const { item, upload, size, id } of prepared) {
        for (const file of upload.files) {
          const key = mediaKey(siteId, id, file.file)
          keys.push(key)
          await storage.put(key, file.data)
        }
        await tx.insert(media).values({
          id,
          siteId,
          originalName: displayName(item.originalName),
          mimeType: upload.mimeType,
          width: upload.width,
          height: upload.height,
          size,
          variants: upload.variants,
          originalFile: upload.originalFile,
        })
      }
      const now = new Date()
      await tx
        .update(sites)
        .set({
          name: remapped.site.name,
          theme: legacyTheme(remapped.site.theme),
          themePublished: remapped.site.theme,
          themeDraft: remapped.site.theme,
          headerPublished: remapped.site.header,
          headerDraft: remapped.site.header,
          footerPublished: remapped.site.footer,
          footerDraft: remapped.site.footer,
          scriptPublished: remapped.site.script,
          scriptDraft: remapped.site.script,
          settings: {
            ...readStoredSettings(site.settings),
            ...remapped.site.settings,
            hideFromSearch: true,
          },
        })
        .where(eq(sites.id, siteId))
      for (const block of remapped.customBlocks) {
        const { definition, script } = storedParts(block.definition)
        const [saved] = await tx
          .insert(customBlocks)
          .values({
            siteId,
            key: block.definition.key,
            draft: definition,
            scriptDraft: script,
            published: block.published ? definition : null,
            scriptPublished: block.published ? script : '',
            publishedAt: block.published ? now : null,
          })
          .returning({ id: customBlocks.id })
        if (block.published && saved) {
          await tx.insert(customBlockRevisions).values({
            siteId,
            blockId: saved.id,
            version: 1,
            publishedAt: now,
            definition: script ? { ...definition, script } : definition,
          })
        }
      }
      await recordSiteRevision(tx, siteId, 'theme', remapped.site.theme)
      if (remapped.site.header) await recordSiteRevision(tx, siteId, 'header', remapped.site.header)
      if (remapped.site.footer) await recordSiteRevision(tx, siteId, 'footer', remapped.site.footer)
      await recordSiteRevision(tx, siteId, 'script', remapped.site.script)
      for (const mail of remapped.mailTemplates) {
        await tx
          .insert(mailTemplateTexts)
          .values({
            siteId,
            template: mail.template,
            draft: mail.text,
            draftUpdatedAt: now,
            published: mail.published ? mail.text : null,
            publishedAt: mail.published ? now : null,
          })
          .onConflictDoUpdate({
            target: [mailTemplateTexts.siteId, mailTemplateTexts.template],
            set: {
              draft: mail.text,
              draftUpdatedAt: now,
              published: mail.published ? mail.text : null,
              publishedAt: mail.published ? now : null,
            },
          })
      }
      await tx.delete(pages).where(eq(pages.siteId, siteId))
      for (const page of remapped.pages) {
        // Документы требуют проверки клиента даже тогда, когда шаблон уже был проверен студией.
        if (
          ['privacy', 'consent'].includes(page.slug) &&
          !page.content.blocks.some((block) => block.id === LEGAL_NOTE_BLOCK_ID)
        ) {
          page.content.blocks.unshift({
            id: LEGAL_NOTE_BLOCK_ID,
            type: 'text',
            props: {
              body: 'Подставьте свои реквизиты и проверьте документ. После проверки удалите этот блок.',
            },
          })
        }
        await tx.insert(pages).values({
          siteId,
          slug: page.slug,
          title: page.title,
          draft: PageContent.parse(page.content),
        })
        if (page.published) await publishPage(tx, siteId, page.slug)
      }
    })
  } catch (error) {
    await storage.remove(keys).catch(() => {})
    throw error
  }
  return { pages: template.pages.length, media: prepared.length }
}
