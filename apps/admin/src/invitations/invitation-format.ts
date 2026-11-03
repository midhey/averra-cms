// Подписи приглашений и участников: роль и состояние словами. Решает всё API, здесь только слова

import { roleLabels, type SiteRoleKey } from '@averra/schema'

export { roleLabels }

export type InvitationRole = 'editor' | 'client'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

/** Что роль может — подсказка в форме приглашения, в окне роли и на экране принятия */
export const roleHints: Record<SiteRoleKey, string> = {
  owner: 'может всё: код своих блоков, тему, токены для ИИ, обновление установки и участников',
  client:
    'ведёт страницы, SEO и контакты, заявки и уведомления, шапку и подвал, приглашает редакторов',
  editor: 'создаёт, правит и публикует страницы и картинки',
}

export const statusLabels: Record<InvitationStatus, string> = {
  pending: 'Ждёт ответа',
  accepted: 'Принято',
  revoked: 'Отозвано',
  expired: 'Истекло',
}

/** Отозвать можно только ждущее: принятое уже дало доступ, а истёкшее и так не работает */
export const canRevoke = (status: InvitationStatus) => status === 'pending'

/** Отправить ещё раз — ждущее (письмо потерялось) и истёкшее: новая ссылка с той же ролью */
export const canResend = (status: InvitationStatus) => status === 'pending' || status === 'expired'

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

/**
 * Что сказать в окне «Отключить доступ»: сессии гаснут сразу, а токены для ИИ, которые выпустил
 * владелец, остаются рабочими (они не привязаны к входу). Владельцу прямо говорим, где их
 * отозвать; у других ролей токенов быть не может
 */
export function disableDescription(role: SiteRoleKey | null) {
  const base =
    'Все входы этого человека в админку завершатся сразу, войти снова не получится. Вернуть доступ можно здесь же.'
  if (role !== 'owner') return base
  return `${base} Токены для ИИ, которые он выпустил, продолжат работать: отзовите их в «Установка → Доступ для ИИ».`
}
