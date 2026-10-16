import { beforeAll, describe, expect, it } from 'vitest'
import { form } from './blocks'
import {
  CONSENT_FIELD,
  EMAIL_PATTERN,
  type FormField,
  fieldRules,
  formFieldInput,
  formFieldTypes,
  HONEYPOT_FIELD,
  LeadSettings,
  leadValuesSchema,
  NOT_BLANK_PATTERN,
  patternRegExp,
} from './forms'
import { setupZodMessages } from './zod-messages'

beforeAll(setupZodMessages)

const field = (overrides: Partial<FormField> & Pick<FormField, 'type'>): FormField => ({
  name: overrides.type,
  label: 'Поле',
  required: false,
  ...overrides,
})

/**
 * Что сказал бы браузер о значении поля по его атрибутам: required, maxlength и pattern —
 * pattern собирается так же, как в браузере (^(?:…)$ с флагом v). Тип email браузер проверяет
 * ещё и сам, его образцы ниже подобраны так, чтобы это совпадало
 */
function browserAccepts(input: ReturnType<typeof formFieldInput>, raw: string) {
  // Значение type="email" браузер сам очищает от пробелов по краям (HTML: value sanitization)
  const value = input.element === 'input' && input.type === 'email' ? raw.trim() : raw
  if (input.element === 'checkbox') return !input.required || value !== ''
  if (value === '') return !input.required
  if (input.element === 'select') return input.options.includes(value)
  // Однострочное поле браузер не даст ввести с переводом строки — такие образцы не для него
  if (value.length > input.maxLength) return false
  if (input.element === 'input' && input.pattern) {
    return patternRegExp(input.pattern).test(value)
  }
  return true
}

function serverAccepts(fieldValue: FormField, value: string) {
  const values = value === '' ? {} : { [fieldValue.name]: value }
  return leadValuesSchema([fieldValue]).safeParse({ ...values, [CONSENT_FIELD]: 'yes' }).success
}

describe('браузер и сервер проверяют поле одинаково', () => {
  const samples: Record<Exclude<FormField['type'], 'select' | 'checkbox'>, string[]> = {
    name: ['Анна', 'Анна-Мария Иванова', 'а'.repeat(100), 'а'.repeat(101), '', '   '],
    phone: [
      '+7 (900) 123-45-67',
      '89001234567',
      '12345',
      '1234',
      '+7 abc 1234567',
      '------',
      '1'.repeat(30),
      '1'.repeat(31),
      '',
    ],
    email: [
      'anna@example.ru',
      'a.b+c@mail.example.ru',
      "o'neil@example.ru",
      // IDN: как набрал человек и как отправляет Chrome (punycode)
      'anna@пример.рф',
      'anna@xn--e1afmkfd.xn--p1ai',
      'anna@example',
      'anna',
      'a b@c.ru',
      'a..b@example.ru',
      '.anna@example.ru',
      'anna@example.r',
      'a!b@example.ru',
      'a,b@example.ru',
      '   ',
      '',
    ],
    text: ['Любой текст', 'т'.repeat(200), 'т'.repeat(201), '', '  ', ' т '],
    textarea: ['Строка', 'т'.repeat(2000), 'т'.repeat(2001), ''],
  }

  for (const [type, values] of Object.entries(samples)) {
    for (const required of [true, false]) {
      it(`${type}, ${required ? 'обязательное' : 'необязательное'}`, () => {
        const definition = field({ type: type as FormField['type'], required })
        const input = formFieldInput(definition)
        for (const value of values) {
          expect(serverAccepts(definition, value), `сервер: «${value}»`).toBe(
            browserAccepts(input, value),
          )
        }
      })
    }
  }

  it('выбор из списка: только варианты', () => {
    const definition = field({
      type: 'select',
      required: true,
      options: [{ label: 'Ремонт' }, { label: 'Дизайн' }],
    })
    const input = formFieldInput(definition)
    expect(input).toMatchObject({ element: 'select', options: ['Ремонт', 'Дизайн'] })
    for (const value of ['Ремонт', 'Дизайн', 'Другое', '']) {
      expect(serverAccepts(definition, value), value).toBe(browserAccepts(input, value))
    }
  })

  it('флажок: обязательный должен быть отмечен, необязательный — false без значения', () => {
    const required = field({ type: 'checkbox', required: true })
    expect(serverAccepts(required, 'yes')).toBe(true)
    expect(serverAccepts(required, '')).toBe(false)
    const optional = field({ type: 'checkbox' })
    expect(leadValuesSchema([optional]).parse({ consent: 'yes' })).toEqual({
      checkbox: false,
      consent: true,
    })
    expect(leadValuesSchema([optional]).parse({ checkbox: 'yes', consent: 'yes' })).toEqual({
      checkbox: true,
      consent: true,
    })
  })

  it.each(['no', '0', 'false', 'on', 'true', ' yes', 'YES'])(
    'флажок со значением %j, которого форма не шлёт, — ошибка, а не догадка',
    (value) => {
      for (const required of [true, false]) {
        const result = leadValuesSchema([field({ type: 'checkbox', required })]).safeParse({
          checkbox: value,
          consent: 'yes',
        })
        expect(result.error?.issues[0]).toMatchObject({
          path: ['checkbox'],
          message: 'Неверное значение флажка: отметьте его в форме или снимите отметку',
        })
      }
    },
  )

  it('maxlength в браузере — предел схемы сервера', () => {
    for (const type of formFieldTypes) {
      const input = formFieldInput(field({ type, options: [{ label: 'a' }] }))
      if ('maxLength' in input) expect(input.maxLength).toBe(fieldRules[type].max)
    }
  })

  it('атрибуты полей: тип, автозаполнение, обязательность', () => {
    expect(formFieldInput(field({ type: 'phone', required: true }))).toMatchObject({
      element: 'input',
      type: 'tel',
      required: true,
      autoComplete: 'tel',
      inputMode: 'tel',
    })
    expect(formFieldInput(field({ type: 'email' }))).toMatchObject({
      type: 'email',
      required: false,
    })
    expect(formFieldInput(field({ type: 'textarea' }))).toEqual({
      element: 'textarea',
      name: 'textarea',
      required: false,
      maxLength: 2000,
    })
  })

  it('обязательное однострочное поле без своего шаблона — не из одних пробелов', () => {
    expect(formFieldInput(field({ type: 'name', required: true }))).toMatchObject({
      pattern: NOT_BLANK_PATTERN,
    })
    expect(formFieldInput(field({ type: 'text', required: true }))).toMatchObject({
      pattern: NOT_BLANK_PATTERN,
    })
    expect(formFieldInput(field({ type: 'text' }))).not.toHaveProperty('pattern')
    // У телефона и почты шаблон свой, и он тоже не пускает одни пробелы
    expect(formFieldInput(field({ type: 'email', required: true }))).toMatchObject({
      pattern: EMAIL_PATTERN,
    })
  })

  it('pattern собирается с флагом v, как в браузере', () => {
    for (const type of formFieldTypes) {
      const pattern = fieldRules[type].pattern
      if (pattern) expect(() => patternRegExp(pattern.source)).not.toThrow()
    }
  })
})

