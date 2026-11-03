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

type PendingCandidate = { email: string; role: InvitationRole; status: InvitationStatus }

/** Ждущее приглашение на этот адрес (почту сравниваем без регистра, как API) */
export function pendingInvitationFor<T extends PendingCandidate>(
  invitations: readonly T[],
  email: string,
) {
  const wanted = email.trim().toLowerCase()
  if (wanted === '') return undefined
  return invitations.find(
    (invitation) => invitation.status === 'pending' && invitation.email.toLowerCase() === wanted,
  )
}

/**
 * Что сказать до отправки, если адрес уже приглашён: новое приглашение молча заменяет прежнее —
 * отзывает его ссылку и ставит выбранную сейчас роль. Нет ждущего приглашения — предупреждать
 * не о чем
 */
export function replaceWarning(existing: PendingCandidate | undefined, role: InvitationRole) {
  if (!existing) return undefined
  if (existing.role === role) {
    return `На ${existing.email} приглашение уже отправлено. Новое заменит его: ссылка из прежнего письма перестанет работать.`
  }
  return `На ${existing.email} уже отправлено приглашение с ролью «${roleLabels[existing.role]}». Новое заменит его: роль станет «${roleLabels[role]}», а ссылка из прежнего письма перестанет работать.`
}
