import { describe, expect, it } from 'vitest'
import {
  displayValue,
  leadSummary,
  newLeadsLabel,
  parseRecipients,
  recipientsError,
} from './lead-format'

const field = (label: string, value: string | boolean) => ({
  name: label,
  label,
  type: typeof value === 'boolean' ? 'checkbox' : 'text',
  value,
})

describe('заявки в админке', () => {
  it('значения: флажок словами, пустое — прочерк', () => {
    expect(displayValue({ value: true })).toBe('да')
    expect(displayValue({ value: false })).toBe('нет')
    expect(displayValue({ value: '' })).toBe('—')
    expect(displayValue({ value: 'Анна' })).toBe('Анна')
  })

  it('кратко: первые два заполненных текстовых поля, без переводов строк', () => {
    expect(
      leadSummary([
        field('Имя', ''),
        field('Перезвонить', true),
        field('Телефон', '+7 900 123-45-67'),
        field('Комментарий', 'строка\nвторая'),
        field('Город', 'Тверь'),
      ]),
    ).toBe('+7 900 123-45-67 · строка вторая')
    expect(leadSummary([field('Имя', 'а'.repeat(100))], 10)).toBe('ааааааааа…')
    expect(leadSummary([field('Флажок', true)])).toBe('Без заполненных полей')
  })

  it('адреса уведомлений — через запятую, точку с запятой или с новой строки', () => {
    expect(parseRecipients(' a@b.ru, c@d.ru;\ne@f.ru  ')).toEqual(['a@b.ru', 'c@d.ru', 'e@f.ru'])
    expect(parseRecipients('   ')).toEqual([])
  })

  it('ошибка адреса называет сам адрес', () => {
    expect(recipientsError({ 'recipients.1': 'Нужен адрес почты' }, ['a@b.ru', 'плохой'])).toBe(
      'плохой: Нужен адрес почты',
    )
    expect(recipientsError({ recipients: 'Адреса повторяются' }, [])).toBe('Адреса повторяются')
    expect(recipientsError({ retentionDays: 'Мало' }, [])).toBeUndefined()
  })

  it('счётчик новых по-русски', () => {
    expect(newLeadsLabel(1)).toBe('1 новая')
    expect(newLeadsLabel(3)).toBe('3 новые')
    expect(newLeadsLabel(5)).toBe('5 новых')
    expect(newLeadsLabel(11)).toBe('11 новых')
    expect(newLeadsLabel(21)).toBe('21 новая')
  })
})
