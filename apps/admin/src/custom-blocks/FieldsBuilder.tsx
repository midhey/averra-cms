import {
  CONTAINER_FIELD_TYPES,
  CUSTOM_BLOCK_LIMITS,
  CUSTOM_FIELD_TYPES,
  type CustomFieldInput,
  type CustomFieldType,
} from '@averra/schema'
import { useRef, useState } from 'react'
import type { FieldErrors } from '../forms/field-errors'
import { Button, IconButton } from '../ui/Button'
import { Checkbox, Select, TextInput } from '../ui/Field'
import { moveItem } from '../ui/sortable'
import { useMoveButtons } from '../ui/use-move-buttons'
import { changeFieldType, fieldTypesAt, newField, numberOf } from './custom-block-format'
import styles from './FieldsBuilder.module.scss'

type Field = CustomFieldInput
/** Поле как запись: настройки зависят от вида, а меняются одинаково */
type FieldRecord = Record<string, unknown>

type BuilderProps = {
  fields: readonly Field[]
  onChange: (fields: Field[]) => void
  /** Ошибки структуры: путь от определения (fields.0.name) → текст */
  errors: FieldErrors
  /** Путь этого уровня: fields, fields.2.fields */
  path: string
  /** Уровень: 1 — поля блока. На последнем повторителя и группы нет */
  depth?: number
  /** Полей во всём блоке: на вложенных уровнях его считает корень */
  total?: number
  disabled?: boolean
}

/** Полей во всём блоке, с вложенными: предел общий, а не только на уровень */
const countFields = (fields: readonly Field[]): number =>
  fields.reduce(
    (sum, field) => sum + 1 + ('fields' in field ? countFields(field.fields as Field[]) : 0),
    0,
  )

let lastKey = 0

/**
 * Постоянные ключи карточек полей. У поля нет id, а объект меняется с каждой буквой подписи,
 * поэтому ключи хранятся рядом и переставляются вместе с полями: карточка (и кнопка «Опустить»
 * в фокусе) уезжает вместе со своим полем. Список сменили не здесь (возврат версии) — длина
 * подгоняется, ключи остаются по местам
 */
function useFieldKeys(length: number) {
  const keys = useRef<number[]>([])
  if (keys.current.length > length) keys.current = keys.current.slice(0, length)
  while (keys.current.length < length) keys.current = [...keys.current, ++lastKey]
  return {
    keys: keys.current,
    move: (from: number, to: number) => {
      keys.current = [...moveItem(keys.current, from, to)]
    },
    remove: (index: number) => {
      keys.current = keys.current.toSpliced(index, 1)
    },
  }
}

/**
 * Конструктор полей своего блока, как в ACF: поле — карточка с видом, подписью, ключом и
 * настройками вида; у повторителя и группы — свои поля внутри. Порядок — стрелками: они
 * доступны с клавиатуры и диктору. Ошибки — у настройки, в которой они
 */
export function FieldsBuilder({
  fields,
  onChange,
  errors,
  path,
  depth = 1,
  total,
  disabled,
}: BuilderProps) {
  const all = total ?? countFields(fields)
  const atLevel = fields.length >= CUSTOM_BLOCK_LIMITS.fieldsPerLevel
  const full = atLevel || all >= CUSTOM_BLOCK_LIMITS.fields
  const keys = useFieldKeys(fields.length)
  const update = (index: number, field: Field) => onChange(fields.with(index, field))
  const move = (from: number, to: number) => {
    keys.move(from, to)
    onChange([...moveItem(fields, from, to)])
  }
  const remove = (index: number) => {
    keys.remove(index)
    onChange(fields.toSpliced(index, 1))
  }
  return (
    <div className={styles.builder}>
      {errors[path] && <p className={styles.error}>{errors[path]}</p>}
      {fields.length > 0 && (
        <ol className={styles.list}>
          {fields.map((field, index) => (
            <FieldCard
              key={keys.keys[index]}
              field={field}
              index={index}
              count={fields.length}
              path={`${path}.${index}`}
              depth={depth}
              total={all}
              errors={errors}
              disabled={disabled}
              onChange={(next) => update(index, next)}
              onMove={move}
              onRemove={() => remove(index)}
            />
          ))}
        </ol>
      )}
      {!disabled && (
        <Button
          size="small"
          icon="plus"
          aria-disabled={full ? true : undefined}
          onClick={() => {
            if (!full) onChange([...fields, newField('text', fields)])
          }}
        >
          {depth === 1 ? 'Добавить поле' : 'Добавить поле внутрь'}
        </Button>
      )}
      {!disabled && full && (
        <p className={styles.limit}>
          {atLevel
            ? `На одном уровне не больше ${CUSTOM_BLOCK_LIMITS.fieldsPerLevel} полей`
            : `Во всём блоке не больше ${CUSTOM_BLOCK_LIMITS.fields} полей`}
        </p>
      )}
    </div>
  )
}

