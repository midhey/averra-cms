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

/** Почему ссылка приглашения не работает. not_found — нет такого или токен не совпал */
export type InvitationProblem = 'not_found' | 'used' | 'revoked' | 'expired'

const invitationMessages: Record<InvitationProblem, string> = {
  not_found: 'Приглашение не найдено. Откройте ссылку из письма целиком или попросите новое',
  used: 'Приглашение уже принято. Войдите в админку своей почтой и паролем',
  revoked: 'Приглашение отозвано. Если доступ всё же нужен, попросите владельца прислать новое',
  expired: 'Срок приглашения истёк. Попросите владельца сайта прислать новое',
}

/**
 * Ссылка приглашения не действует. Нет такого — 404, а принятое, отозванное и истёкшее —
 * 410 Gone: приглашение было, но больше не работает. Код говорит админке, что именно
 */
export const invitationError = (problem: InvitationProblem) =>
  ({
    status: problem === 'not_found' ? 404 : 410,
    body: { error: { code: `invitation_${problem}`, message: invitationMessages[problem] } },
  }) as const