describe('заявка на сервере', () => {
  const fields = [
    field({ name: 'name', type: 'name', required: true }),
    field({ name: 'comment', type: 'textarea' }),
    field({ name: 'email', type: 'email' }),
  ]
  const parse = (values: Record<string, unknown>) =>
    leadValuesSchema(fields).safeParse({ consent: 'yes', ...values })

  it('перевод строки в однострочном поле — ошибка, а не тихая чистка', () => {
    const result = parse({ name: 'Анна\r\nBcc: x@evil.ru' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['name'])
    expect(parse({ email: 'a@b.ru\nBcc: x@evil.ru' }).success).toBe(false)
  })

  it('в многострочном переводы строк можно, \\r\\n считается одним символом', () => {
    const result = parse({ name: 'Анна', comment: `${'а'.repeat(1000)}\r\n${'б'.repeat(999)}` })
    expect(result.success).toBe(true)
    expect(result.data?.comment).toBe(`${'а'.repeat(1000)}\n${'б'.repeat(999)}`)
  })

  it('в многострочном нет управляющих символов, кроме перевода строки и табуляции', () => {
    for (const comment of ['a\u0000b', 'a\u0008b', 'a\u000bb', 'a\u001fb', 'a\u007fb']) {
      const result = parse({ name: 'Анна', comment })
      expect(result.error?.issues[0], JSON.stringify(comment)).toMatchObject({
        path: ['comment'],
        message: 'Без управляющих символов',
      })
    }
    expect(parse({ name: 'Анна', comment: 'а\tб\nв' }).success).toBe(true)
  })

  it('пробелы по краям обрезаются, пустое необязательное — нет значения', () => {
    expect(parse({ name: '  Анна  ', comment: '   ' }).data).toEqual({
      name: 'Анна',
      comment: undefined,
      email: undefined,
      consent: true,
    })
  })

  it('обязательное из одних пробелов — «Заполните поле»', () => {
    const result = parse({ name: '   ' })
    expect(result.error?.issues[0]).toMatchObject({ path: ['name'], message: 'Заполните поле' })
  })

  it('неизвестные поля отбрасываются', () => {
    const result = parse({ name: 'Анна', admin: 'true', [HONEYPOT_FIELD]: '' })
    expect(result.data).not.toHaveProperty('admin')
    expect(result.data).not.toHaveProperty(HONEYPOT_FIELD)
  })

  it('без согласия заявка не проходит', () => {
    const result = leadValuesSchema(fields).safeParse({ name: 'Анна' })
    expect(result.error?.issues[0]).toMatchObject({
      path: [CONSENT_FIELD],
      message: 'Нужно согласие на обработку персональных данных',
    })
  })

  it.each(['no', '0', 'false', '', '   ', 'on', 'true', ' yes ', 'YES', 'yes\n'])(
    'согласие — только значение флажка: %j — согласия нет',
    (consent) => {
      const result = leadValuesSchema(fields).safeParse({ name: 'Анна', consent })
      expect(result.success).toBe(false)
      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: [CONSENT_FIELD],
          message: 'Нужно согласие на обработку персональных данных',
        }),
      ])
    },
  )

  it('согласие значением флажка — true', () => {
    expect(parse({ name: 'Анна' }).data?.[CONSENT_FIELD]).toBe(true)
  })
})

