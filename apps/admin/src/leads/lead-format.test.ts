import { describe, expect, it } from 'vitest'
import {
  displayValue,
  fieldHref,
  leadEmail,
  leadName,
  leadPreview,
  leadSource,
  leadSummary,
  newLeadsLabel,
  notificationsLine,
  parseRecipients,
  recipientsError,
  replyMailto,
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

const typed = (name: string, type: string, value: string | boolean) => ({
  name,
  label: name,
  type,
  value,
})

describe('карточка и список заявок', () => {
  const lead = [
    typed('name', 'name', 'Мария'),
    typed('phone', 'phone', '+7 912 000-00-00'),
    typed('email', 'email', 'maria@example.ru'),
    typed('comment', 'textarea', 'Нужен ремонт ванной,\n4 м²'),
    typed('consent', 'checkbox', true),
  ]

  it('имя — поле типа «имя», без него — первое заполненное текстовое, без всего — «Заявка»', () => {
    expect(leadName(lead)).toBe('Мария')
    expect(leadName([typed('phone', 'phone', '+7'), typed('city', 'text', 'Тверь')])).toBe('Тверь')
    expect(leadName([typed('phone', 'phone', '+7 900'), typed('note', 'textarea', 'а')])).toBe(
      'Заявка',
    )
    expect(leadName([typed('who', 'name', '   ')])).toBe('Заявка')
  })

  it('строка под именем — комментарий, без него — остальные поля', () => {
    expect(leadPreview(lead)).toBe('Нужен ремонт ванной, 4 м²')
    expect(leadPreview(lead.slice(0, 3))).toBe('+7 912 000-00-00 · maria@example.ru')
  })

  it('почта для ответа — только корректный адрес из поля почты', () => {
    expect(leadEmail(lead)).toBe('maria@example.ru')
    expect(leadEmail([typed('email', 'email', 'не адрес')])).toBeUndefined()
    expect(leadEmail([typed('email', 'email', 'a@b.ru?cc=evil@x.ru')])).toBeUndefined()
    expect(leadEmail([typed('note', 'text', 'a@b.ru')])).toBeUndefined()
  })

  it('ссылки полей: телефон — tel: из цифр, почта — mailto:, только проверенные значения', () => {
    const phone = (value: string) => fieldHref({ type: 'phone', value })
    expect(phone('+7 (912) 000-00-00')).toBe('tel:+79120000000')
    expect(phone(' 8 912 000 00 00 ')).toBe('tel:89120000000')
    expect(phone('123')).toBeUndefined()
    expect(phone('+7 912 javascript:alert(1)')).toBeUndefined()
    expect(fieldHref({ type: 'email', value: 'maria@example.ru' })).toBe('mailto:maria@example.ru')
    expect(fieldHref({ type: 'email', value: 'a@b.ru?cc=evil@x.ru' })).toBeUndefined()
    expect(fieldHref({ type: 'text', value: '+7 912 000-00-00' })).toBeUndefined()
    expect(fieldHref({ type: 'phone', value: true })).toBeUndefined()
  })

  it('«Ответить письмом» — mailto с темой про сайт', () => {
    expect(replyMailto('maria@example.ru', 'Ремонт & Co')).toBe(
      `mailto:maria@example.ru?subject=${encodeURIComponent('Ваша заявка на сайте «Ремонт & Co»')}`,
    )
  })

  it('откуда заявка', () => {
    expect(leadSource({ pageSlug: 'index', formTitle: 'Замер' })).toBe('/ · форма «Замер»')
    expect(leadSource({ pageSlug: 'index', formTitle: 'Замер' }, 'Главная')).toBe(
      'Главная · форма «Замер»',
    )
  })

  it('куда уходят уведомления и сколько хранятся заявки', () => {
    expect(notificationsLine({ recipients: [], retentionDays: 180 }, true)).toBe(
      'Уведомления уходят владельцам админки · хранятся 180 дней',
    )
    expect(notificationsLine({ recipients: ['a@b.ru', 'c@d.ru'], retentionDays: 31 }, true)).toBe(
      'Уведомления уходят на a@b.ru, c@d.ru · хранятся 31 день',
    )
    expect(notificationsLine({ recipients: ['a@b.ru'], retentionDays: 22 }, false)).toBe(
      'Уведомления не уходят · хранятся 22 дня',
    )
  })
})