type CardProps = {
  field: Field
  index: number
  count: number
  path: string
  depth: number
  total: number
  errors: FieldErrors
  disabled: boolean | undefined
  onChange: (field: Field) => void
  onMove: (from: number, to: number) => void
  onRemove: () => void
}

function FieldCard({
  field,
  index,
  count,
  path,
  depth,
  total,
  errors,
  disabled,
  onChange,
  onMove,
  onRemove,
}: CardProps) {
  const arrows = useMoveButtons(index, count, onMove)
  const record = field as FieldRecord
  const error = (key: string) => errors[`${path}.${key}`]
  const set = (key: string, value: unknown) => {
    const next: FieldRecord = { ...record }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange(next as Field)
  }
  const name = field.label.trim() || field.name
  const container = CONTAINER_FIELD_TYPES.has(field.type)

  // Заголовки карточек по уровню: поля блока — h3 (под «Поля» экрана), вложенные — глубже
  const Heading = depth === 1 ? 'h3' : depth === 2 ? 'h4' : 'h5'
  return (
    <li className={styles.card}>
      <div className={styles.head}>
        <Heading className={styles.title}>
          <span className={styles.number}>{index + 1}.</span> {name}
          <span className={styles.kind}> · {CUSTOM_FIELD_TYPES[field.type]}</span>
        </Heading>
        {!disabled && (
          <span className={styles.actions}>
            <IconButton
              label={`Поднять поле «${name}»`}
              icon="arrow-up"
              size="small"
              {...arrows.up}
            />
            <IconButton
              label={`Опустить поле «${name}»`}
              icon="arrow-down"
              size="small"
              {...arrows.down}
            />
            <IconButton
              label={`Удалить поле «${name}»`}
              icon="trash"
              size="small"
              onClick={() => {
                if (window.confirm(`Удалить поле «${name}»?`)) onRemove()
              }}
            />
          </span>
        )}
      </div>
      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend className="visually-hidden">Настройки поля «{name}»</legend>
        <div className={styles.grid}>
          <Select
            label="Вид"
            value={field.type}
            error={error('type')}
            onChange={(event) => {
              const type = fieldTypesAt(depth).find((item) => item === event.target.value)
              if (type) onChange(changeFieldType(field, type))
            }}
          >
            {fieldTypesAt(depth).map((type) => (
              <option key={type} value={type}>
                {CUSTOM_FIELD_TYPES[type]}
              </option>
            ))}
          </Select>
          <TextInput
            label="Подпись"
            value={field.label}
            maxChars={80}
            error={error('label')}
            onChange={(event) => set('label', event.target.value)}
          />
          <TextInput
            label="Ключ"
            hint={`В шаблоне: {{ ${field.name || 'ключ'} }}`}
            mono
            value={field.name}
            error={error('name')}
            onChange={(event) => set('name', event.target.value)}
          />
          <TextInput
            label="Подсказка"
            hint="Под полем в редакторе страницы"
            value={field.hint ?? ''}
            error={error('hint')}
            onChange={(event) => set('hint', event.target.value || undefined)}
          />
        </div>
        {field.type !== 'boolean' && field.type !== 'select' && (
          <Checkbox
            label="Обязательное"
            checked={field.required === true}
            onChange={(event) => set('required', event.target.checked)}
          />
        )}
        <TypeSettings field={field} record={record} set={set} error={error} />
        {container && 'fields' in field && (
          <div className={styles.nested}>
            <p className={styles.nestedTitle}>
              {field.type === 'repeater' ? 'Поля пункта' : 'Поля группы'}
            </p>
            <FieldsBuilder
              fields={field.fields}
              onChange={(fields) => set('fields', fields)}
              errors={errors}
              path={`${path}.fields`}
              depth={depth + 1}
              total={total}
              disabled={disabled}
            />
          </div>
        )}
      </fieldset>
    </li>
  )
}

type SettingsProps = {
  field: Field
  record: FieldRecord
  set: (key: string, value: unknown) => void
  error: (key: string) => string | undefined
}

/**
 * Числовая настройка поля. Набранный текст хранится здесь: промежуточное «-» или «0,» ещё не
 * число, и если сразу превращать его в число, минус и дробь набрать нельзя
 */
