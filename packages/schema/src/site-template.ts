import { z } from 'zod'
import { CustomBlockDraft } from './custom-blocks'
import { Footer } from './footer'
import { Header } from './header'
import { Uuid } from './id'
import { MailTemplateText } from './mail-templates'
import { ExistingPageSlug, MAIN_PAGE_SLUG, PageContent, PageTitle } from './page'
import { SiteName } from './site'
import { SiteScript } from './site-script'
import { SiteSettings } from './site-settings'
import { Theme } from './theme'

export const TEMPLATE_FORMAT_VERSION = 1
export const TEMPLATE_MAX_BYTES = 256 * 1024 * 1024
export const TEMPLATE_JSON_MAX_BYTES = 16 * 1024 * 1024

// Список разрешённых полей защищает шаблон и при добавлении новых настроек установки.
export const TemplateSettings = SiteSettings.pick({
  titleTemplate: true,
  description: true,
  language: true,
  ogImage: true,
  icon: true,
  hideFromSearch: true,
  redirects: true,
  cookies: true,
})

export const SiteTemplate = z
  .strictObject({
    format: z.literal('averra-site-template'),
    formatVersion: z.literal(
      TEMPLATE_FORMAT_VERSION,
      'Неизвестная версия формата шаблона: обновите Averra',
    ),
    averraVersion: z.string().min(1).max(100),
    site: z.strictObject({
      name: SiteName,
      theme: Theme,
      header: Header.nullable(),
      footer: Footer.nullable(),
      script: SiteScript,
      settings: TemplateSettings,
    }),
    pages: z
      .array(
        z.strictObject({
          slug: ExistingPageSlug,
          title: PageTitle,
          content: PageContent,
          published: z.boolean(),
        }),
      )
      .min(1)
      .max(1000),
    customBlocks: z
      .array(
        z.strictObject({
          definition: CustomBlockDraft,
          published: z.boolean(),
        }),
      )
      .max(500),
    mailTemplates: z
      .array(
        z.strictObject({
          template: z.string().min(1).max(100),
          text: MailTemplateText,
          published: z.boolean(),
        }),
      )
      .max(100),
    media: z
      .array(
        z.strictObject({
          id: Uuid(),
          originalName: z.string().min(1).max(200),
          file: z
            .string()
            .regex(/^media\/[0-9a-f-]{36}\/(?:original\.(?:jpg|png|webp|avif)|image\.svg)$/),
        }),
      )
      .max(2000),
  })
  .superRefine((value, ctx) => {
    if (!value.pages.some((page) => page.slug === MAIN_PAGE_SLUG)) {
      ctx.addIssue({ code: 'custom', path: ['pages'], message: 'В шаблоне нет главной страницы' })
    }
    for (const [field, keys] of [
      ['pages', value.pages.map((page) => page.slug)],
      ['customBlocks', value.customBlocks.map((block) => block.definition.key)],
      ['mailTemplates', value.mailTemplates.map((mail) => mail.template)],
      ['media', value.media.map((item) => item.id)],
      ['media', value.media.map((item) => item.file)],
    ] as const) {
      if (new Set(keys).size !== keys.length) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Повторяющиеся записи в шаблоне' })
      }
    }
  })
export type SiteTemplate = z.infer<typeof SiteTemplate>
