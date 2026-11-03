import { DRAFTS_ONLY, TokenName, type TokenRights, tokenRightLabels, Uuid } from '@averra/schema'
import { z } from 'zod'
import type { Db } from '../db/client'
import { REVOKED_TOKEN_MESSAGE, tokensRepo } from '../modules/tokens/repo'
import { UserEmail } from '../modules/users/repo'
import { args, CliError, check } from './common'

// Разбор аргументов token:create и token:grant и выдача прав — отдельно от самих команд: команды
// запускаются при импорте, а это проверяют тесты. Права и их значения по умолчанию — те же, что у
// выпуска в админке (NewToken и DRAFTS_ONLY в @averra/schema)

export const tokenCreateUsage = `Выпустить токен API для MCP на сайт установки:
  pnpm token:create --name mcp [--publish] [--delete] [--no-blocks-draft] [--by <почта владельца>]

По умолчанию токен — «только черновики», как в админке: черновики страниц и своих блоков, новые
страницы, загрузка картинок. --publish разрешает публиковать страницы (MCP: publish_page) и
«Собрать заново», --delete — удалять страницы и картинки, --no-blocks-draft снимает черновики
своих блоков. Опубликовать свой блок токен не может никогда: это делает человек в админке.
Позже права меняют в админке (Установка → Доступ для ИИ) или командой pnpm token:grant.

Токен показывается один раз. --by нужен, только если владельцев несколько. --site <id сайта> не
нужен: в установке один сайт. Он только для старых баз, где сайтов несколько.`

const TokenCreateArgs = z.object({
  site: Uuid('Нужен id сайта').optional(),
  name: TokenName,
  by: UserEmail.optional(),
  publish: z.boolean().optional(),
  delete: z.boolean().optional(),
  // Прежний флаг: право на черновики своих блоков теперь и так есть по умолчанию
  'blocks-draft': z.boolean().optional(),
  'no-blocks-draft': z.boolean().optional(),
})

export function parseTokenCreate(argv?: string[]) {
  const values = check(
    TokenCreateArgs,
    args(
      {
        site: { type: 'string' },
        name: { type: 'string' },
        by: { type: 'string' },
        publish: { type: 'boolean' },
        delete: { type: 'boolean' },
        'blocks-draft': { type: 'boolean' },
        'no-blocks-draft': { type: 'boolean' },
      },
      tokenCreateUsage,
      argv,
    ),
    tokenCreateUsage,
  )
  if (values['blocks-draft'] && values['no-blocks-draft']) {
    throw new CliError(`Либо --blocks-draft, либо --no-blocks-draft\n\n${tokenCreateUsage}`)
  }
  const rights: TokenRights = {
    blocksDraft: values['no-blocks-draft'] !== true && DRAFTS_ONLY.blocksDraft,
    publish: values.publish === true,
    delete: values.delete === true,
  }
  return { site: values.site, name: values.name, by: values.by, rights }
}

export const tokenGrantUsage = `Включить или выключить права токена API:
  pnpm token:grant --id <id токена> [--blocks-draft on|off] [--publish on|off] [--delete on|off]
  (на сервере: node dist/server/token-grant.js с теми же параметрами)

--blocks-draft — черновики своих блоков (MCP читает их, создаёт блок, сохраняет черновик,
проверяет шаблон), --publish — публикация страниц и «Собрать заново», --delete — удаление страниц
и картинок. Не названные права не меняются. Опубликовать, удалить или откатить свой блок токен не
может никогда: это делает человек в админке. Права действуют сразу, перевыпускать токен не нужно.
id видно в pnpm token:list. То же — в админке: Установка → Доступ для ИИ.`

const OnOff = z.enum(['on', 'off'], 'Нужно on или off').optional()

const TokenGrantArgs = z.object({
  id: Uuid('Нужен id токена'),
  'blocks-draft': OnOff,
  publish: OnOff,
  delete: OnOff,
})

export function parseTokenGrant(argv?: string[]) {
  const values = check(
    TokenGrantArgs,
    args(
      {
        id: { type: 'string' },
        'blocks-draft': { type: 'string' },
        publish: { type: 'string' },
        delete: { type: 'string' },
      },
      tokenGrantUsage,
      argv,
    ),
    tokenGrantUsage,
  )
  const rights: Partial<TokenRights> = {}
  const pairs = [
    ['blocksDraft', values['blocks-draft']],
    ['publish', values.publish],
    ['delete', values.delete],
  ] as const
  for (const [right, value] of pairs) {
    if (value !== undefined) rights[right] = value === 'on'
  }
  if (Object.keys(rights).length === 0) {
    throw new CliError(
      `Укажите право: --blocks-draft, --publish или --delete со значением on или off\n\n${tokenGrantUsage}`,
    )
  }
  return { id: values.id, rights }
}

/** Права словами: «черновики своих блоков — да, публикация страниц — нет, …» */
export function describeRights(rights: Partial<TokenRights>) {
  return (Object.keys(tokenRightLabels) as (keyof TokenRights)[])
    .filter((right) => rights[right] !== undefined)
    .map((right) => `${tokenRightLabels[right]} — ${rights[right] ? 'да' : 'нет'}`)
    .join(', ')
}

/**
 * Меняет права; нет токена или он отозван — CliError, как 404 и 409 у PATCH /api/tokens/:id.
 * Возвращает строку для человека
 */
export async function grantRights(db: Db, id: string, rights: Partial<TokenRights>) {
  const repo = tokensRepo(db)
  const current = (await repo.list()).find((token) => token.id === id)
  if (!current) throw new CliError(`Нет токена ${id}`)
  if (current.revokedAt) throw new CliError(REVOKED_TOKEN_MESSAGE)
  const after = await repo.setRights(id, rights)
  if (!after) throw new CliError(`Нет токена ${id}`)
  return `Права токена ${id}: ${describeRights(after)}. Действуют сразу`
}