function NumberSetting({
  label,
  hint,
  value,
  error,
  onChange,
}: {
  label: string
  hint?: string | undefined
  value: unknown
  error: string | undefined
  onChange: (value: number | undefined) => void
}) {
  const [text, setText] = useState(() => (typeof value === 'number' ? String(value) : ''))
  // Значение сменили не здесь (другое поле, возврат версии) — показываем его
  const shown =
    typeof value === 'number'
      ? numberOf(text) === value
        ? text
        : String(value)
      : numberOf(text) === undefined
        ? text
        : ''
  return (
    <TextInput
      label={label}
      hint={hint}
      inputMode="decimal"
      value={shown}
      error={error}
      onChange={(event) => {
        setText(event.target.value)
        onChange(numberOf(event.target.value))
      }}
    />
  )
}

/** Настройки, которые зависят от вида поля: длина, пределы, варианты, умолчание */
function TypeSettings({ field, record, set, error }: SettingsProps) {
  const numberInput = (key: string, label: string, hint?: string) => (
    <NumberSetting
      label={label}
      hint={hint}
      value={record[key]}
      error={error(key)}
      onChange={(next) => set(key, next)}
    />
  )
  switch (field.type as CustomFieldType) {
    case 'text':
    case 'textarea':
      return (
        <div className={styles.grid}>
          {numberInput('minLength', 'Не короче, знаков')}
          {numberInput('maxLength', 'Не длиннее, знаков')}
          <TextInput
            label="По умолчанию"
            hint="Пустое поле на сайте покажет его"
            value={typeof record.default === 'string' ? record.default : ''}
            error={error('default')}
            onChange={(event) => set('default', event.target.value || undefined)}
          />
        </div>
      )
    case 'number':
      return (
        <div className={styles.grid}>
          {numberInput('min', 'Не меньше')}
          {numberInput('max', 'Не больше')}
          {numberInput('default', 'По умолчанию')}
          <Checkbox
            label="Только целое"
            checked={record.integer === true}
            onChange={(event) => set('integer', event.target.checked)}
          />
        </div>
      )
    case 'boolean':
      return (
        <Checkbox
          label="Включено по умолчанию"
          checked={record.default === true}
          onChange={(event) => set('default', event.target.checked)}
        />
      )
    case 'select':
      return <SelectOptions record={record} set={set} error={error} />
    case 'repeater':
      return (
        <div className={styles.grid}>
          {numberInput('min', 'Пунктов не меньше')}
          {numberInput('max', 'Пунктов не больше', `До ${CUSTOM_BLOCK_LIMITS.repeaterItems}`)}
        </div>
      )
    default:
      return null
  }
}

type Option = { value: string; label: string }

/** Варианты выбора: значение (для шаблона) и подпись (для людей), умолчание — из них */
function SelectOptions({ record, set, error }: Omit<SettingsProps, 'field'>) {
  const options = Array.isArray(record.options) ? (record.options as Option[]) : []
  const change = (index: number, key: keyof Option, value: string) =>
    set('options', options.with(index, { ...(options[index] as Option), [key]: value }))
  return (
    <div className={styles.options}>
      <p className={styles.nestedTitle}>Варианты</p>
      {error('options') && <p className={styles.error}>{error('options')}</p>}
      <ol className={styles.optionList}>
        {options.map((option, index) => (
          <li key={index} className={styles.option}>
            <TextInput
              label={`Значение ${index + 1}`}
              mono
              value={option.value}
              error={error(`options.${index}.value`)}
              onChange={(event) => change(index, 'value', event.target.value)}
            />
            <TextInput
              label={`Подпись ${index + 1}`}
              value={option.label}
              error={error(`options.${index}.label`)}
              onChange={(event) => change(index, 'label', event.target.value)}
            />
            <IconButton
              label={`Удалить вариант ${index + 1}`}
              icon="trash"
              size="small"
              aria-disabled={options.length <= 2 ? true : undefined}
              onClick={() => {
                if (options.length > 2) set('options', options.toSpliced(index, 1))
              }}
            />
          </li>
        ))}
      </ol>
      <Button
        size="small"
        icon="plus"
        aria-disabled={options.length >= CUSTOM_BLOCK_LIMITS.options ? true : undefined}
        onClick={() => {
          if (options.length < CUSTOM_BLOCK_LIMITS.options) {
            set('options', [
              ...options,
              { value: `option-${options.length + 1}`, label: 'Вариант' },
            ])
          }
        }}
      >
        Добавить вариант
      </Button>
      <Select
        label="По умолчанию"
        value={typeof record.default === 'string' ? record.default : ''}
        error={error('default')}
        onChange={(event) => set('default', event.target.value || undefined)}
      >
        <option value="">Первый вариант</option>
        {options.map((option, index) => (
          <option key={index} value={option.value}>
            {option.label || option.value}
          </option>
        ))}
      </Select>
    </div>
  )
}
