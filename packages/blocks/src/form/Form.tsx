import {
  CHECKED_VALUE,
  CONSENT_FIELD,
  type FormField,
  formFieldInput,
  HONEYPOT_FIELD,
} from '@averra/schema'
import type { FormEvent, ReactElement } from 'react'
import type { BlockComponentProps } from '../types'
import { Section } from '../ui/Section'
import styles from './Form.module.css'

/** Id элемента с текстом успеха: на него API возвращает браузер после приёма заявки (#…-sent) */
export const sentAnchor = (blockId: string) => `${blockId}-sent`

// Без адреса приёма (предпросмотр в админке) форма не отправляется: там это React в iframe
// админки, и обработчик работает. На собранном сайте адрес есть всегда, а JS не нужен
const preventSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault()

/**
 * Форма заявки без JavaScript: обычная HTML-форма method="post" в API. Атрибуты проверки
 * в браузере — из той же схемы полей, по которой API проверяет заявку (formFieldInput).
 * После приёма API отвечает 303 на эту страницу с якорем #<id>-sent: CSS по :target
 * показывает текст успеха и прячет форму
 */
export function Form({ id, data, headingLevel, formAction }: BlockComponentProps<'form'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const action = formAction?.(id)
  const fieldId = (name: string) => `${id}-${name}`
  return (
    <Section id={id}>
      <div className={styles.box}>
        <Heading className={styles.title}>{data.title}</Heading>
        {data.text && <p className={styles.text}>{data.text}</p>}
        <p id={sentAnchor(id)} className={styles.sent} role="status" tabIndex={-1}>
          {data.successText}
        </p>
        <form
          className={styles.form}
          method="post"
          action={action}
          acceptCharset="UTF-8"
          aria-label={data.title}
          onSubmit={action === undefined ? preventSubmit : undefined}
        >
          {data.fields.map((field) => (
            <Field key={field.name} field={field} id={fieldId(field.name)} />
          ))}
          {/* Ловушка для ботов: человек её не видит и не заполняет. Заполнена — API ответит
              как при успехе, но заявку не сохранит */}
          <div className={styles.trap} aria-hidden="true">
            <label htmlFor={fieldId(HONEYPOT_FIELD)}>Оставьте это поле пустым</label>
            <input
              id={fieldId(HONEYPOT_FIELD)}
              type="text"
              name={HONEYPOT_FIELD}
              tabIndex={-1}
              autoComplete="off"
            />
          </div>
          <div className={styles.consent}>
            <input
              id={fieldId(CONSENT_FIELD)}
              type="checkbox"
              name={CONSENT_FIELD}
              value={CHECKED_VALUE}
              required
            />
            <label htmlFor={fieldId(CONSENT_FIELD)}>
              {data.consentText}{' '}
              {data.consentUrl ? (
                <>
                  (
                  <a href={data.consentUrl} className={styles.link}>
                    текст согласия
                  </a>
                  ,{' '}
                  <a href={data.policyUrl} className={styles.link}>
                    политика конфиденциальности
                  </a>
                  )
                </>
              ) : (
                <a href={data.policyUrl} className={styles.link}>
                  (политика конфиденциальности)
                </a>
              )}
            </label>
          </div>
          <button type="submit" className={styles.submit}>
            {data.submitLabel}
          </button>
        </form>
      </div>
    </Section>
  )
}

function Field({ field, id }: { field: FormField; id: string }) {
  const input = formFieldInput(field)
  const hintId = `${id}-hint`
  const describedBy = field.hint ? hintId : undefined
  const hint = field.hint && (
    <span id={hintId} className={styles.hint}>
      {field.hint}
    </span>
  )
  const mark = field.required && (
    <span className={styles.required} aria-hidden="true">
      {' '}
      *
    </span>
  )

  if (input.element === 'checkbox') {
    return (
      <div className={styles.check}>
        <input
          id={id}
          type="checkbox"
          name={input.name}
          value={input.value}
          required={input.required}
          aria-describedby={describedBy}
        />
        <label htmlFor={id}>
          {field.label}
          {mark}
        </label>
        {hint}
      </div>
    )
  }

  let control: ReactElement
  if (input.element === 'textarea') {
    control = (
      <textarea
        id={id}
        name={input.name}
        required={input.required}
        maxLength={input.maxLength}
        rows={4}
        className={styles.input}
        aria-describedby={describedBy}
      />
    )
  } else if (input.element === 'select') {
    control = (
      <select
        id={id}
        name={input.name}
        required={input.required}
        defaultValue=""
        className={styles.input}
        aria-describedby={describedBy}
      >
        <option value="">Выберите…</option>
        {input.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  } else {
    control = (
      <input
        id={id}
        type={input.type}
        name={input.name}
        required={input.required}
        maxLength={input.maxLength}
        pattern={input.pattern}
        autoComplete={input.autoComplete}
        inputMode={input.inputMode}
        className={styles.input}
        aria-describedby={describedBy}
      />
    )
  }
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {field.label}
        {mark}
      </label>
      {control}
      {hint}
    </div>
  )
}
