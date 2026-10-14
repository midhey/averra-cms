import { describe, expect, it } from 'vitest'
import { MailAddress, MailLine, MailSenderName, MailSubject, MailUrl } from './mail'
import { setupZodMessages } from './zod-messages'

setupZodMessages()

const breaks = ['\r', '\n', '\r\n', '\u0000', '\t', '\u007f', '\u0085', '\u2028', '\u2029']

describe('заголовки письма', () => {
  it('адрес принимает обычную почту и обрезает пробелы по краям', () => {
    expect(MailAddress.parse('anna@example.ru')).toBe('anna@example.ru')
    expect(MailAddress.parse('  anna@example.ru ')).toBe('anna@example.ru')
  })

  it.each(breaks)('адрес с управляющим символом %j отклоняется, а не чистится', (char) => {
    const result = MailAddress.safeParse(`anna@example.ru${char}Bcc: all@example.ru`)
    expect(result.success).toBe(false)
    // Даже в конце строки: обрезка пробелов не должна молча съесть перевод строки
    expect(MailAddress.safeParse(`anna@example.ru${char}`).success).toBe(false)
  })

  it('адрес проверяется как почта и не длиннее 254 символов', () => {
    expect(MailAddress.safeParse('не почта').success).toBe(false)
    expect(MailAddress.safeParse(`${'a'.repeat(250)}@example.ru`).success).toBe(false)
  })

  it.each(breaks)('тема и имя отправителя с %j отклоняются', (char) => {
    expect(MailSubject.safeParse(`Тема${char}Bcc: x@example.ru`).success).toBe(false)
    expect(MailSenderName.safeParse(`Averra${char}CMS`).success).toBe(false)
    expect(MailLine().safeParse(`Сайт${char}Bcc`).success).toBe(false)
  })

  it('сообщение объясняет, что не так', () => {
    const result = MailSubject.safeParse('Тема\nBcc: x@example.ru')
    expect(result.error?.issues[0]?.message).toBe(
      'Нельзя переводить строку и вставлять управляющие символы',
    )
  })

  it('тема — от 1 до 200 символов, имя — до 100, строка шаблона — до заданного', () => {
    expect(MailSubject.safeParse('   ').success).toBe(false)
    expect(MailSubject.safeParse('а'.repeat(200)).success).toBe(true)
    expect(MailSubject.safeParse('а'.repeat(201)).success).toBe(false)
    expect(MailSenderName.safeParse('а'.repeat(101)).success).toBe(false)
    expect(MailLine(10).safeParse('а'.repeat(11)).success).toBe(false)
    expect(MailSenderName.parse('Averra CMS')).toBe('Averra CMS')
  })

  it('ссылка в письме — только http(s)', () => {
    expect(MailUrl.parse('https://admin.example.ru/reset?token=1')).toBe(
      'https://admin.example.ru/reset?token=1',
    )
    expect(MailUrl.safeParse('javascript:alert(1)').success).toBe(false)
    expect(MailUrl.safeParse('data:text/html,<b>x</b>').success).toBe(false)
    expect(MailUrl.safeParse('ftp://example.ru').success).toBe(false)
  })
})
