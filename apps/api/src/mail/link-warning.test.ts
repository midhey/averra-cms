import { describe, expect, it } from 'vitest'
import { isLocalAdminUrl, localLinkWarning } from './link-warning'
import type { MailStatus } from './mailer'

const from = { address: 'noreply@example.ru', name: 'Averra CMS' }
const smtp: MailStatus = {
  enabled: true,
  provider: {
    kind: 'smtp',
    host: 'smtp.example.ru',
    port: 465,
    security: 'tls',
    user: 'noreply@example.ru',
    from,
  },
}

describe('ссылки из писем на этот компьютер', () => {
  it('localhost и его варианты — адрес этого компьютера, домен — нет', () => {
    for (const url of [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://admin.localhost',
    ]) {
      expect(isLocalAdminUrl(url), url).toBe(true)
    }
    expect(isLocalAdminUrl('https://admin.averra.ru')).toBe(false)
  })

  it('предупреждает только когда письма уходят по SMTP наружу, а ссылка — на localhost', () => {
    expect(localLinkWarning('http://localhost:5173', smtp)).toContain('ADMIN_URL')
    expect(localLinkWarning('https://admin.averra.ru', smtp)).toBeNull()
    // Файловый ящик и почта в памяти — разработка: там localhost и нужен
    expect(
      localLinkWarning('http://localhost:5173', {
        enabled: true,
        provider: { kind: 'file', dir: '.data/mail', from },
      }),
    ).toBeNull()
    expect(localLinkWarning('http://localhost:5173', { enabled: false, reason: 'нет' })).toBeNull()
  })
})
