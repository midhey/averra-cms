export type Issue = { path: string; message: string }

/**
 * 409 — запрос правильный, но спорит с тем, что уже лежит в базе. issues с путём до поля,
 * как у ошибок проверки: админка покажет сообщение прямо у поля, которое надо поправить
 */
export const conflict = (message: string, issues: Issue[] = []) => ({
  error: { code: 'conflict', message, issues },
})

/**
 * 503 — действию нужна почта, а она не настроена (нет SMTP_*). Так отвечают сброс пароля,
 * приглашения и всё, что без письма не имеет смысла: честно, а не «готово», которое не придёт
 */
export const mailDisabled = (reason: string) => ({
  error: { code: 'mail_disabled', message: reason },
})
