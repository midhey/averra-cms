import { describe, expect, it } from 'vitest'
import { CSV_BOM, csvCell, csvLine, leadCsvRow, leadsCsvHeader } from './csv'

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

  it('разделитель «;» и CRLF в конце строки', () => {
    expect(csvLine(['a', 'b'])).toBe('"a";"b"\r\n')
  })

  // Порядок колонок выбирает выгрузка (exportLabels в repo.ts, проверен в leads.test.ts),
  // здесь — как строка заявки ложится под заданные подписи
  it('строка под заголовком: флажок — «да»/«нет», дата по Москве, нет поля — пустая ячейка, форма подвала подписана', () => {
    const labels = ['Имя', 'Перезвонить', 'Город']
    const first = leadCsvRow(
      {
        createdAt: new Date('2026-10-15T09:30:00.000Z'),
        status: 'processed',
        pageSlug: 'o-nas',
        source: 'block',
        formTitle: 'Заявка',
        data: [
          { name: 'name', label: 'Имя', type: 'name', value: 'Анна' },
          { name: 'agree', label: 'Перезвонить', type: 'checkbox', value: true },
        ],
      },
      labels,
    )
    const second = leadCsvRow(
      {
        createdAt: new Date('2026-10-14T09:30:00.000Z'),
        status: 'new',
        pageSlug: 'index',
        source: 'footer',
        formTitle: 'Другая',
        data: [{ name: 'city', label: 'Город', type: 'text', value: 'Тверь' }],
      },
      labels,
    )
    expect(CSV_BOM + csvLine(leadsCsvHeader(labels)) + csvLine(first) + csvLine(second)).toBe(
      '\uFEFF"Дата (МСК)";"Статус";"Страница";"Форма";"Имя";"Перезвонить";"Город"\r\n' +
        '"15.10.2026, 12:30";"обработана";"/o-nas";"Заявка";"Анна";"да";""\r\n' +
        '"14.10.2026, 12:30";"новая";"/";"Другая (подвал сайта)";"";"";"Тверь"\r\n',
    )
  })
})
