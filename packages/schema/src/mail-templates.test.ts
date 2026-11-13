import { describe, expect, it } from 'vitest'
import { MailTemplateText } from './mail-templates'

const text = { subject: 'Спасибо, {siteName}', preheader: '', body: 'Ваша заявка получена.' }

describe('текст шаблона письма', () => {
  it('разрешает подстановки и многострочное тело, ограничивает длину и лишние поля', () => {
    expect(MailTemplateText.safeParse({ ...text, body: 'Абзац\n\n> Примечание' }).success).toBe(
      true,
    )
    for (const value of [
      { ...text, subject: '' },
      { ...text, subject: 'x'.repeat(201) },
      { ...text, preheader: 'x'.repeat(201) },
      { ...text, body: 'x'.repeat(5001) },
      { ...text, html: '<p>Нет</p>' },
    ])
      expect(MailTemplateText.safeParse(value).success).toBe(false)
  })

  it.each(['\n', '\r', '\u0000', '\u2028'])('не принимает разрыв заголовка %j', (character) => {
    expect(MailTemplateText.safeParse({ ...text, subject: `Тема${character}` }).success).toBe(false)
    expect(MailTemplateText.safeParse({ ...text, preheader: `Превью${character}` }).success).toBe(
      false,
    )
  })
})