describe('блок «Форма»', () => {
  const valid = form.example

  it('пример проходит схему и получает значения по умолчанию', () => {
    const props = form.props.parse(valid)
    expect(props.submitLabel).toBe('Отправить заявку')
    expect(props.fields[0]).toMatchObject({ name: 'name', required: true })
  })

  it('без ссылки на политику не проходит', () => {
    const { policyUrl: _, ...rest } = valid
    expect(form.props.safeParse(rest).success).toBe(false)
    expect(form.props.safeParse({ ...valid, policyUrl: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('ключи полей уникальны, служебные заняты', () => {
    const twice = { ...valid, fields: [valid.fields[0], valid.fields[0]] }
    const result = form.props.safeParse(twice)
    expect(result.error?.issues[0]?.path).toEqual(['fields', 1, 'name'])
    for (const name of [HONEYPOT_FIELD, CONSENT_FIELD, 'Name', '1a', 'имя']) {
      const fields = [{ name, type: 'text', label: 'Поле' }]
      expect(form.props.safeParse({ ...valid, fields }).success, name).toBe(false)
    }
  })

  it('варианты — только у выбора из списка, и у него они обязательны', () => {
    const select = { name: 'service', type: 'select', label: 'Услуга' }
    expect(form.props.safeParse({ ...valid, fields: [select] }).success).toBe(false)
    const withOptions = { ...select, options: [{ label: 'Ремонт' }] }
    expect(form.props.safeParse({ ...valid, fields: [withOptions] }).success).toBe(true)
    const textWithOptions = { ...withOptions, type: 'text' }
    expect(form.props.safeParse({ ...valid, fields: [textWithOptions] }).success).toBe(false)
    const repeated = { ...select, options: [{ label: 'А' }, { label: 'А' }] }
    expect(form.props.safeParse({ ...valid, fields: [repeated] }).success).toBe(false)
  })

  it.each(['\n', '\r', '\r\n', '\u0000', '\t', '\u007f', '\u0085', '\u2028', '\u2029'])(
    'вариант выбора с %j не проходит блок — сервер такое значение не примет',
    (char) => {
      const option = { label: `Ремонт${char}ванной` }
      const select = { name: 'service', type: 'select', label: 'Услуга', options: [option] }
      const result = form.props.safeParse({ ...valid, fields: [select] })
      expect(result.error?.issues[0]).toMatchObject({
        path: ['fields', 0, 'options', 0, 'label'],
        message: 'Без переводов строки и управляющих символов',
      })
      // И правда не примет: значение выбора проверяется как одна строка
      const definition = field({ type: 'select', options: [option] })
      expect(serverAccepts(definition, option.label)).toBe(false)
    },
  )
})

describe('настройки заявок', () => {
  it('адреса проверяются схемой почты и приводятся к строчным', () => {
    expect(
      LeadSettings.parse({
        recipients: ['Manager@Example.ru'],
        retentionDays: 180,
        confirmToVisitor: true,
      }).recipients,
    ).toEqual(['manager@example.ru'])
    const bad = { recipients: ['a@b.ru\nBcc: x@y.ru'], retentionDays: 180, confirmToVisitor: true }
    expect(LeadSettings.safeParse(bad).success).toBe(false)
  })

  it('срок — от 7 дней до 5 лет', () => {
    const base = { recipients: [], confirmToVisitor: false }
    expect(LeadSettings.safeParse({ ...base, retentionDays: 6 }).success).toBe(false)
    expect(LeadSettings.safeParse({ ...base, retentionDays: 1826 }).success).toBe(false)
    expect(LeadSettings.safeParse({ ...base, retentionDays: 30 }).success).toBe(true)
  })
})
