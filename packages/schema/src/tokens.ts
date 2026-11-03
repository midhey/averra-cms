import { z } from 'zod'
import { hasHeaderBreak } from './mail'

/**
 * Права токена API (MCP) сверх черновиков страниц. Черновики страниц, новые страницы и загрузка
 * картинок есть у любого токена: без них нейронке нечего делать. Остальное владелец включает
 * отдельно — так видно, что именно он доверил программе. Опубликовать или удалить свой блок токен
 * не может ни с каким правом: это код на страницах, его читает человек
 */
export const TokenRights = z.strictObject({
  /** Черновики своих блоков: читать, создать блок, сохранить черновик, проверить шаблон */
  blocksDraft: z.boolean(),
  /** Опубликовать страницу и «Собрать заново» */
  publish: z.boolean(),
  /** Удалить страницу и картинку медиатеки */
  delete: z.boolean(),
})
export type TokenRights = z.infer<typeof TokenRights>

/** Новый токен по умолчанию — «только черновики»: страницы и свои блоки, без публикации и удаления */
export const DRAFTS_ONLY: TokenRights = { blocksDraft: true, publish: false, delete: false }

/** Подписи прав — одни в админке, CLI и документации */
export const tokenRightLabels: Record<keyof TokenRights, string> = {
  blocksDraft: 'Черновики своих блоков',
  publish: 'Публикация страниц',
  delete: 'Удаление страниц и картинок',
}

/** Имя токена — чья это программа: «Claude Code Алексея». Одной строкой, его видно в списке */
export const TokenName = z
  .string()
  .refine((name) => !hasHeaderBreak(name), 'Имя — одной строкой, без переводов строки')
  .trim()
  .pipe(z.string().min(1, 'Введите имя токена').max(80, 'Имя токена — не длиннее 80 символов'))

/** Выпустить токен: имя и права. Не указанное право — как у «только черновики» */
export const NewToken = z.strictObject({
  name: TokenName,
  rights: TokenRights.partial()
    .optional()
    .transform((rights): TokenRights => ({ ...DRAFTS_ONLY, ...rights })),
})
export type NewToken = z.input<typeof NewToken>

/** Поменять права токена: только названные, остальные остаются */
export const TokenRightsPatch = TokenRights.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  'Укажите хотя бы одно право',
)
export type TokenRightsPatch = z.infer<typeof TokenRightsPatch>
