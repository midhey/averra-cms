import { MailLine } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import { leadFormLine, leadNewTemplate } from './lead-new'
import { toMailLine } from './line'

describe('toMailLine', () => {
  it('переводы строк и управляющие символы становятся пробелом', () => {
    expect(toMailLine('Анна\r\nBcc: x@evil.test', 100, '—')).toBe('Анна Bcc: x@evil.test')
    expect(toMailLine('Анна\u2028\u0000Петрова', 100, '—')).toBe('Анна Петрова')
  })

  it('обрезает до max с многоточием, и результат проходит MailLine той же длины', () => {
    const line = toMailLine('а'.repeat(150), 100, '—')
    expect(line).toHaveLength(100)
    expect(line.endsWith('…')).toBe(true)
    expect(MailLine(100).safeParse(line).success).toBe(true)
  })

  it('подпись формы, обрезанная приёмом заявки, проходит проверку шаблона «Новая заявка»', () => {
    // Та же функция, что у приёма заявки (modules/leads/service.ts)
    const title = leadFormLine(`${'Длинный заголовок формы '.repeat(10)} (подвал сайта)`)
    expect(leadNewTemplate.schema.shape.formTitle.safeParse(title).success).toBe(true)
    // На символ длиннее предела шаблон не примет: предел приёма и шаблона — один
    expect(leadNewTemplate.schema.shape.formTitle.safeParse(`${title}!`).success).toBe(false)
  })

  it('пустое после чистки — запасной текст', () => {
    expect(toMailLine(' \n\t ', 100, 'коллега')).toBe('коллега')
  })
})
