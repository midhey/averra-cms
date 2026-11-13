import { MailTemplateText, Uuid } from '@averra/schema'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AuthEnv, notFound, requireOwner, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { apiTokens, mailTemplateTexts, sites } from '../../db/schema'
import { templateScope } from '../../mail/template-store'
import {
  type EditableTemplate,
  MailTextError,
  validateTemplateText,
} from '../../mail/template-text'
import { MailDataError, MailTemplateId, mailTemplates, previewMail } from '../../mail/templates'
import { toMailLine } from '../../mail/templates/line'
import { validate, validationError } from '../../validate'

const Params = z.object({ template: z.string() })
const SiteParams = z.object({ siteId: Uuid() })

/** Один редактор для двух уровней; установка никогда не доступна токену */
export function mailTemplateRoutes(db: Db, scope: 'site' | 'installation') {
  const access = (publish = false) =>
    scope === 'site'
      ? requireSite(db, publish ? 'mail.templates' : 'mail.templates.draft')
      : requireOwner('Служебные шаблоны писем меняет только владелец установки')
  const app = new Hono<AuthEnv>()
  if (scope === 'site') app.use(validate('param', SiteParams))
  app.use(access())

  const siteIdOf = (value: string | undefined) =>
    scope === 'site' ? (value?.toLowerCase() ?? null) : null
  return app
    .get('/', async (c) => {
      const rows = await db
        .select()
        .from(mailTemplateTexts)
        .where(templateScope(siteIdOf(c.req.param('siteId'))))
      return c.json(
        Object.values(mailTemplates)
          .filter((definition) => definition.scope === scope)
          .map((definition) => {
            const row = rows.find((row) => row.template === definition.id)
            const editable = definition as EditableTemplate
            return {
              id: definition.id as MailTemplateId,
              title: definition.title,
              description: definition.description,
              vars: Object.entries(editable.vars).map(([name, { label }]) => ({ name, label })),
              blocks: Object.entries(editable.blocks).map(([name, { label, required }]) => ({
                name,
                label,
                required: required ?? false,
              })),
              defaultText: definition.defaultText,
              draft: row?.draft ?? null,
              draftUpdatedAt: row?.draftUpdatedAt ?? null,
              draftUpdatedBy: row?.draftUpdatedBy ?? null,
              published: row?.published ?? null,
              publishedAt: row?.publishedAt ?? null,
              publishedBy: row?.publishedBy ?? null,
            }
          }),
        200,
      )
    })
    .use('/:template/*', validate('param', Params))
    .use('/:template', validate('param', Params))
    .use('/:template/*', async (c, next) => {
      const id = MailTemplateId.safeParse(c.req.param('template'))
      if (!id.success || mailTemplates[id.data].scope !== scope)
        return c.json(notFound('Шаблон письма не найден'), 404)
      return next()
    })
    .use('/:template', async (c, next) => {
      const id = MailTemplateId.safeParse(c.req.param('template'))
      if (!id.success || mailTemplates[id.data].scope !== scope)
        return c.json(notFound('Шаблон письма не найден'), 404)
      return next()
    })
    .put('/:template/draft', validate('json', MailTemplateText), async (c) => {
      const template = c.req.param('template') as MailTemplateId
      const input = c.req.valid('json')
      const error = textError(template, input)
      if (error) return c.json(error, 400)
      const actor = c.var.actor
      let by: string
      if (actor.kind === 'user') by = actor.user.name
      else {
        const [token] = await db
          .select({ name: apiTokens.name })
          .from(apiTokens)
          .where(eq(apiTokens.id, actor.tokenId))
        by = `токен «${token?.name ?? 'ИИ'}»`
      }
      await save(db, siteIdOf(c.req.param('siteId')), template, {
        draft: input,
        draftUpdatedAt: new Date(),
        draftUpdatedBy: by,
      })
      return c.json({ ok: true }, 200)
    })
    .delete('/:template/draft', async (c) => {
      await db
        .update(mailTemplateTexts)
        .set({ draft: null, draftUpdatedAt: null, draftUpdatedBy: null })
        .where(
          and(
            templateScope(siteIdOf(c.req.param('siteId'))),
            eq(mailTemplateTexts.template, c.req.param('template')),
          ),
        )
      return c.json({ ok: true }, 200)
    })
    .post('/:template/publish', access(true), validate('json', MailTemplateText), async (c) => {
      const template = c.req.param('template') as MailTemplateId
      const input = c.req.valid('json')
      const error = textError(template, input)
      if (error) return c.json(error, 400)
      await save(db, siteIdOf(c.req.param('siteId')), template, {
        published: input,
        publishedAt: new Date(),
        publishedBy: c.var.actor.kind === 'user' ? c.var.actor.user.name : '',
        draft: null,
        draftUpdatedAt: null,
        draftUpdatedBy: null,
      })
      return c.json({ ok: true }, 200)
    })
    .delete('/:template', access(true), async (c) => {
      await db
        .delete(mailTemplateTexts)
        .where(
          and(
            templateScope(siteIdOf(c.req.param('siteId'))),
            eq(mailTemplateTexts.template, c.req.param('template')),
          ),
        )
      return c.json({ ok: true }, 200)
    })
    .post('/:template/preview', validate('json', MailTemplateText), async (c) => {
      const template = c.req.param('template') as MailTemplateId
      const input = c.req.valid('json')
      const error = textError(template, input)
      if (error) return c.json(error, 400)
      const siteId = siteIdOf(c.req.param('siteId'))
      const [site] = await db
        .select({ name: sites.name })
        .from(sites)
        .where(siteId ? eq(sites.id, siteId) : undefined)
        .orderBy(sites.createdAt)
        .limit(1)
      try {
        return c.json(
          previewMail(template, site ? toMailLine(site.name, 80, 'сайт') : undefined, input),
          200,
        )
      } catch (error) {
        if (error instanceof MailDataError)
          return c.json(
            validationError(
              error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
            ),
            400,
          )
        throw error
      }
    })
}

function textError(template: MailTemplateId, input: MailTemplateText) {
  try {
    validateTemplateText(mailTemplates[template] as EditableTemplate, input)
    previewMail(template, undefined, input)
  } catch (error) {
    if (error instanceof MailTextError) return validationError(error.issues)
    if (error instanceof MailDataError)
      return validationError(
        error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      )
    throw error
  }
  return null
}

async function save(
  db: Db,
  siteId: string | null,
  template: MailTemplateId,
  values: Partial<typeof mailTemplateTexts.$inferInsert>,
) {
  await db
    .insert(mailTemplateTexts)
    .values({ siteId, template, ...values })
    .onConflictDoUpdate({
      target: [mailTemplateTexts.siteId, mailTemplateTexts.template],
      set: values,
    })
}
