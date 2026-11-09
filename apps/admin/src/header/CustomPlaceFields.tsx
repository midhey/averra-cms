import {
  type CustomBlockDraft,
  type CustomPlace,
  customBlockProps,
  parsedExample,
} from '@averra/schema'
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { z } from 'zod'
import type { JsonSchema } from '../forms/json-schema'
import { SchemaForm, type Widgets } from '../forms/SchemaForm'
import { Select } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { Section } from '../ui/Screen'
import styles from './CustomPlaceFields.module.scss'

type Place = 'header' | 'footer'

const words: Record<Place, { standard: string; subject: string; own: string; fallback: string }> = {
  header: {
    standard: 'Стандартная',
    subject: 'шапки',
    own: 'Своя шапка',
    fallback: 'стандартная шапка',
  },
  footer: {
    standard: 'Стандартный',
    subject: 'подвала',
    own: 'Свой подвал',
    fallback: 'стандартный подвал',
  },
}

/** Значение выбора «стандартный вид» в списке: у своих видов — их ключ */
const STANDARD = ''

/**
 * Свой вид шапки или подвала: выбор (стандартный или свой блок с этим местом) — владелец, поля
 * своего вида (подпись, слоган) — администратор сайта, как тексты стандартных. Меню, кнопка и
 * логотип остаются в своих вкладках и разделах: свой вид получает их данными
 */
export function CustomPlaceFields({
  place,
  value,
  definitions,
  errors,
  widgets,
  readOnly,
  lookReadOnly,
  canDefine,
  onChange,
}: {
  place: Place
  value: CustomPlace | null
  /** Определения своих блоков с этим местом: опубликованные (владельцу — и черновики) */
  definitions: readonly CustomBlockDraft[]
  /** Ошибки по путям от шапки или подвала: custom.key, custom.props.tagline */
  errors: Readonly<Record<string, string | undefined>>
  widgets: Widgets
  readOnly: boolean
  lookReadOnly: boolean
  /** Владелец: ссылка на «Свои блоки», где делают свой вид */
  canDefine: boolean
  onChange: (next: CustomPlace | null) => void
}) {
  const word = words[place]
  const definition = value ? definitions.find((one) => one.key === value.key) : undefined
  const schema = useMemo(
    () =>
      definition
        ? (z.toJSONSchema(customBlockProps(definition.fields), { io: 'input' }) as JsonSchema)
        : undefined,
    [definition],
  )
  // Тексты, которые не подходят под поля вида (определение поменяли после выбора): на сайте тогда
  // стандартный вид — говорим об этом над формой и у самого поля, а не только в предпросмотре
  const propsIssues = useMemo(
    () =>
      value && definition
        ? (customBlockProps(definition.fields).safeParse(value.props).error?.issues ?? [])
        : [],
    [value, definition],
  )
  // Пути ошибок полей — от формы своего вида, без «custom.props.»
  const fieldErrors = Object.fromEntries([
    ...propsIssues.map((issue) => [issue.path.join('.'), issue.message]),
    ...Object.entries(errors).flatMap(([path, message]) =>
      path.startsWith('custom.props.') && message
        ? [[path.slice('custom.props.'.length), message]]
        : [],
    ),
  ])
  const choose = (key: string) => {
    if (key === STANDARD) return onChange(null)
    const chosen = definitions.find((one) => one.key === key)
    // Поля нового вида — с его примера: подпись не пустая, и форма сразу проходит схему
    onChange({ key, props: chosen ? (parsedExample(chosen) ?? {}) : {} })
  }
  if (definitions.length === 0 && value === null) {
    return canDefine && !lookReadOnly ? (
      <p className={styles.note}>
        Свой вид {word.subject} — свой блок с местом «{place === 'header' ? 'Шапка' : 'Подвал'}{' '}
        сайта»: его делают в разделе <Link to="/blocks">«Свои блоки»</Link>.
      </p>
    ) : null
  }
  return (
    <Section
      title={`Вид ${word.subject}`}
      description={`${word.standard} — настройки ниже; ${word.own.toLowerCase()} — свой блок из раздела «Свои блоки»`}
      card
    >
      <Select
        label={`Вид ${word.subject}`}
        hideLabel
        name="custom.key"
        value={value?.key ?? STANDARD}
        disabled={lookReadOnly}
        error={errors['custom.key']}
        onChange={(event) => choose(event.target.value)}
      >
        <option value={STANDARD}>{word.standard}</option>
        {definitions.map((one) => (
          <option key={one.key} value={one.key}>
            {word.own}: {one.title}
          </option>
        ))}
        {value && !definition && <option value={value.key}>{value.key} — нет на сайте</option>}
      </Select>
      {value && definition && (
        <p className={styles.note}>
          {definition.description}. Свой вид получает меню, кнопку и логотип шапки данными: их
          правят на вкладках «Меню» и «Шапка».
          {place === 'footer' &&
            ' Ссылки на политику, согласие и «Настройки cookie», которых нет в шаблоне, Averra допишет строкой ниже.'}
        </p>
      )}
      {value && !definition && (
        <InlineAlert tone="warning">
          Свой вид «{value.key}» удалили или ещё не опубликовали: на сайте будет стандартный вид.
          Выберите другой.
        </InlineAlert>
      )}
      {propsIssues.length > 0 && (
        <InlineAlert tone="warning">
          Тексты не подходят под поля своего вида (
          {propsIssues
            .map((issue) => `${issue.path.join('.') || 'поля'}: ${issue.message}`)
            .join('; ')}
          ): на сайте {word.fallback}, пока их не поправят ниже и не опубликуют.
        </InlineAlert>
      )}
      {lookReadOnly && !readOnly && (
        <InlineAlert tone="info">
          Вид {word.subject} выбирает владелец установки. Тексты своего вида вы меняете сами.
        </InlineAlert>
      )}
      {value && definition && schema && (
        <fieldset className={styles.fields} disabled={readOnly}>
          <legend className={styles.legend}>Тексты своего вида</legend>
          <SchemaForm
            schema={schema}
            value={value.props}
            errors={fieldErrors}
            widgets={widgets}
            onChange={(props) => onChange({ key: value.key, props })}
          />
        </fieldset>
      )}
    </Section>
  )
}
