import { DRAFTS_ONLY, type TokenRights, tokenRightLabels } from '@averra/schema'

/** Права по порядку: так они стоят в форме выпуска, в окне прав и в таблице */
export const tokenRightOrder = [
  'blocksDraft',
  'publish',
  'delete',
] as const satisfies readonly (keyof TokenRights)[]

/** Подсказки к флажкам прав: что именно откроется нейронке */
export const tokenRightHints: Record<keyof TokenRights, string> = {
  blocksDraft:
    'Читать черновики своих блоков, создавать блок и сохранять черновик, а ещё читать и сохранять черновик скрипта сайта с доменами для CSP. Опубликовать блок или скрипт токен не может никогда: это делаете вы.',
  publish:
    'Публиковать страницы и собирать сайт заново. Без права нейронка только сохраняет черновик, а публикуете вы.',
  delete: 'Удалять страницы и картинки медиатеки. Вернуть удалённое нельзя.',
}

export { DRAFTS_ONLY, tokenRightLabels }

/** Права словами: «Черновики страниц, черновики своих блоков» — черновики страниц есть всегда */
export function rightsSummary(rights: TokenRights) {
  const extra = tokenRightOrder
    .filter((right) => rights[right])
    .map((right) => tokenRightLabels[right].toLowerCase())
  return ['Черновики страниц', ...extra].join(', ')
}

/** «Только черновики» — новый токен по умолчанию: ни публикации, ни удаления */
export const isDraftsOnly = (rights: TokenRights) => !rights.publish && !rights.delete

/**
 * Фрагмент .mcp.json с адресом установки и токеном: его кладут в корень репозитория Averra
 * (файл в .gitignore). Сервер MCP запускается Node проекта, как в .mcp.example.json; env здесь
 * главнее apps/mcp/.env. Адрес — тот, где открыта админка: API живёт на том же адресе (в
 * разработке — за прокси Vite)
 */
export function mcpConfigFragment(origin: string, token: string) {
  const config = {
    mcpServers: {
      averra: {
        command: 'node_modules/.bin/node',
        args: ['apps/mcp/node_modules/tsx/dist/cli.mjs', 'apps/mcp/src/index.ts'],
        env: { CMS_API_URL: origin, CMS_API_TOKEN: token },
      },
    },
  }
  return JSON.stringify(config, null, 2)
}

export type TokenState = 'active' | 'revoked'

/** Состояние токена в таблице. Пользовались ли им — в своей колонке «Последний раз» */
export const tokenState = (token: { revokedAt: string | null }): TokenState =>
  token.revokedAt ? 'revoked' : 'active'

export const tokenStateLabels: Record<TokenState, string> = {
  active: 'Действует',
  revoked: 'Отозван',
}

/** Кнопка окна с выпущенным токеном: единственное, что закрывает его, пока ничего не скопировано */
export const issuedDoneLabel = 'Готово, я сохранил токен'

/** Подсказка, когда Esc нажали, а окно с токеном не закрылось: тот же текст на экране и на витрине */
export const escapeBlockedText = `Esc не закрывает окно, пока токен или фрагмент не скопирован: он показывается один раз. Сохраните его и нажмите «${issuedDoneLabel}»`
