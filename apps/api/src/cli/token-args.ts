import { Uuid } from '@averra/schema'
import { z } from 'zod'
import type { Db } from '../db/client'
import { tokensRepo } from '../modules/tokens/repo'
import { UserEmail } from '../modules/users/repo'
import { args, CliError, check } from './common'

// Разбор аргументов token:create и token:grant и выдача права — отдельно от самих команд: команды
// запускаются при импорте, а это проверяют тесты

export const tokenCreateUsage = `Выпустить токен API (права редактора на сайте установки), например для MCP:
  pnpm token:create --name mcp [--by <почта владельца>] [--site <id сайта>] [--blocks-draft]

--blocks-draft даёт токену право сохранять черновики своих блоков (MCP: save_custom_block_draft).
Публиковать блок токен не может в любом случае: это делает человек в админке. Без флага право
выключено; позже его включают и выключают командой pnpm token:grant.

Токен показывается один раз. --by нужен, только если владельцев несколько. --site не нужен:
в установке один сайт. Он только для старых баз, где сайтов несколько.`

const TokenCreateArgs = z.object({
  site: Uuid('Нужен id сайта').optional(),
  name: z.string().trim().min(1).max(80),
  by: UserEmail.optional(),
  'blocks-draft': z.boolean().optional(),
})

export function parseTokenCreate(argv?: string[]) {
  const values = check(
    TokenCreateArgs,
    args(
      {
        site: { type: 'string' },
        name: { type: 'string' },
        by: { type: 'string' },
        'blocks-draft': { type: 'boolean' },
      },
      tokenCreateUsage,
      argv,
    ),
    tokenCreateUsage,
  )
  return {
    site: values.site,
    name: values.name,
    by: values.by,
    blocksDraft: values['blocks-draft'] === true,
  }
}

export const tokenGrantUsage = `Включить или выключить право токена API на черновики своих блоков:
  pnpm token:grant --id <id токена> --blocks-draft on|off
  (на сервере: node dist/server/token-grant.js с теми же параметрами)

С правом MCP читает черновики своих блоков, создаёт блок, сохраняет черновик и проверяет шаблон.
Публиковать, удалять и откатывать блоки токен не может никогда: это делает человек в админке.
Право действует сразу, перевыпускать токен не нужно. id видно в pnpm token:list.`

const TokenGrantArgs = z.object({
  id: Uuid('Нужен id токена'),
  'blocks-draft': z.enum(['on', 'off'], 'Нужно on или off'),
})

export function parseTokenGrant(argv?: string[]) {
  const values = check(
    TokenGrantArgs,
    args({ id: { type: 'string' }, 'blocks-draft': { type: 'string' } }, tokenGrantUsage, argv),
    tokenGrantUsage,
  )
  return { id: values.id, allowed: values['blocks-draft'] === 'on' }
}

/** Включает или выключает право; нет токена — CliError. Возвращает строку для человека */
export async function grantBlocksDraft(db: Db, id: string, allowed: boolean) {
  if (!(await tokensRepo(db).setBlocksDraft(id, allowed))) throw new CliError(`Нет токена ${id}`)
  return allowed
    ? `Токену ${id} разрешены черновики своих блоков. Публикует блок по-прежнему человек в админке`
    : `У токена ${id} право на черновики своих блоков выключено`
}
