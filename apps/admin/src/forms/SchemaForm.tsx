import { type ComponentType, type ReactNode, useId, useMemo } from 'react'
import { DragHandle, SortableList, useSortableItem } from '../ui/SortableList'
import { moveItem } from '../ui/sortable'
import { useItemKeys } from './item-keys'
import { emptyValue, fieldKind, type JsonSchema } from './json-schema'
import { getIn, type Path, pathKey, setIn } from './path'
import styles from './SchemaForm.module.css'

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

/** Форма по JSON Schema: поля, подписи и ограничения берутся из той же схемы, что проверяет API */
export function SchemaForm({ schema, value, errors, onChange, widgets = {} }: SchemaFormProps) {
  const change = (path: Path, next: unknown) =>
    onChange(setIn(value, path, next) as Record<string, unknown>)
  return (
    <Fields
      schema={schema}
      value={value}
      path={[]}
      errors={errors}
      onChange={change}
      widgets={widgets}
    />
  )
}

function Fields(props: Omit<FieldProps, 'label' | 'required'>) {
  const { schema, value, path, errors, onChange, widgets } = props
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties ?? {}).map(([key, child]) => (
    <Field
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

function Field(props: FieldProps) {
  switch (fieldKind(props.schema)) {
    case 'text':
      return <TextField {...props} />
    case 'textarea':
      return <TextField {...props} multiline />
    case 'select':
      return <SelectField {...props} />
    case 'object':
      return <ObjectField {...props} />
    case 'list':
      return <ListField {...props} />
    case 'image': {
      const Image = props.widgets.image
      if (Image) return <Image {...props} />
      return <p className={styles.hint}>Поле «{props.label}» пока не редактируется в админке</p>
    }
    default:
      return <p className={styles.hint}>Поле «{props.label}» пока не редактируется в админке</p>
  }
}

function TextField(props: FieldProps & { multiline?: boolean }) {
  const { schema, value, path, label, required, errors, onChange, multiline = false } = props
  const id = useId()
  const text = typeof value === 'string' ? value : ''
  const error = errors[pathKey(path)]
  // Пустое необязательное поле убираем совсем, а не храним пустую строку
  const update = (next: string) => onChange(path, next === '' && !required ? undefined : next)
  const common = {
    id,
    value: text,
    className: styles.input,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': `${id}-hint`,
  }
  // Счётчик символов полезен для коротких текстов, у ссылок он только мешает
  const counter = schema.maxLength !== undefined && schema.maxLength <= 300

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {!required && <span className={styles.optional}> · необязательно</span>}
      </label>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(event) => update(event.target.value)} />
      ) : (
        <input {...common} type="text" onChange={(event) => update(event.target.value)} />
      )}
      <div id={`${id}-hint`} className={styles.hint}>
        <span className={error ? styles.error : undefined}>{error ?? schema.description}</span>
        {counter && (
          <span>
            {text.length}/{schema.maxLength}
          </span>
        )}
      </div>
    </div>
  )
}

function SelectField({ schema, value, path, label, onChange }: FieldProps) {
  const id = useId()
  const options = schema.enum ?? []
  const current = value ?? schema.default ?? options[0]
  const pick = (raw: string) =>
    onChange(
      path,
      options.find((option) => String(option) === raw),
    )

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <select
        id={id}
        className={styles.input}
        value={String(current)}
        onChange={(event) => pick(event.target.value)}
      >
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    </div>
  )
}

function ObjectField(props: FieldProps) {
  const { schema, value, path, label, required, onChange } = props
  const id = useId()
  const present = value !== undefined
  const toggle = (on: boolean) => onChange(path, on ? emptyValue(schema) : undefined)

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      {!required && (
        <label htmlFor={id} className={styles.toggle}>
          <input
            id={id}
            type="checkbox"
            checked={present}
            onChange={(event) => toggle(event.target.checked)}
          />
          Показывать
        </label>
      )}
      {present && <Fields {...props} />}
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
        {items.map((item, index) => (
          <ListItem
            key={keys[index]}
            id={keys[index] ?? String(index)}
            index={index}
            count={items.length}
            canRemove={canRemove}
            onMove={move}
            onRemove={remove}
          >
            <Fields
              schema={itemSchema}
              value={item}
              path={[...path, index]}
              errors={errors}
              onChange={onChange}
              widgets={widgets}
            />
          </ListItem>
        ))}
      </SortableList>
      {error && <p className={styles.error}>{error}</p>}
      <button
        type="button"
        className={styles.add}
        disabled={!canAdd}
        onClick={() => onChange(path, [...items, emptyValue(itemSchema)])}
      >
        + Добавить пункт
      </button>
    </fieldset>
  )
}

type ListItemProps = {
  id: string
  index: number
  count: number
  canRemove: boolean
  onMove: (from: number, to: number) => void
  onRemove: (index: number) => void
  children: ReactNode
}

function ListItem({ id, index, count, canRemove, onMove, onRemove, children }: ListItemProps) {
  const sortable = useSortableItem(id, 'пункт')
  return (
    <div
      ref={sortable.ref}
      style={sortable.style}
      className={styles.item}
      data-dragging={sortable.dragging}
    >
      <div className={styles.itemBar}>
        <DragHandle handle={sortable.handle} label="Перетащить пункт" />
        <span>№ {index + 1}</span>
        <button
          type="button"
          aria-label="Поднять пункт"
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Опустить пункт"
          disabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
        >
          ↓
        </button>
        <button
          type="button"
          aria-label="Удалить пункт"
          disabled={!canRemove}
          onClick={() => onRemove(index)}
        >
          ✕
        </button>
      </div>
      {children}
    </div>
  )
}

/** Имя пункта для диктора: его заголовок, если он есть, иначе номер */
function itemLabel(item: unknown, index: number) {
  const title =
    typeof item === 'object' && item !== null ? (item as Record<string, unknown>).title : undefined
  return typeof title === 'string' && title.trim() !== '' ? title : `№ ${index + 1}`
}
