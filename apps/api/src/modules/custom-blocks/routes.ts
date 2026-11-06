import {
  type CustomBlockProblem,
  CustomBlockRenderError,
  customBlockCss,
  legalFooterHtml,
  renderCustomBlockHtml,
  renderCustomPlaceHtml,
  samplePlaceData,
} from '@averra/blocks/custom-engine'
import {
  applyCustomBlocks,
  CUSTOM_BLOCKS_FILE_FORMAT,
  CustomBlockDraft,
  CustomBlockKey,
  CustomBlockPublish,
  CustomBlocksImport,
  collectMediaRefs,
  customBlockType,
  customPlaceIssues,
  MAIN_PAGE_SLUG,
  NewCustomBlock,
  PageContent,
  starterCustomBlock,
  Uuid,
} from '@averra/schema'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { can } from '../../auth/access'
import { type AuthEnv, notFound, requireSite } from '../../auth/middleware'
import type { Db } from '../../db/client'
import { sites } from '../../db/schema'
import { conflict } from '../../errors'
import { errorForLog } from '../../log-error'
import type { SitePublisher } from '../../publish/queue'
import { validate, validationError } from '../../validate'
import { draftFooter, publishedFooter } from '../footer/read'
import { draftHeader, publishedHeader } from '../header/read'
import { mediaRepo } from '../media/repo'
import { customBlocksRepo, draftOf, publishedOf, readDefinition, viewOf } from './repo'
import { cssMediaIds, definitionProblems, problemIssues, sameDefinition } from './service'

const changedDraft =
  'Черновик изменили, пока он был открыт (например, через MCP): проверьте его и опубликуйте снова'

const SiteParams = z.object({ siteId: Uuid() })
const BlockParams = SiteParams.extend({ key: CustomBlockKey })
const RevisionParams = BlockParams.extend({ revisionId: Uuid() })

/** Проверка без сохранения: определение и, если нужно, свои данные вместо примера */
const CheckInput = z.strictObject({
  definition: CustomBlockDraft,
  data: z.record(z.string(), z.unknown()).optional(),
})

type Deps = {
  db: Db
  /** Сборка сайта после публикации определения: блок мог стоять на опубликованных страницах */
  publisher?: SitePublisher
  log: (message: string) => void
}

const pagePath = (slug: string) => (slug === MAIN_PAGE_SLUG ? '/' : `/${slug}`)

const usageWhere = ({ draft, published }: { draft: boolean; published: boolean }) =>
  draft && published ? 'черновик и сайт' : draft ? 'черновик' : 'сайт'

const placeNames = { header: 'шапка сайта', footer: 'подвал сайта' } as const

/** Шапка и подвал сайта: черновик и опубликованное — где выбран свой вид */
async function sitePlaces(db: Db, siteId: string) {
  const [row] = await db
    .select({
      headerDraft: sites.headerDraft,
      headerPublished: sites.headerPublished,
      footerDraft: sites.footerDraft,
      footerPublished: sites.footerPublished,
    })
    .from(sites)
    .where(eq(sites.id, siteId))
  if (!row) return []
  return [
    {
      place: 'header' as const,
      draft: draftHeader(row).custom,
      published: publishedHeader(row)?.custom ?? null,
    },
    {
      place: 'footer' as const,
      draft: draftFooter(row).custom,
      published: publishedFooter(row)?.custom ?? null,
    },
  ]
}

/**
 * Свои блоки сайта: монтируется на /sites/:siteId/custom-blocks. Читать опубликованные может
 * любой участник и токен (ими заполняют страницы, их видит MCP), черновики и всё остальное —
 * владелец (blocks.define). Токену API с правом «черновики блоков» (token:grant) доступно
 * blocks.draft: читать черновики, создать блок, сохранить черновик, проверить шаблон. Публикация,
 * удаление, история и загрузка файла токену закрыты (tokenDenied): их делает человек
 */
