import { z } from 'zod'
import { hasHeaderBreak, MAIL_ADDRESS_PATTERN, MailAddress } from './mail'

// Формы на сайте. Одна схема поля — два потребителя: компонент блока берёт из неё HTML-атрибуты
// проверки в браузере (formFieldInput), а API — схему заявки (leadValuesSchema). Правила для
// обоих лежат в одной таблице fieldRules, поэтому браузер и сервер не разойдутся

/** Типы полей формы: закрытый список, своих типов блок не придумывает */
export const formFieldTypes = [
  'name',
  'phone',
  'email',
  'text',
  'textarea',
  'select',
  'checkbox',
] as const
export const FormFieldType = z.enum(formFieldTypes)
export type FormFieldType = z.infer<typeof FormFieldType>

/** Подписи типов для админки (x-enum-titles) и для людей */
export const formFieldTypeTitles: Record<FormFieldType, string> = {
  name: 'Имя',
  phone: 'Телефон',
  email: 'Почта',
  text: 'Строка текста',
  textarea: 'Многострочный текст',
  select: 'Выбор из списка',
  checkbox: 'Флажок',
}

/** Сколько полей бывает у формы. От него же считается предел тела заявки в API */
export const FORM_MAX_FIELDS = 12

/** Скрытое поле-ловушка: человек его не видит и не заполняет, бот заполняет */
export const HONEYPOT_FIELD = 'website'
/** Флажок согласия на обработку персональных данных */
export const CONSENT_FIELD = 'consent'
/** Значение, которое шлёт отмеченный флажок формы */
export const CHECKED_VALUE = 'yes'

const RESERVED_NAMES: ReadonlySet<string> = new Set([HONEYPOT_FIELD, CONSENT_FIELD])

/**
 * Телефон: цифры, плюс, пробелы, скобки и дефис, не меньше 5 цифр. Строка для атрибута pattern:
 * браузер проверяет его как ^(?:…)$ с флагом v, поэтому все знаки в классе экранированы
 */
export const PHONE_PATTERN = String.raw`(?=(?:[^\d]*\d){5})[\d\+\(\)\- ]+`

/**
 * Почта — тот же шаблон, что у MailAddress на сервере (почта посетителя станет Reply-To).
 * Браузер для type="email" пропускает и адрес без точки в домене (a@b), и a..b@…, а pattern
 * отклоняет их ещё в браузере, а не страницей ошибки после отправки
 */
export const EMAIL_PATTERN = MAIL_ADDRESS_PATTERN

/**
 * Обязательное однострочное поле — не из одних пробелов. required в браузере пропускает «   »,
 * а сервер обрезает пробелы и считает поле пустым. Ставится полям без своего шаблона
 * (у телефона и почты шаблон и так требует не пробелы). У textarea атрибута pattern нет
 */
export const NOT_BLANK_PATTERN = String.raw`.*\S.*`

/** Регулярное выражение из pattern — так же, как его собирает браузер */
export const patternRegExp = (pattern: string) => new RegExp(`^(?:${pattern})$`, 'v')

type InputType = 'text' | 'tel' | 'email'

type FieldRule = {
  /** Предел длины: maxlength в браузере и max в схеме сервера */
  max: number
  /** Тип input и подсказки браузеру. Нет — не input (многострочное, список, флажок) */
  input?: { type: InputType; autoComplete?: string; inputMode?: 'tel' | 'email' }
  pattern?: { source: string; message: string }
}

/** Правила по типам: единственное место, где записаны пределы и шаблоны полей */
export const fieldRules: Record<FormFieldType, FieldRule> = {
  name: { max: 100, input: { type: 'text', autoComplete: 'name' } },
  phone: {
    max: 30,
    input: { type: 'tel', autoComplete: 'tel', inputMode: 'tel' },
    pattern: {
      source: PHONE_PATTERN,
      message: 'Телефон: цифры, +, пробелы, скобки и дефис, не меньше 5 цифр',
    },
  },
  email: {
    max: 254,
    input: { type: 'email', autoComplete: 'email', inputMode: 'email' },
    pattern: { source: EMAIL_PATTERN, message: 'Нужен адрес почты, например anna@example.ru' },
  },
  text: { max: 200, input: { type: 'text' } },
  textarea: { max: 2000 },
  select: { max: 80 },
  checkbox: { max: 0 },
}

