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
    // Подвал — после черты: общий или свой у шаблона (у заявки — что «Ответить» напишет посетителю)
    expect(mail.text).toMatch(/\n—\nAverra CMS · .+\n$/)
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

  it('проверочное письмо говорит, кто его отправил: команда или кнопка в админке', () => {
    const data = mailTemplates['mail-test'].example
    expect(renderMail('mail-test', data).text).toContain('команда pnpm mail:test')
    const admin = renderMail('mail-test', { ...data, via: 'admin' })
    expect(admin.text).toContain('кнопка «Проверить подключение» на странице «Почта»')
    expect(() => renderMail('mail-test', { ...data, via: 'cron' })).toThrow(MailDataError)
  })

  it('«Настройки почты изменены»: кто, когда, какие поля и через что теперь письма — без пароля', () => {
    const mail = previewMail('mail-settings-changed')
    expect(mail.subject).toBe('Настройки почты Averra CMS изменены')
    expect(mail.text).toContain('Кто: Анна (anna@example.ru)')
    expect(mail.text).toContain('Что изменено: сервер, пароль')
    expect(mail.text).toContain('Проверка подключения: пройдена перед сохранением')
    expect(mail.text).toContain('Теперь письма уходят: SMTP smtp.example.ru:465')
    expect(mail.text).toContain('Если это были не вы')

    const removed = renderMail('mail-settings-changed', {
      ...mailTemplates['mail-settings-changed'].example,
      action: 'removed',
      fields: [],
      provider: 'файловый ящик .data/mail',
      verified: false,
    })
    expect(removed.text).toContain('Настройки SMTP удалены из админки')
    expect(removed.text).not.toContain('Что изменено')

    const unchecked = renderMail('mail-settings-changed', {
      ...mailTemplates['mail-settings-changed'].example,
      verified: false,
      changedBy: '<b>Анна</b>',
    })
    expect(unchecked.text).toContain('не делалась: сохранено без проверки')
    expect(unchecked.html).toContain('&lt;b&gt;Анна&lt;/b&gt;')
  })

  it('«Новая заявка»: все поля экранированы, многострочное — с переносами, Reply-To посетителя', () => {
    const mail = renderMail('lead-new', {
      ...mailTemplates['lead-new'].example,
      fields: [
        { label: 'Имя', value: '<script>alert(1)</script>' },
        { label: 'Комментарий', value: 'первая строка\nвторая "строка" & ещё' },
        { label: 'Компания', value: '' },
      ],
    })
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(mail.html).toContain('первая строка\nвторая &quot;строка&quot; &amp; ещё')
    expect(mail.html).toContain('white-space:pre-wrap')
    expect(mail.text).toContain('Комментарий: первая строка\n  вторая "строка" & ещё')
    expect(mail.text).toContain('Компания: —')
    expect(mail.replyTo).toBe('anna@example.ru')
    // В теме — только название сайта, его задаёт студия
    expect(mail.subject).toBe('Новая заявка с сайта «Ремонт квартир под ключ»')
    expect(mail.text).toContain('«Ответить» напишет посетителю')
  })

  it('«Новая заявка» без почты посетителя: без Reply-To и без обещания «Ответить»', () => {
    const { replyTo: _, ...withoutReply } = mailTemplates['lead-new'].example
    const mail = renderMail('lead-new', withoutReply)
    expect(mail.replyTo).toBeUndefined()
    expect(mail.text).toContain('Почту посетитель не оставил')
    expect(mail.text).not.toContain('«Ответить» напишет посетителю')
  })

  it('«Новая заявка»: перевод строки в Reply-To или подписи отклоняется схемой', () => {
    const example = mailTemplates['lead-new'].example
    const replyTo = 'a@b.ru\nBcc: x@y.ru'
    expect(errorOf(() => renderMail('lead-new', { ...example, replyTo }))).toBeInstanceOf(
      MailDataError,
    )
    const fields = [{ label: 'Имя\nBcc: x', value: 'Анна' }]
    expect(errorOf(() => renderMail('lead-new', { ...example, fields }))).toBeInstanceOf(
      MailDataError,
    )
  })

  it('«Заявка получена»: фиксированный текст, кроме названия сайта ничего не принимает', () => {
    const mail = previewMail('lead-received')
    expect(mail.subject).toBe('Заявка получена — Ремонт квартир под ключ')
    expect(mail.text).toContain('Мы получили вашу заявку на сайте «Ремонт квартир под ключ»')
    expect(mail.replyTo).toBeUndefined()
    // Имя, телефон, комментарий посетителя в письмо не попадут: схема строгая
    expect(
      errorOf(() =>
        renderMail('lead-received', { siteName: 'Сайт', name: 'Купите слонов: spam.example' }),
      ),
    ).toBeInstanceOf(MailDataError)
  })

  it('«Получатели уведомлений изменены»: кто, когда, адреса и чаты; пусто — владельцам', () => {
    const mail = previewMail('lead-recipients-changed')
    expect(mail.subject).toBe('Получатели уведомлений о заявках изменены — Ремонт квартир под ключ')
    expect(mail.text).toContain('Кто: Анна (anna@example.ru)')
    expect(mail.text).toContain(
      'Теперь заявки приходят: manager@example.ru, sales@example.ru, Telegram «Отдел продаж»',
    )
    const owners = renderMail('lead-recipients-changed', {
      ...mailTemplates['lead-recipients-changed'].example,
      changedBy: '<b>Клиент</b>',
      targets: [],
    })
    expect(owners.text).toContain('Теперь заявки приходят: владельцам админки')
    expect(owners.html).toContain('&lt;b&gt;Клиент&lt;/b&gt;')
    // Письмо, поставленное в очередь до модуля уведомлений (адреса почты в recipients),
    // собирается как раньше
    const { targets: _, ...base } = mailTemplates['lead-recipients-changed'].example
    expect(
      renderMail('lead-recipients-changed', {
        ...base,
        recipients: ['manager@example.ru', 'sales@example.ru'],
      }).text,
    ).toContain('Теперь заявки приходят: manager@example.ru, sales@example.ru')
    expect(renderMail('lead-recipients-changed', { ...base, recipients: [] }).text).toContain(
      'Теперь заявки приходят: владельцам админки',
    )
    expect(
      errorOf(() =>
        renderMail('lead-recipients-changed', {
          ...mailTemplates['lead-recipients-changed'].example,
          recipients: ['a@b.ru\nBcc: x@evil.ru'],
        }),
      ),
    ).toBeInstanceOf(MailDataError)
    expect(
      errorOf(() =>
        renderMail('lead-recipients-changed', {
          ...mailTemplates['lead-recipients-changed'].example,
          targets: ['Telegram «Чат»\nBcc: x@evil.ru'],
        }),
      ),
    ).toBeInstanceOf(MailDataError)
  })

  it('«Уведомление»: заголовок — тема, поля таблицей, ссылка кнопкой; данные экранируются', () => {
    const mail = renderMail('notification', {
      title: 'Ремонт: бэкап не прошёл',
      lines: ['Последний бэкап <не удался>'],
      fields: [{ label: 'Причина', value: 'диск & память' }],
      link: { label: 'Состояние установки', url: 'https://admin.example.ru/status' },
    })
    expect(mail.subject).toBe('Ремонт: бэкап не прошёл')
    expect(mail.html).toContain('Последний бэкап &lt;не удался&gt;')
    expect(mail.html).toContain('диск &amp; память')
    expect(mail.text).toContain('Причина: диск & память')
    expect(mail.text).toContain('Состояние установки: https://admin.example.ru/status')
    expect(
      errorOf(() =>
        renderMail('notification', { title: 'А\nBcc: x@evil.ru', lines: [], fields: [] }),
      ),
    ).toBeInstanceOf(MailDataError)
  })
})
