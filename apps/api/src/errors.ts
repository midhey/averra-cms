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

/**
 * 409 — настройки SMTP в админке не поменять: их решило окружение API (SMTP_*, MAIL_TRANSPORT)
 * или нет ключа шифрования MAIL_ENCRYPTION_KEY. message объясняет, что сделать
 */
export const mailSettingsLocked = (message: string) => ({
  error: { code: 'mail_settings_locked', message },
})

/**
 * 409 — «Сохранить» пришло с итогом проверки, но проверяли другие настройки (поменяли поле или
 * пароль после проверки), другой владелец, или проверка устарела
 */
export const checkStale = () => ({
  error: {
    code: 'check_stale',
    message:
      'Проверка подключения была для других настроек или устарела (её итог живёт 15 минут). ' +
      'Проверьте подключение ещё раз — или сохраните без проверки',
  },
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