export function customBlocksRoutes({ db, publisher, log }: Deps) {
  const repo = customBlocksRepo(db)
  const site = (permission: Parameters<typeof requireSite>[1]) => requireSite(db, permission)

  const rebuild = async (siteId: string) => {
    try {
      await publisher?.request(siteId)
    } catch (error) {
      log(`Сайт ${siteId}: не удалось поставить сборку в очередь — ${String(errorForLog(error))}`)
    }
  }

  /** Блок с замечаниями — для экрана блока в админке */
  const detailed = async (siteId: string, row: Parameters<typeof viewOf>[0]) => {
    const view = viewOf(row)
    return {
      ...view,
      problems: view.draft ? await definitionProblems(db, siteId, view.draft) : [],
      usage: await repo.usage(siteId, row.key),
    }
  }

  return (
    new Hono<AuthEnv>()
      // Владельцу — все блоки с черновиками; остальным — только опубликованные определения
      .get('/', validate('param', SiteParams), site('site.read'), async (c) => {
        const { siteId } = c.req.valid('param')
        const { actor } = c.var
        // Токен с правом на черновики читает их же: иначе он не увидел бы свою работу
        const defines =
          (actor.kind === 'user' && can(c.var.siteRole, 'blocks.define')) ||
          (actor.kind === 'token' && actor.rights.blocksDraft)
        const views = (await repo.list(siteId)).map(viewOf)
        const blocks = defines
          ? views
          : views
              .filter((view) => view.published !== null)
              .map((view) => ({ ...view, draft: null, unpublished: false }))
        return c.json({ blocks }, 200)
      })

      .post(
        '/',
        validate('param', SiteParams),
        site('blocks.draft'),
        validate('json', NewCustomBlock),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const { key, title, placement } = c.req.valid('json')
          const row = await repo.create(siteId, starterCustomBlock(key, title, placement))
          if (!row) {
            const issues = [{ path: 'key', message: 'Такой ключ уже есть' }]
            return c.json(conflict(`Свой блок с ключом «${key}» уже есть`, issues), 409)
          }
          return c.json(await detailed(siteId, row), 201)
        },
      )

      // Файл переноса: черновики всех блоков. Его загружают на другой установке (import)
      .get('/export', validate('param', SiteParams), site('blocks.define'), async (c) => {
        const { siteId } = c.req.valid('param')
        const blocks = (await repo.list(siteId)).flatMap((row) => {
          const draft = draftOf(row)
          return draft ? [draft] : []
        })
        const file = {
          format: CUSTOM_BLOCKS_FILE_FORMAT,
          version: 1,
          exportedAt: new Date().toISOString(),
          blocks,
        }
        const day = file.exportedAt.slice(0, 10)
        c.header('content-disposition', `attachment; filename="custom-blocks-${day}.json"`)
        return c.json(file, 200)
      })

      // Загрузка: каждый блок проходит схему; занятый ключ — по решению, без решения — 409 со
      // списком ключей (issues), и ничего не меняется
      .post(
        '/import',
        validate('param', SiteParams),
        site('blocks.define'),
        validate('json', CustomBlocksImport),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const { blocks, resolutions } = c.req.valid('json')
          const result = await repo.importBlocks(siteId, blocks, resolutions)
          if (result.mismatched.length > 0) {
            const issues = result.mismatched.map((key) => ({
              path: `resolutions.${key}`,
              message: 'Место блока в файле другое, чем на сайте: переименуйте или пропустите',
            }))
            const keys = result.mismatched.map((key) => `«${key}»`).join(', ')
            return c.json(
              conflict(
                `Не заменить: у ${keys} в файле другое место (блок, шапка или подвал)`,
                issues,
              ),
              409,
            )
          }
          if (result.unresolved.length > 0) {
            const issues = result.unresolved.map((key) => ({
              path: `resolutions.${key}`,
              message: 'Ключ уже занят: заменить, переименовать или пропустить',
            }))
            const keys = result.unresolved.map((key) => `«${key}»`).join(', ')
            return c.json(conflict(`Ключи уже заняты: ${keys}`, issues), 409)
          }
          return c.json(result, 200)
        },
      )

      // Проверка определения без сохранения и рендер на данных: ответ — замечания по частям (шаблон,
      // CSS, пример) с номерами строк и HTML, каким его увидит сайт. Для MCP: нейронка чинит блок
      // по тексту замечаний. Ошибки определения — не 400: это и есть результат проверки
      .post(
        '/check',
        validate('param', SiteParams),
        site('blocks.draft'),
        validate('json', CheckInput),
        async (c) => {
          const { siteId } = c.req.valid('param')
          const { definition, data } = c.req.valid('json')
          const problems: CustomBlockProblem[] = await definitionProblems(db, siteId, definition)
          const props = data ?? definition.example
          const ids = [
            ...cssMediaIds(definition.css),
            ...collectMediaRefs(props).map((ref) => ref.mediaId),
          ]
          const media = await mediaRepo(db).files(siteId, ids)
          let html: string | null = null
          try {
            const context = { id: 'preview', media, priority: false }
            if (definition.placement === 'block') {
              html = renderCustomBlockHtml(definition, props, context)
            } else {
              // Шапка и подвал — на образце данных сайта (меню, кнопка, логотип, «Организация»),
              // подвал — со строкой документов Averra: нейронка видит то, что соберёт сайт
              const place = samplePlaceData()
              const rendered = renderCustomPlaceHtml(definition, props, place, context)
              html =
                definition.placement === 'footer'
                  ? rendered +
                    legalFooterHtml(rendered, {
                      policyHref: place.site.legal.policy_href,
                      consentHref: place.site.legal.consent_href,
                      cookieSettings: place.site.legal.cookie_settings,
                    })
                  : rendered
            }
          } catch (error) {
            if (!(error instanceof CustomBlockRenderError)) throw error
            // Пример проверен выше (поля и пробный рендер): повторять его ошибки незачем. Свои данные —
            // ошибка именно этой проверки
            if (data !== undefined) {
              problems.push({
                part: error.line === undefined ? 'fields' : 'template',
                level: 'error',
                message: error.message,
                line: error.line,
              })
            }
          }
          const css = customBlockCss(definition, media)
          return c.json({ problems, html, css }, 200)
        },
      )

      .get('/:key', validate('param', BlockParams), site('blocks.draft'), async (c) => {
        const { siteId, key } = c.req.valid('param')
        const row = await repo.find(siteId, key)
        if (!row) return c.json(notFound('Своего блока нет'), 404)
        return c.json(await detailed(siteId, row), 200)
      })

      // Черновик сохраняется и с ошибками шаблона, CSS и примера: их показывают замечания.
      // Структура полей проверяется всегда — из неё строится форма
      .put(
        '/:key',
        validate('param', BlockParams),
        site('blocks.draft'),
        validate('json', CustomBlockDraft),
        async (c) => {
          const { siteId, key } = c.req.valid('param')
          const draft = c.req.valid('json')
          if (draft.key !== key) {
            return c.json(
              validationError([{ path: 'key', message: 'Ключ блока не меняется после создания' }]),
              400,
            )
          }
          const current = await repo.find(siteId, key)
          if (!current) return c.json(notFound('Своего блока нет'), 404)
          // Место задают при создании: блок со страниц не становится шапкой, а шапка — блоком
          const placement = (draftOf(current) ?? publishedOf(current))?.placement ?? draft.placement
          if (placement !== draft.placement) {
            return c.json(
              validationError([
                {
                  path: 'placement',
                  message: 'Место блока не меняется после создания: создайте новый блок',
                },
              ]),
              400,
            )
          }
          const row = await repo.saveDraft(siteId, draft)
          if (!row) return c.json(notFound('Своего блока нет'), 404)
          return c.json(await detailed(siteId, row), 200)
        },
      )

      // Публикация — только без ошибок и только того черновика, который видел человек: черновик
      // пишет и токен MCP, и без сверки владелец опубликовал бы непрочитанную версию. Ответ называет
      // опубликованные страницы, чьи данные не подходят под новое определение: на сайте этот блок у
      // них не покажется, пока их не поправят
      .post(
        '/:key/publish',
        validate('param', BlockParams),
        site('blocks.define'),
        validate('json', CustomBlockPublish),
        async (c) => {
          const { siteId, key } = c.req.valid('param')
          const { draft: seen } = c.req.valid('json')
          const found = await repo.find(siteId, key)
          if (!found) return c.json(notFound('Своего блока нет'), 404)
          const draft = draftOf(found)
          if (!draft || !sameDefinition(draft, seen)) {
            return c.json(conflict(changedDraft), 409)
          }
          const problems = problemIssues(await definitionProblems(db, siteId, draft))
          if (problems.length > 0) return c.json(validationError(problems), 400)
          const result = await repo.publish(siteId, draft, c.var.actor)
          if (!result) return c.json(notFound('Своего блока нет'), 404)
          if (!result.row) return c.json(conflict(changedDraft), 409)
          const definition = publishedOf(result.row)
          const affected = definition
            ? (await repo.publishedPagesWith(siteId, key)).flatMap((page) => {
                const content = PageContent.safeParse(page.content)
                if (!content.success) return []
                // Проверяем только блоки этого ключа: соседние свои блоки страницы к публикуемому
                // определению отношения не имеют, без своих определений они дали бы ложное «нет на сайте»
                const { issues } = applyCustomBlocks(content.data, [definition])
                const first = issues.find((issue) => {
                  const type = content.data.blocks[Number(issue.path[1])]?.type
                  return type !== undefined && customBlockType(key) === type
                })
                return first
                  ? [{ slug: page.slug, title: page.title ?? page.slug, message: first.message }]
                  : []
              })
            : []
          // Шапка или подвал на сайте со своим видом этого ключа: поля могли перестать подходить —
          // тогда на сайте стандартные, пока поля не поправят в «Шапка и подвал»
          const places = definition
            ? (await sitePlaces(db, siteId)).flatMap(({ place, published }) => {
                if (published?.key !== key) return []
                const issue = customPlaceIssues(published, place, [definition])[0]
                if (!issue) return []
                // Путь поля без «custom.props.»: человек правит поле по его ключу
                const field = issue.path.replace(/^custom\.props\.?/, '')
                return [
                  {
                    place,
                    ...(field && field !== issue.path && { field }),
                    message: issue.message,
                  },
                ]
              })
            : []
          await rebuild(siteId)
          return c.json({ ...(await detailed(siteId, result.row)), affected, places }, 200)
        },
      )

      .get('/:key/revisions', validate('param', BlockParams), site('blocks.define'), async (c) => {
        const { siteId, key } = c.req.valid('param')
        if (!(await repo.find(siteId, key))) return c.json(notFound('Своего блока нет'), 404)
        return c.json(await repo.revisions(siteId, key), 200)
      })

      // Возврат версии в черновик: опубликованное и история не меняются
      .post(
        '/:key/revisions/:revisionId/restore',
        validate('param', RevisionParams),
        site('blocks.define'),
        async (c) => {
          const { siteId, key, revisionId } = c.req.valid('param')
          const revision = await repo.revision(siteId, key, revisionId)
          if (!revision) return c.json(notFound('Версия не найдена'), 404)
          const draft = readDefinition(revision.definition)
          if (!draft) {
            const message = `Версия ${revision.version} не подходит под нынешнюю схему своих блоков, вернуть её нельзя`
            return c.json(conflict(message), 409)
          }
          const row = await repo.saveDraft(siteId, draft)
          if (!row) return c.json(notFound('Своего блока нет'), 404)
          return c.json(await detailed(siteId, row), 200)
        },
      )

      // Блок на странице (в черновике или на сайте) удалить нельзя: страница осталась бы с дырой
      .delete('/:key', validate('param', BlockParams), site('blocks.define'), async (c) => {
        const { siteId, key } = c.req.valid('param')
        const usage = await repo.usage(siteId, key)
        if (usage.length > 0) {
          const list = usage
            .map((page) => `«${page.title}» (${pagePath(page.slug)}) — ${usageWhere(page)}`)
            .join('; ')
          const issues = usage.map((page) => ({
            path: `pages.${page.slug}`,
            message: usageWhere(page),
          }))
          const message = `Блок стоит на страницах: ${list}. Уберите его оттуда и опубликуйте страницы, тогда блок можно будет удалить`
          return c.json(conflict(message, issues), 409)
        }
        // Свой вид, выбранный в шапке или подвале, удалить нельзя: на сайте пропал бы вид
        const chosen = (await sitePlaces(db, siteId)).flatMap(({ place, draft, published }) => {
          const where = usageWhere({ draft: draft?.key === key, published: published?.key === key })
          return draft?.key === key || published?.key === key
            ? [{ path: `places.${place}`, message: `${placeNames[place]} — ${where}` }]
            : []
        })
        if (chosen.length > 0) {
          const list = chosen.map((issue) => issue.message).join('; ')
          const message = `Этот вид выбран: ${list}. Выберите другой вид в «Шапка и подвал» и опубликуйте, тогда блок можно будет удалить`
          return c.json(conflict(message, chosen), 409)
        }
        const deleted = await repo.delete(siteId, key)
        if (!deleted) return c.json(notFound('Своего блока нет'), 404)
        return c.body(null, 204)
      })
  )
}