/** Ключ поля: по нему поле узнаётся в заявке. Служебные имена заняты */
export const FormFieldName = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,31}$/,
    'Ключ поля: латиница в нижнем регистре, цифры и _, начинается с буквы, до 32 символов',
  )
  .refine(
    (name) => !RESERVED_NAMES.has(name),
    `Ключи ${HONEYPOT_FIELD} и ${CONSENT_FIELD} заняты служебными полями формы`,
  )

const BREAK_MESSAGE = 'Без переводов строки и управляющих символов'

/**
 * Вариант выбора — одна строка, как и значение, которое сервер примет: вариант с переводом
 * строки форма опубликовала бы, а заявку с ним сервер отклонял бы всегда
 */
const FieldOption = z.strictObject({
  label: z
    .string()
    .refine((value) => !hasHeaderBreak(value), BREAK_MESSAGE)
    .trim()
    .min(1)
    .max(fieldRules.select.max)
    .meta({ title: 'Вариант' }),
})

export const FormField = z
  .strictObject({
    name: FormFieldName.meta({
      title: 'Ключ поля',
      description: 'Латиница, цифры и _: name, phone, comment. По нему поле узнаётся в заявках',
    }),
    type: FormFieldType.meta({ title: 'Тип поля', 'x-enum-titles': formFieldTypeTitles }),
    label: z.string().trim().min(1).max(80).meta({ title: 'Подпись' }),
    required: z.boolean().default(false).meta({ title: 'Обязательное' }),
    hint: z.string().trim().max(200).optional().meta({ title: 'Подсказка' }),
    options: z
      .array(FieldOption)
      .min(1)
      .max(20)
      .optional()
      .meta({ title: 'Варианты', description: 'Только для выбора из списка' }),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'select' && !field.options) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'У выбора из списка нужны варианты',
      })
    }
    if (field.type !== 'select' && field.options) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Варианты бывают только у выбора из списка: уберите их или смените тип',
      })
    }
    const labels = field.options?.map((option) => option.label) ?? []
    if (new Set(labels).size !== labels.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Варианты повторяются' })
    }
  })
export type FormField = z.infer<typeof FormField>

/** HTML-атрибуты поля в браузере. Собраны из fieldRules — тех же, что проверяет сервер */
export type FormFieldInput =
  | {
      element: 'input'
      name: string
      required: boolean
      type: InputType
      maxLength: number
      pattern?: string
      autoComplete?: string
      inputMode?: 'tel' | 'email'
    }
  | { element: 'textarea'; name: string; required: boolean; maxLength: number }
  | { element: 'select'; name: string; required: boolean; options: string[] }
  | { element: 'checkbox'; name: string; required: boolean; value: typeof CHECKED_VALUE }

export function formFieldInput(
  field: Pick<FormField, 'name' | 'type' | 'required' | 'options'>,
): FormFieldInput {
  const { name, required, type } = field
  const rule = fieldRules[type]
  if (type === 'textarea') return { element: 'textarea', name, required, maxLength: rule.max }
  if (type === 'select') {
    return {
      element: 'select',
      name,
      required,
      options: (field.options ?? []).map((option) => option.label),
    }
  }
  if (type === 'checkbox') return { element: 'checkbox', name, required, value: CHECKED_VALUE }
  const input = rule.input ?? { type: 'text' }
  const pattern = rule.pattern?.source ?? (required ? NOT_BLANK_PATTERN : undefined)
  return {
    element: 'input',
    name,
    required,
    type: input.type,
    maxLength: rule.max,
    ...(pattern ? { pattern } : {}),
    ...(input.autoComplete ? { autoComplete: input.autoComplete } : {}),
    ...(input.inputMode ? { inputMode: input.inputMode } : {}),
  }
}

const REQUIRED_MESSAGE = 'Заполните поле'
const CONTROL_MESSAGE = 'Без управляющих символов'

/**
 * Управляющие символы, кроме перевода строки и табуляции. В многострочном поле их не бывает
 * от человека, а NUL Postgres не примет в jsonb — вместо 400 была бы ошибка сервера
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ищем именно управляющие символы
const MULTILINE_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/

/** Пустое или из одних пробелов — значит, не заполнено */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

const requiredString = () =>
  z.string({
    error: (issue) => (issue.input === undefined ? REQUIRED_MESSAGE : 'Нужен текст'),
  })

/**
 * Однострочное значение: перевод строки — ошибка, а не тихая чистка. Такие поля идут в письмо,
 * а почта — ещё и в заголовок Reply-To (header injection)
 */
