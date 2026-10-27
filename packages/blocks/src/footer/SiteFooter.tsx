import {
  CHECKED_VALUE,
  CONSENT_FIELD,
  FOOTER_FORM_ID,
  footerFormFields,
  formFieldInput,
  HONEYPOT_FIELD,
} from '@averra/schema'
import type { FormEvent } from 'react'
import { sentAnchor } from '../form/Form'
import styles from './SiteFooter.module.css'
import type { FooterCallbackView, SiteFooterView } from './view'

// Без адреса приёма (предпросмотр в админке) форма не отправляется — как у блока «Форма»
const preventSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault()

/** Id частей формы подвала: «~» не бывает в id блока, с формами страницы они не совпадут */
const fieldId = (name: string) => `${FOOTER_FORM_ID}-${name}`

/**
 * Подвал сайта (концепт Footers): простой — строка с реквизитами и документами, с колонками — о
 * компании, разделы, контакты и соцсети, большой — ещё и форма «Перезвоните мне». Без JS: ссылки
 * и обычная HTML-форма. Нижняя строка с политикой и «Настройками cookie» — в любом виде; кнопку
 * cookie показывает скрипт уведомления (consent-dom.ts по data-consent-open), без JS её нет.
 * Цвета — только роли темы через --footer-* (палитра footerPalette в схеме)
 */
export function SiteFooter({
  view,
  preview = false,
}: {
  view: SiteFooterView
  /**
   * Предпросмотр в админке: «Настройки cookie» видны сразу, как на сайте со скриптом. На сайте
   * кнопка скрыта, пока её не покажет скрипт: без JS она ничего не открыла бы
   */
  preview?: boolean
}) {
  const { layout, callback } = view
  return (
    <footer
      className={styles.footer}
      data-site-footer=""
      data-layout={layout}
      data-tone={view.tone}
    >
      <div className={styles.inner}>
        {layout !== 'simple' && (
          <div className={styles.top}>
            {callback && <Callback callback={callback} />}
            <div className={styles.columns}>
              {layout === 'columns' && (
                <div className={styles.column}>
                  <p className={styles.brand}>{view.siteName}</p>
                  {view.about && <p className={styles.muted}>{view.about}</p>}
                </div>
              )}
              {view.sections.length > 0 && (
                <nav className={styles.column} aria-label="Разделы сайта">
                  <h2 className={styles.heading}>Разделы</h2>
                  {/* biome-ignore lint/a11y/noRedundantRoles: Safari без маркеров списка теряет роль list */}
                  <ul role="list" className={styles.list}>
                    {view.sections.map((item, index) => (
                      // Пункты без id; список рендерится статично, ключ по индексу безопасен
                      <li key={index}>
                        <a
                          className={styles.link}
                          href={item.href}
                          aria-current={item.current ? 'page' : undefined}
                        >
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
              <Contacts view={view} />
              {layout === 'columns' && <Socials view={view} />}
            </div>
          </div>
        )}
        <div className={styles.bottom}>
          <p className={styles.legalText}>{[view.copyright, ...view.requisites].join(' · ')}</p>
          <LegalLinks view={view} preview={preview} />
        </div>
      </div>
    </footer>
  )
}

/** Контакты из «Организации». В большом подвале под ними и соцсети — колонок там две */
function Contacts({ view }: { view: SiteFooterView }) {
  const socials = view.layout === 'big' && view.socials.length > 0
  if (!view.phone && !view.email && !view.address && !socials) return null
  return (
    <div className={styles.column}>
      <h2 className={styles.heading}>Контакты</h2>
      <address className={styles.contacts}>
        {view.phone && (
          <a className={styles.phone} href={view.phone.href}>
            {view.phone.text}
          </a>
        )}
        {view.email && (
          <a className={styles.email} href={view.email.href}>
            {view.email.text}
          </a>
        )}
        {view.address && <span className={styles.muted}>{view.address}</span>}
      </address>
      {socials && <SocialList view={view} />}
    </div>
  )
}

function Socials({ view }: { view: SiteFooterView }) {
  if (view.socials.length === 0) return null
  return (
    <div className={styles.column}>
      <h2 className={styles.heading}>Мы в соцсетях</h2>
      <SocialList view={view} />
    </div>
  )
}

/**
 * Значки соцсетей: видна короткая подпись (VK, TG), диктор слышит и её, и название сети — так
 * имя ссылки содержит то, что видно (WCAG 2.5.3)
 */
function SocialList({ view }: { view: SiteFooterView }) {
  return (
    // biome-ignore lint/a11y/noRedundantRoles: Safari без маркеров списка теряет роль list
    <ul role="list" className={styles.socials} aria-label="Соцсети">
      {view.socials.map((social) => (
        <li key={social.href}>
          <a className={styles.social} href={social.href}>
            <span aria-hidden="true">{social.short}</span>
            <span className={styles.visuallyHidden}>
              {social.short} — {social.label}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/** Политика и «Настройки cookie» — та же разметка, что у прежней полосы LegalFooter */
function LegalLinks({ view, preview }: { view: SiteFooterView; preview: boolean }) {
  const { policyHref, cookieSettings } = view.legal
  if (!policyHref && !cookieSettings) return null
  return (
    <div className={styles.legalLinks}>
      {policyHref && (
        <a href={policyHref} className={styles.legalLink}>
          Политика конфиденциальности
        </a>
      )}
      {cookieSettings && (
        <button
          type="button"
          className={styles.legalButton}
          data-consent-open=""
          aria-haspopup="dialog"
          hidden={!preview}
        >
          Настройки cookie
        </button>
      )}
    </div>
  )
}

/**
 * «Перезвоните мне» — обычная HTML-форма в API, как блок «Форма»: телефон, согласие со ссылкой
 * на политику и ловушка для ботов. После приёма API возвращает на эту страницу с якорем
 * #~footer-sent: CSS по :target показывает текст успеха и прячет форму
 */
function Callback({ callback }: { callback: FooterCallbackView }) {
  const titleId = fieldId('title')
  return (
    <section className={styles.callback} id={FOOTER_FORM_ID} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.callbackTitle}>
        {callback.title}
      </h2>
      {callback.text && <p className={styles.muted}>{callback.text}</p>}
      <p id={sentAnchor(FOOTER_FORM_ID)} className={styles.sent} role="status" tabIndex={-1}>
        {callback.successText}
      </p>
      <form
        className={styles.form}
        method="post"
        action={callback.action}
        acceptCharset="UTF-8"
        aria-labelledby={titleId}
        onSubmit={callback.action === undefined ? preventSubmit : undefined}
      >
        <div className={styles.formRow}>
          {footerFormFields.map((field) => {
            const input = formFieldInput(field)
            if (input.element !== 'input') return null
            return (
              <div key={field.name} className={styles.field}>
                <label htmlFor={fieldId(field.name)} className={styles.label}>
                  {field.label}
                </label>
                <input
                  id={fieldId(field.name)}
                  className={styles.input}
                  type={input.type}
                  name={input.name}
                  required={input.required}
                  maxLength={input.maxLength}
                  pattern={input.pattern}
                  autoComplete={input.autoComplete}
                  inputMode={input.inputMode}
                />
              </div>
            )
          })}
          <button type="submit" className={styles.submit}>
            {callback.button}
          </button>
        </div>
        {/* Ловушка для ботов: человек её не видит и не заполняет */}
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
            {callback.consentText}{' '}
            <a href={callback.policyHref} className={styles.inlineLink}>
              (политика конфиденциальности)
            </a>
          </label>
        </div>
      </form>
    </section>
  )
}
