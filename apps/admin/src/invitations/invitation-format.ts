// Подписи приглашений: роль и состояние словами. Решает всё API, здесь только слова

export type InvitationRole = 'editor' | 'client'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export const roleLabels: Record<InvitationRole, string> = {
  editor: 'Редактор',
  client: 'Клиент',
}

/** Что роль может — подсказка в форме приглашения и на экране принятия */
export const roleHints: Record<InvitationRole, string> = {
  editor: 'правит и публикует страницы сайта',
  client: 'правит черновики, а публикует владелец или редактор',
}

export const statusLabels: Record<InvitationStatus, string> = {
  pending: 'Ждёт ответа',
  accepted: 'Принято',
  revoked: 'Отозвано',
  expired: 'Истекло',
}

/** Отозвать можно только ждущее: принятое уже дало доступ, а истёкшее и так не работает */
export const canRevoke = (status: InvitationStatus) => status === 'pending'

/** Ошибка ссылки приглашения (код API) — тогда экран предлагает не форму, а что делать дальше */
export const isDeadInvitation = (code: string | undefined) =>
  code !== undefined && /^invitation_(not_found|used|revoked|expired)$/.test(code)