const singleLine = (max: number) =>
  requiredString()
    .refine((value) => !hasHeaderBreak(value), BREAK_MESSAGE)
    .trim()
    .max(max)

function valueSchema(field: FormField): z.ZodType {
  const rule = fieldRules[field.type]
  switch (field.type) {
    case 'email':
      // Шаблон — как в браузере, а потом та же схема, что у заголовков письма: значение
      // может стать Reply-To
      return singleLine(rule.max)
        .regex(patternRegExp(EMAIL_PATTERN), 'Нужен адрес почты, например anna@example.ru')
        .pipe(MailAddress)
    case 'textarea':
      // Браузер шлёт перевод строки как \r\n, а maxlength считает его одним символом
      return requiredString()
        .transform((value) => value.replace(/\r\n?/g, '\n'))
        .pipe(
          z
            .string()
            .refine((value) => !MULTILINE_CONTROL.test(value), CONTROL_MESSAGE)
            .trim()
            .max(rule.max),
        )
    case 'select': {
      const options = (field.options ?? []).map((option) => option.label)
      return singleLine(rule.max).refine(
        (value) => options.includes(value),
        'Выберите вариант из списка',
      )
    }
    case 'checkbox':
      return checkboxValue()
    default: {
      const line = singleLine(rule.max)
      if (!rule.pattern) return line
      return line.regex(patternRegExp(rule.pattern.source), rule.pattern.message)
    }
  }
}

const CONSENT_MESSAGE = 'Нужно согласие на обработку персональных данных'
const CHECKBOX_MESSAGE = 'Неверное значение флажка: отметьте его в форме или снимите отметку'

/**
 * Флажок: отмеченный браузер шлёт ровно CHECKED_VALUE, неотмеченный не шлёт вовсе. Пусто — тоже
 * не отмечен. Любое другое значение (no, 0, false, on) — ошибка, а не догадка: в заявку попадает
 * только то, что можно было отправить из формы
 */
const checkboxValue = () =>
  z.preprocess(
    blankToUndefined,
    z
      .union([z.undefined(), z.literal(CHECKED_VALUE)], { error: CHECKBOX_MESSAGE })
      .transform((value) => value === CHECKED_VALUE),
  )

function fieldSchema(field: FormField): z.ZodType {
  if (field.type === 'checkbox') {
    const checked = checkboxValue()
    return field.required
      ? checked.refine((value) => value, 'Отметьте, чтобы отправить форму')
      : checked
  }
  const value = valueSchema(field)
  return z.preprocess(blankToUndefined, field.required ? value : value.optional())
}

/** Значение поля в заявке: строка, флажок или ничего (необязательное, не заполнено) */
export type LeadValue = string | boolean | undefined

/**
 * Схема присланной формы для сервера: поля блока и согласие. Неизвестные поля отбрасываются
 * (z.object, а не strictObject): в заявку попадает только то, что объявила форма
 */
export function leadValuesSchema(fields: readonly FormField[]) {
  const shape: Record<string, z.ZodType> = {}
  for (const field of fields) shape[field.name] = fieldSchema(field)
  // Согласие по 152-ФЗ — явное: только значение отмеченного флажка. Не прислано, пусто
  // или что угодно другое (no, 0, false) — согласия нет, и запись «согласие дано» была бы неправдой
  shape[CONSENT_FIELD] = z
    .literal(CHECKED_VALUE, { error: CONSENT_MESSAGE })
    .transform((): true => true)
  return z.object(shape) as z.ZodType<Record<string, LeadValue>>
}

/** Срок хранения заявок сайта в днях: по умолчанию полгода */
export const LEAD_RETENTION_DAYS = { min: 7, max: 1825, default: 180 } as const

/** Настройки заявок сайта: куда слать уведомления, сколько хранить, подтверждать ли посетителю */
export const LeadSettings = z.strictObject({
  // Пусто — всем владельцам админки
  recipients: z
    .array(MailAddress.transform((address) => address.toLowerCase()))
    .max(10)
    .refine((list) => new Set(list).size === list.length, 'Адреса повторяются'),
  retentionDays: z.int().min(LEAD_RETENTION_DAYS.min).max(LEAD_RETENTION_DAYS.max),
  confirmToVisitor: z.boolean(),
})
export type LeadSettings = z.infer<typeof LeadSettings>

/** Заявка новая или обработана */
export const LeadStatus = z.enum(['new', 'processed'])
export type LeadStatus = z.infer<typeof LeadStatus>

export const UpdateLead = z.strictObject({ status: LeadStatus })
