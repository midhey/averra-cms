import { type ComponentType, type ReactNode, useId, useMemo, useState } from 'react'
import { Button, IconButton } from '../ui/Button'
import { Checkbox, Select, TextArea, TextInput } from '../ui/Field'
import { LayoutThumbnail, SegmentedControl } from '../ui/SegmentedControl'
import { DragHandle, SortableList, useSortableItem } from '../ui/SortableList'
import { moveItem } from '../ui/sortable'
import { useMoveButtons } from '../ui/use-move-buttons'
import { useItemKeys } from './item-keys'
import {
  emptyValue,
  enumAppearance,
  enumLabel,
  fieldKind,
  isMonospace,
  type JsonSchema,
} from './json-schema'
import { getIn, type Path, pathKey, setIn } from './path'
import styles from './SchemaForm.module.scss'

type Errors = Readonly<Record<string, string>>

/** Что получает поле формы, в том числе свой виджет (например, выбор картинки) */
export type FieldProps = {
  schema: JsonSchema
  value: unknown
  path: Path
  label: string
  required: boolean
  errors: Errors
  onChange: (path: Path, value: unknown) => void
  widgets: Widgets
}

/**
 * Виджеты для полей с пометкой x-widget. Форма общая и не знает ни про медиатеку, ни про сайт:
 * виджет приходит в неё явно от того, кто знает (редактор)
 */
export type Widgets = { image?: ComponentType<FieldProps> }

type SchemaFormProps = {
  schema: JsonSchema
  value: Record<string, unknown>
  /** Ошибки по путям внутри value: 'button.href', 'items.0.title' */
  errors: Errors
  onChange: (value: Record<string, unknown>) => void
  widgets?: Widgets
}

/** Счётчик символов полезен для коротких текстов, у длинных и у ссылок он только мешает */
const COUNTER_MAX_LENGTH = 300

/** Форма по JSON Schema: поля, подписи и ограничения берутся из той же схемы, что проверяет API */
export function SchemaForm({ schema, value, errors, onChange, widgets = {} }: SchemaFormProps) {
  const change = (path: Path, next: unknown) =>
    onChange(setIn(value, path, next) as Record<string, unknown>)
  return (
    <div className={styles.form}>
      <Fields
        schema={schema}
        value={value}
        path={[]}
        errors={errors}
        onChange={change}
        widgets={widgets}
      />
    </div>
  )
}

function Fields(props: Omit<FieldProps, 'label' | 'required'>) {
  const { schema, value, path, errors, onChange, widgets } = props
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties ?? {}).map(([key, child]) => (
    <SchemaField
      key={key}
      schema={child}
      value={getIn(value, [key])}
      path={[...path, key]}
      label={child.title ?? key}
      required={required.has(key)}
      errors={errors}
      onChange={onChange}
      widgets={widgets}
    />
  ))
}

function SchemaField(props: FieldProps) {
  switch (fieldKind(props.schema)) {
    case 'text':
      return <TextField {...props} />
    case 'textarea':
      return <TextField {...props} multiline />
    case 'select':
      return <EnumField {...props} />
    case 'checkbox':
      return <CheckboxField {...props} />
    case 'number':
      return <NumberField {...props} />
    case 'object':
      return <ObjectField {...props} />
    case 'list':
      return <ListField {...props} />
    case 'image': {
      const Image = props.widgets.image
      if (Image) return <Image {...props} />
      return <Unsupported label={props.label} />
    }
    default:
      return <Unsupported label={props.label} />
  }
}

function Unsupported({ label }: { label: string }) {
  return <p className={styles.note}>Поле «{label}» пока не редактируется в админке</p>
}

/** Подпись поля: у необязательного — пометка, чтобы не гадать, можно ли оставить пустым */
function FieldLabel({ label, required }: { label: string; required: boolean }) {
  return (
    <>
      {label}
      {!required && <span className={styles.optional}> · необязательно</span>}
    </>
  )
}

function TextField(props: FieldProps & { multiline?: boolean }) {
  const { schema, value, path, label, required, errors, onChange, multiline = false } = props
  const text = typeof value === 'string' ? value : ''
  // Пустое необязательное поле убираем совсем, а не храним пустую строку
  const update = (next: string) => onChange(path, next === '' && !required ? undefined : next)
  const mono = isMonospace(schema)
  const input = schema['x-input']
  const common = {
    label: <FieldLabel label={label} required={required} />,
    hint: schema.description,
    error: errors[pathKey(path)],
    value: text,
    // Значение по умолчанию — подсказкой: пустое поле на сайте покажет именно его
    placeholder: typeof schema.default === 'string' ? schema.default : undefined,
    // Почте и телефону счётчик ни к чему: длина у них не та забота, что у заголовка
    maxChars:
      !mono && !input && schema.maxLength !== undefined && schema.maxLength <= COUNTER_MAX_LENGTH
        ? schema.maxLength
        : undefined,
    mono,
  }
  return multiline ? (
    <TextArea {...common} rows={3} onChange={(event) => update(event.target.value)} />
  ) : (
    <TextInput
      {...common}
      type={input ?? 'text'}
      inputMode={input}
      onChange={(event) => update(event.target.value)}
    />
  )
}

