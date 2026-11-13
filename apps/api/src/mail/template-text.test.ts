import { describe, expect, it } from 'vitest'
import { type EditableTemplate, MailTextError, validateTemplateText } from './template-text'
import { MailDataError, MailTemplateId, mailTemplates, renderMail } from './templates'

describe('редактируемый текст письма', () => {
  it.each(MailTemplateId.options)(
    '%s: стандартный текст использует все описанные подстановки и блоки',
    (id) => {
      const template = mailTemplates[id]
      expect(() =>
        validateTemplateText(template as EditableTemplate, template.defaultText),
      ).not.toThrow()
      const rendered = renderMail(id, template.example, template.defaultText)
      expect(rendered.subject).not.toBe('')
      expect(rendered.html).toContain('<!doctype html>')
      expect(rendered.text).toContain('Averra CMS')
      const source = Object.values(template.defaultText).join('\n')
      for (const name of [...Object.keys(template.vars), ...Object.keys(template.blocks)]) {
        expect(source, `${id}: ${name}`).toContain(`{${name}}`)
      }
      const original = renderMail(id, template.example)
      expect(rendered.replyTo).toBe(original.replyTo)
      expect(rendered.text.split('\n—\n')[1]).toBe(original.text.split('\n—\n')[1])
    },
  )

  it('абзацы, одиночная новая строка, примечание, экранирование текста и значений', () => {
    const rendered = renderMail(
      'lead-received',
      { siteName: '<img src=x> & {unknown}' },
      {
        subject: 'Спасибо',
        preheader: 'Предпросмотр',
        body: '<script>\n{siteName}\n\n> Пояснение',
      },
    )
    expect(rendered.html).toContain('&lt;script&gt;<br>&lt;img src=x&gt; &amp; {unknown}')
    expect(rendered.html).toContain('font-size:14px')
    expect(rendered.html).not.toContain('<script>')
    expect(rendered.text).toContain('<script>\n<img src=x> & {unknown}\n\nПояснение')
  })

  it('блок рисует код: ссылка и текстовая версия', () => {
    const template = mailTemplates['password-reset']
    const rendered = renderMail('password-reset', template.example, {
      ...template.defaultText,
      body: '{button}',
    })
    expect(rendered.html).toContain(`href="${template.example.url}"`)
    expect(rendered.text).toContain(template.example.url)
  })

  it('неизвестная подстановка, блок в заголовке и отсутствие обязательных блоков — ошибки поля', () => {
    for (const [id, text, field] of [
      ['lead-received', { subject: '{missing}', preheader: '', body: 'Спасибо' }, 'subject'],
      ['password-reset', { subject: '{button}', preheader: '', body: '{button}' }, 'subject'],
      ['password-reset', { subject: 'Сброс', preheader: '', body: 'Без ссылки' }, 'body'],
      ['lead-new', { subject: 'Заявка', preheader: '', body: 'Без полей' }, 'body'],
      ['notification', { subject: 'Событие', preheader: '', body: '{fields}' }, 'body'],
      [
        'password-reset',
        { subject: 'Сброс', preheader: '', body: 'Внутри {button}\n\n{button}' },
        'body',
      ],
    ] as const) {
      try {
        validateTemplateText(mailTemplates[id] as EditableTemplate, text)
        expect.fail('Нужна ошибка')
      } catch (error) {
        expect(error).toBeInstanceOf(MailTextError)
        expect((error as MailTextError).issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: field })]),
        )
      }
    }
  })

  it('переводы строк в теме и строке-превью не проходят; подставленная тема проверяется MailSubject', () => {
    const template = mailTemplates['lead-received']
    for (const field of ['subject', 'preheader']) {
      expect(() =>
        validateTemplateText(template as EditableTemplate, {
          ...template.defaultText,
          [field]: 'Тема\nBcc: x@example.ru',
        }),
      ).toThrow(MailTextError)
    }
    expect(() =>
      renderMail('lead-received', template.example, {
        ...template.defaultText,
        subject: '{siteName}'.repeat(20),
      }),
    ).toThrow(MailDataError)
  })
})
