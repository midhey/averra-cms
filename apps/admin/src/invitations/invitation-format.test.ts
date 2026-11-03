import { describe, expect, it } from 'vitest'
import {
  canRevoke,
  isDeadInvitation,
  pendingInvitationFor,
  replaceWarning,
  roleLabels,
  statusLabels,
} from './invitation-format'

describe('подписи приглашений', () => {
  it('роли и состояния словами', () => {
    expect(roleLabels.client).toBe('Клиент')
    expect(statusLabels.pending).toBe('Ждёт ответа')
    expect(statusLabels.expired).toBe('Истекло')
  })

  it('отозвать можно только ждущее', () => {
    expect(canRevoke('pending')).toBe(true)
    for (const status of ['accepted', 'revoked', 'expired'] as const) {
      expect(canRevoke(status)).toBe(false)
    }
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
    expect(warning).toContain('роль станет «Клиент»')
    expect(warning).toContain('ссылка из прежнего письма перестанет работать')
  })

  it('та же роль — просто «уже отправлено», без смены роли', () => {
    const warning = replaceWarning(invitations[0], 'editor')
    expect(warning).toContain('уже отправлено')
    expect(warning).not.toContain('роль станет')
  })
})