/**
 * Число (поля своих блоков): обычное поле с цифровой клавиатурой. Текст поля — свой: пока человек
 * пишет «1,» или «-», значение не теряется. Не число — уходит строкой, и схема скажет, что не так
 */
function NumberField({ schema, value, path, label, required, errors, onChange }: FieldProps) {
  const [text, setText] = useState(() => (typeof value === 'number' ? String(value) : ''))
  // Значение сменили не здесь (вернули версию, другой блок) — поле показывает его
  const shown =
    typeof value === 'number' && Number(text.replace(',', '.')) !== value ? String(value) : text
  const integer = schema.type === 'integer'
  const range =
    schema.minimum !== undefined || schema.maximum !== undefined
      ? `от ${schema.minimum ?? '−∞'} до ${schema.maximum ?? '∞'}`
      : undefined
  return (
    <TextInput
      label={<FieldLabel label={label} required={required} />}
      hint={[schema.description, range].filter(Boolean).join('. ') || undefined}
      error={errors[pathKey(path)]}
      value={shown}
      inputMode={integer ? 'numeric' : 'decimal'}
      placeholder={typeof schema.default === 'number' ? String(schema.default) : undefined}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        const trimmed = next.trim()
        const number = Number(trimmed.replace(',', '.'))
        onChange(path, trimmed === '' ? undefined : Number.isFinite(number) ? number : trimmed)
      }}
    />
  )
}

/** Выбор из вариантов: карточки с миниатюрами, сегменты или список — по схеме (enumAppearance) */
function EnumField({ schema, value, path, label, errors, onChange }: FieldProps) {
  const options = schema.enum ?? []
  const current = value ?? schema.default ?? options[0]
  const pick = (raw: string) =>
    onChange(
      path,
      options.find((option) => String(option) === raw),
    )
  const error = errors[pathKey(path)]
  const appearance = enumAppearance(schema)
  const errorId = useId()

  if (appearance === 'select') {
    return (
      <Select
        label={label}
        hint={schema.description}
        error={error}
        value={String(current)}
        onChange={(event) => pick(event.target.value)}
      >
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {enumLabel(schema, option)}
          </option>
        ))}
      </Select>
    )
  }

  const sketches = schema['x-enum-sketches']
  return (
    <div className={styles.choice}>
      <SegmentedControl
        legend={label}
        appearance={appearance}
        name={pathKey(path)}
        options={options.map((option) => {
          const sketch = sketches?.[String(option)]
          return {
            value: String(option),
            label: enumLabel(schema, option),
            ...(appearance === 'cards' &&
              sketch && { thumbnail: <LayoutThumbnail sketch={sketch} /> }),
          }
        })}
        value={String(current)}
        onChange={pick}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Да или нет: флажок с подписью. Значение по умолчанию — из схемы. Ошибка — у флажка: «выделить
 * можно один тариф» встаёт у второго выделенного
 */
function CheckboxField({ schema, value, path, label, errors, onChange }: FieldProps) {
  const checked = typeof value === 'boolean' ? value : schema.default === true
  return (
    <Checkbox
      label={label}
      hint={schema.description}
      error={errors[pathKey(path)]}
      checked={checked}
      onChange={(event) => onChange(path, event.target.checked)}
    />
  )
}

/** Все поля объекта однострочные (текст кнопки и ссылка) — их можно поставить в ряд */
const fitsInRow = (schema: JsonSchema) => {
  const children = Object.values(schema.properties ?? {})
  return children.length === 2 && children.every((child) => fieldKind(child) === 'text')
}

function ObjectField(props: FieldProps) {
  const { schema, value, path, label, required, onChange } = props
  const present = value !== undefined
  const toggle = (on: boolean) => onChange(path, on ? emptyValue(schema) : undefined)

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      {!required && (
        <Checkbox
          label="Показывать"
          checked={present}
          onChange={(event) => toggle(event.target.checked)}
        />
      )}
      {present && (
        <div className={fitsInRow(schema) ? styles.row : styles.stack}>
          <Fields {...props} />
        </div>
      )}
    </fieldset>
  )
}

