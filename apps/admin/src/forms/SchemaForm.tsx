import { useId } from 'react'
import { emptyValue, fieldKind, type JsonSchema } from './json-schema'
import { getIn, type Path, pathKey, setIn } from './path'
import styles from './SchemaForm.module.css'

type Errors = Readonly<Record<string, string>>

type FieldProps = {
  schema: JsonSchema
  value: unknown
  path: Path
  label: string
  required: boolean
  errors: Errors
  onChange: (path: Path, value: unknown) => void
}

type SchemaFormProps = {
  schema: JsonSchema
  value: Record<string, unknown>
  /** Ошибки по путям внутри value: 'button.href', 'items.0.title' */
  errors: Errors
  onChange: (value: Record<string, unknown>) => void
}

/** Форма по JSON Schema: поля, подписи и ограничения берутся из той же схемы, что проверяет API */
export function SchemaForm({ schema, value, errors, onChange }: SchemaFormProps) {
  const change = (path: Path, next: unknown) =>
    onChange(setIn(value, path, next) as Record<string, unknown>)
  return <Fields schema={schema} value={value} path={[]} errors={errors} onChange={change} />
}

function Fields({ schema, value, path, errors, onChange }: Omit<FieldProps, 'label' | 'required'>) {
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

function ObjectField({ schema, value, path, label, required, errors, onChange }: FieldProps) {
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
      {present && (
        <Fields schema={schema} value={value} path={path} errors={errors} onChange={onChange} />
      )}
    </fieldset>
  )
}

function ListField({ schema, value, path, label, errors, onChange }: FieldProps) {
  const items: unknown[] = Array.isArray(value) ? value : []
  const itemSchema = schema.items ?? {}
  const error = errors[pathKey(path)]
  const canAdd = schema.maxItems === undefined || items.length < schema.maxItems
  const canRemove = items.length > (schema.minItems ?? 0)

  const moveItem = (from: number, to: number) => {
    const next = [...items]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(path, next)
  }

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      {items.map((item, index) => (
        // У пунктов нет id. Поля управляемые, поэтому ключ по индексу не путает значения
        <div key={index} className={styles.item}>
          <div className={styles.itemBar}>
            <span>№ {index + 1}</span>
            <button
              type="button"
              aria-label="Поднять пункт"
              disabled={index === 0}
              onClick={() => moveItem(index, index - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Опустить пункт"
              disabled={index === items.length - 1}
              onClick={() => moveItem(index, index + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Удалить пункт"
              disabled={!canRemove}
              onClick={() => onChange(path, items.toSpliced(index, 1))}
            >
              ✕
            </button>
          </div>
          <Fields
            schema={itemSchema}
            value={item}
            path={[...path, index]}
            errors={errors}
            onChange={onChange}
          />
        </div>
      ))}
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
