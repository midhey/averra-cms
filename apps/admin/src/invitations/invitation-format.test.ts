import { describe, expect, it } from 'vitest'
import {
  canResend,
  canRevoke,
  disableDescription,
  isDeadInvitation,
  pendingInvitationFor,
  replaceWarning,
  roleLabels,
  statusLabels,
  tokensReminder,
} from './invitation-format'

describe('подписи приглашений', () => {
  it('роли и состояния словами', () => {
    expect(roleLabels.client).toBe('Администратор сайта')
    expect(statusLabels.pending).toBe('Ждёт ответа')
    expect(statusLabels.expired).toBe('Истекло')
  })

  it('отозвать можно только ждущее', () => {
    expect(canRevoke('pending')).toBe(true)
    for (const status of ['accepted', 'revoked', 'expired'] as const) {
      expect(canRevoke(status)).toBe(false)
    }
  })

  it('отправить ещё раз — ждущее и истёкшее', () => {
    expect(['pending', 'expired'].map((s) => canResend(s as 'pending'))).toEqual([true, true])
    expect(canResend('accepted')).toBe(false)
    expect(canResend('revoked')).toBe(false)
  })

  it('мёртвая ссылка — только коды приглашений', () => {
    for (const code of ['used', 'revoked', 'expired', 'not_found']) {
      expect(isDeadInvitation(`invitation_${code}`)).toBe(true)
    }
    expect(isDeadInvitation('validation')).toBe(false)
    expect(isDeadInvitation(undefined)).toBe(false)
  })
})

describe('повторное приглашение', () => {
  const invitations = [
    { email: 'lera@example.ru', role: 'editor' as const, status: 'pending' as const },
    { email: 'old@example.ru', role: 'client' as const, status: 'revoked' as const },
    { email: 'done@example.ru', role: 'client' as const, status: 'accepted' as const },
  ]

  it('находит ждущее приглашение на адрес без учёта регистра и пробелов', () => {
    expect(pendingInvitationFor(invitations, ' Lera@Example.ru ')?.role).toBe('editor')
  })

  it('отозванное, принятое и пустой адрес — не повод предупреждать', () => {
    expect(pendingInvitationFor(invitations, 'old@example.ru')).toBeUndefined()
    expect(pendingInvitationFor(invitations, 'done@example.ru')).toBeUndefined()
    expect(pendingInvitationFor(invitations, '  ')).toBeUndefined()
    expect(replaceWarning(undefined, 'client')).toBeUndefined()
  })

  it('другая роль — предупреждение называет обе, и что ссылка умрёт', () => {
    const warning = replaceWarning(invitations[0], 'client')
    expect(warning).toContain('с ролью «Редактор»')
    expect(warning).toContain('роль станет «Администратор сайта»')
    expect(warning).toContain('ссылка из прежнего письма перестанет работать')
  })

  it('та же роль — просто «уже отправлено», без смены роли', () => {
    const warning = replaceWarning(invitations[0], 'editor')
    expect(warning).toContain('уже отправлено')
    expect(warning).not.toContain('роль станет')
  })
})

describe('окно «Отключить доступ»', () => {
  it('напоминает про токены по их числу, а не по роли человека', () => {
    // Есть токены — владельцу говорим, где отозвать; администратору сайта — что это делает владелец
    expect(disableDescription(2, true)).toContain('Выпущено им 2 токена для ИИ')
    expect(disableDescription(2, true)).toContain('отзовите их в «Установка → Доступ для ИИ»')
    expect(disableDescription(1, false)).toContain(
      'Выпущен им 1 токен для ИИ: он продолжит работать',
    )
    expect(disableDescription(1, false)).toContain('отозвать его может только владелец')
    expect(disableDescription(5, true)).toContain('5 токенов')
    // Токенов нет — без напоминания, как бы ни звалась роль
    expect(disableDescription(0, true)).not.toContain('токен')
    expect(disableDescription(0, false)).toContain('Вернуть доступ можно здесь же')
  })

  it('понижение роли: то же напоминание, пока токены есть', () => {
    expect(tokensReminder(3, true)).toContain('3 токена')
    expect(tokensReminder(0, true)).toBeUndefined()
  })

  it('согласует фразу с числом: 1, 21 — единственное, 2–4 и 5–20 — множественное', () => {
    for (const count of [1, 21, 101]) {
      const text = tokensReminder(count, true) ?? ''
      expect(text, String(count)).toContain(`Выпущен им ${count} токен для ИИ: он продолжит`)
      expect(text, String(count)).toContain('отзовите его в')
    }
    expect(tokensReminder(2, true)).toContain('Выпущено им 2 токена для ИИ: они продолжат')
    expect(tokensReminder(22, false)).toContain('отозвать их может')
    for (const count of [5, 11, 12, 20]) {
      expect(tokensReminder(count, true), String(count)).toContain(`Выпущено им ${count} токенов`)
    }
  })
})
