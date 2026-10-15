import { describe, expect, it } from 'vitest'
import { canRevoke, isDeadInvitation, roleLabels, statusLabels } from './invitation-format'

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
