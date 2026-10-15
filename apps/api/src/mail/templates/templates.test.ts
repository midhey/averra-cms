import { describe, expect, it } from 'vitest'
import { formatDays, formatMinutes } from './define'
import { MailDataError, MailTemplateId, mailTemplates, previewMail, renderMail } from './index'

const errorOf = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('ожидалась ошибка')
}

describe('шаблоны писем', () => {
  it.each(MailTemplateId.options)('«%s» собирается на примере: тема, HTML и текст', (id) => {
    const mail = previewMail(id)
    expect(mail.subject.length).toBeGreaterThan(0)
    expect(mail.html).toMatch(/^<!doctype html>/)
    expect(mail.html).toContain('<html lang="ru">')
    expect(mail.html).toContain(`<title>${mail.subject}</title>`)
    // Почтовые клиенты режут <style>: оформление только инлайн
    expect(mail.html).not.toContain('<style')
    expect(mail.html).toContain('style="')
    expect(mail.text).toContain('Averra CMS · письмо отправлено автоматически')
    expect(mail.text).not.toContain('<')
  })

  it('пример каждого шаблона проходит его схему', () => {
    for (const template of Object.values(mailTemplates)) {
      expect(template.schema.safeParse(template.example).success, template.id).toBe(true)
    }
  })

  it('данные пользователя только экранируются: сырого HTML в письме нет', () => {
    const mail = renderMail('invitation', {
      ...mailTemplates.invitation.example,
      inviterName: '<img src=x onerror=alert(1)>',
      siteName: 'Сайт "Ромашка" & Ко',
    })
    expect(mail.html).not.toContain('<img src=x')
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(mail.html).toContain('Сайт &quot;Ромашка&quot; &amp; Ко')
    // В теме и текстовой версии — как есть: там HTML не разбирается
    expect(mail.subject).toBe('Приглашение на сайт «Сайт "Ромашка" & Ко» в Averra CMS')
  })

  it('ссылка — только http(s): javascript: не проходит схему', () => {
    const error = errorOf(() =>
      renderMail('password-reset', {
        ...mailTemplates['password-reset'].example,
        url: 'javascript:alert(1)',
      }),
    )
    expect(error).toBeInstanceOf(MailDataError)
  })

  it('перевод строки в данных, которые идут в тему, отклоняется схемой шаблона', () => {
    const error = errorOf(() =>
      renderMail('invitation', {
        ...mailTemplates.invitation.example,
        siteName: 'Сайт\r\nBcc: all@example.ru',
      }),
    )
    expect(error).toBeInstanceOf(MailDataError)
    expect((error as MailDataError).issues[0]?.path).toEqual(['siteName'])
  })

  it('кривые или лишние поля — ошибка с путём', () => {
    expect(() => renderMail('mail-test', { sentAt: 'вчера', provider: 'x' })).toThrow(/sentAt/)
    const extra = errorOf(() =>
      renderMail('mail-test', { ...mailTemplates['mail-test'].example, extra: 1 }),
    )
    expect(extra).toBeInstanceOf(MailDataError)
  })

  it('сроки ссылок — по-русски', () => {
    expect(formatMinutes(60)).toBe('1 час')
    expect(formatMinutes(120)).toBe('2 часа')
    expect(formatMinutes(30)).toBe('30 минут')
    expect(formatMinutes(21)).toBe('21 минуту')
    expect(formatDays(1)).toBe('1 день')
    expect(formatDays(3)).toBe('3 дня')
    expect(formatDays(7)).toBe('7 дней')
    expect(formatDays(11)).toBe('11 дней')
  })

  it('сброс пароля говорит срок и даёт ссылку и кнопкой, и текстом', () => {
    const mail = previewMail('password-reset')
    expect(mail.text).toContain('https://admin.example.ru/reset-password#token=example')
    expect(mail.text).toContain('Ссылка работает 1 час и только один раз.')
    expect(mail.html).toContain('href="https://admin.example.ru/reset-password#token=example"')
  })

  it('приглашение не обещает задать пароль тому, у кого вход уже есть', () => {
    const mail = previewMail('invitation')
    expect(mail.text).toContain('https://admin.example.ru/invite#token=example')
    expect(mail.text).not.toContain('задайте свой пароль')
    expect(mail.text).toContain('Если вход уже есть, войдите своим паролем')
    expect(mail.text).toContain('Если входа в админку у вас ещё нет')
  })

  it('примеры ссылок — с токеном во фрагменте, как настоящие письма', () => {
    for (const template of Object.values(mailTemplates)) {
      const { url } = template.example as { url?: string }
      if (url !== undefined) expect(url).not.toContain('?token=')
    }
  })
})
