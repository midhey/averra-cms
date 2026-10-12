export type Issue = { path: string; message: string }

/**
 * 409 — запрос правильный, но спорит с тем, что уже лежит в базе. issues с путём до поля,
 * как у ошибок проверки: админка покажет сообщение прямо у поля, которое надо поправить
 */
export const conflict = (message: string, issues: Issue[] = []) => ({
  error: { code: 'conflict', message, issues },
})