function ListField({ schema, value, path, label, errors, onChange, widgets }: FieldProps) {
  const items: unknown[] = Array.isArray(value) ? value : []
  const itemSchema = schema.items ?? {}
  const error = errors[pathKey(path)]
  const canAdd = schema.maxItems === undefined || items.length < schema.maxItems
  const canRemove = items.length > (schema.minItems ?? 0)
  const itemKeys = useItemKeys(items.length)
  const { keys } = itemKeys
  const entries = useMemo(
    () => keys.map((key, index) => ({ id: key, label: itemLabel(items[index], index) })),
    [keys, items],
  )

  const move = (from: number, to: number) => {
    itemKeys.move(from, to)
    onChange(path, moveItem(items, from, to))
  }
  const remove = (index: number) => {
    itemKeys.remove(index)
    onChange(path, items.toSpliced(index, 1))
  }

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      <SortableList entries={entries} noun="пункт" onMove={move}>
        <ol className={styles.items}>
          {items.map((item, index) => (
            <ListItem
              key={keys[index]}
              id={keys[index] ?? String(index)}
              name={entries[index]?.label ?? `№ ${index + 1}`}
              index={index}
              count={items.length}
              canRemove={canRemove}
              onMove={move}
              onRemove={remove}
            >
              {itemSchema.type === 'object' ? (
                <Fields
                  schema={itemSchema}
                  value={item}
                  path={[...path, index]}
                  errors={errors}
                  onChange={onChange}
                  widgets={widgets}
                />
              ) : (
                // Пункт-строка — одно поле: подпись из схемы пункта, пустым его не оставить
                <SchemaField
                  schema={itemSchema}
                  value={item}
                  path={[...path, index]}
                  label={itemSchema.title ?? 'Текст'}
                  required
                  errors={errors}
                  onChange={onChange}
                  widgets={widgets}
                />
              )}
            </ListItem>
          ))}
        </ol>
      </SortableList>
      {error && <p className={styles.error}>{error}</p>}
      <Button
        size="small"
        icon="plus"
        className={styles.add}
        disabled={!canAdd}
        onClick={() => onChange(path, [...items, emptyValue(itemSchema)])}
      >
        Добавить пункт
      </Button>
    </fieldset>
  )
}

type ListItemProps = {
  id: string
  /** Имя пункта для подписи ручки: заголовок или номер */
  name: string
  index: number
  count: number
  canRemove: boolean
  onMove: (from: number, to: number) => void
  onRemove: (index: number) => void
  children: ReactNode
}

/** Пункт списка — карточка: шапка с ручкой, номером и именем, стрелками и удалением, ниже поля */
function ListItem(props: ListItemProps) {
  const { id, name, index, count, canRemove, onMove, onRemove, children } = props
  const sortable = useSortableItem(id)
  const arrows = useMoveButtons(index, count, onMove)
  return (
    <li
      ref={sortable.ref}
      style={sortable.style}
      className={styles.item}
      data-dragging={sortable.dragging}
    >
      <div className={styles.itemBar}>
        <DragHandle handle={sortable.handle} label={`Перетащить пункт «${name}»`} />
        <span className={styles.itemName}>
          <span className={styles.itemNumber}>№ {index + 1}</span>
          {name !== `№ ${index + 1}` && <span className={styles.itemTitle}>{name}</span>}
        </span>
        <span className={styles.itemActions}>
          <IconButton label="Поднять пункт" icon="arrow-up" size="small" {...arrows.up} />
          <IconButton label="Опустить пункт" icon="arrow-down" size="small" {...arrows.down} />
          <IconButton
            label="Удалить пункт"
            icon="trash"
            size="small"
            disabled={!canRemove}
            onClick={() => onRemove(index)}
          />
        </span>
      </div>
      <div className={styles.itemFields}>{children}</div>
    </li>
  )
}

/**
 * Имя пункта для диктора: заголовок, подпись, вопрос, название тарифа или имя, подпись фото,
 * иначе номер
 */
function itemLabel(item: unknown, index: number) {
  if (typeof item === 'string') return item.trim() === '' ? `№ ${index + 1}` : item
  const fields = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
  // Тариф и человек называются name, вопрос — question, фото галереи — caption; у поля формы name —
  // ключ, поэтому подпись раньше
  const name = [fields.title, fields.label, fields.question, fields.name, fields.caption].find(
    (candidate) => typeof candidate === 'string' && candidate.trim() !== '',
  )
  return typeof name === 'string' ? name : `№ ${index + 1}`
}
