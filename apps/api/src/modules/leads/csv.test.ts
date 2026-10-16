import { describe, expect, it } from 'vitest'
import { csvCell, leadsCsv, toCsv } from './csv'

describe('CSV заявок', () => {
  it.each([
    ['=1+1', `"'=1+1"`],
    ['+7 900 123-45-67', `"'+7 900 123-45-67"`],
    ['-2', `"'-2"`],
    ['@SUM(A1)', `"'@SUM(A1)"`],
    ['\t=1', `"'\t=1"`],
    ['\r=1', `"'\r=1"`],
  ])('начало формулы «%s» обезврежено апострофом', (value, cell) => {
    expect(csvCell(value)).toBe(cell)
  })

  it('обычные значения — в кавычках, кавычки удвоены, формула внутри строки не трогается', () => {
    expect(csvCell('Анна')).toBe('"Анна"')
    expect(csvCell('Сказал "да"')).toBe('"Сказал ""да"""')
    expect(csvCell('a=1')).toBe('"a=1"')
    expect(csvCell('строка 1\nстрока 2')).toBe('"строка 1\nстрока 2"')
  })

  it('BOM, разделитель «;» и CRLF', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toBe('\uFEFF"a";"b"\r\n"c";"d"\r\n')
  })

  it('колонки — подписи полей всех форм, флажок — «да»/«нет», дата по Москве', () => {
    const csv = leadsCsv([
      {
        createdAt: new Date('2026-10-15T09:30:00.000Z'),
        status: 'processed',
        pageSlug: 'o-nas',
        formTitle: 'Заявка',
        data: [
          { name: 'name', label: 'Имя', type: 'name', value: 'Анна' },
          { name: 'agree', label: 'Перезвонить', type: 'checkbox', value: true },
        ],
      },
      {
        createdAt: new Date('2026-10-14T09:30:00.000Z'),
        status: 'new',
        pageSlug: 'index',
        formTitle: 'Другая',
        data: [{ name: 'city', label: 'Город', type: 'text', value: 'Тверь' }],
      },
    ])
    const [header, first, second] = csv.slice(1).split('\r\n')
    expect(header).toBe('"Дата (МСК)";"Статус";"Страница";"Форма";"Имя";"Перезвонить";"Город"')
    expect(first).toBe('"15.10.2026, 12:30";"обработана";"/o-nas";"Заявка";"Анна";"да";""')
    expect(second).toBe('"14.10.2026, 12:30";"новая";"/";"Другая";"";"";"Тверь"')
  })
})
