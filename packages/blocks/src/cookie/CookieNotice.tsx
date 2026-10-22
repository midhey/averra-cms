import type { CookieLook, CookieMode } from '@averra/schema'
import type { ReactNode } from 'react'
import styles from './CookieNotice.module.css'

export type CookieNoticeProps = {
  mode: CookieMode
  look: CookieLook
  /** Текст уведомления: свой или по умолчанию (cookieNoticeText) */
  text: string
  /** Адрес опубликованной страницы политики; null — ссылки нет */
  policyHref: string | null
  /** Что делает аналитика — строка в окне настроек */
  analyticsDescription: string
  /**
   * Номера счётчиков. В режиме согласия скрипт грузит по ним счётчики после согласия, в обоих
   * режимах — знает, о каких сервисах сказали посетителю: их набор пишется в cookie выбора
   */
  metrika?: string
  ga4?: string
  /**
   * Предпросмотр в админке: уведомление видно сразу, без скрипта. На сайте оно скрыто, пока его
   * не покажет скрипт: без JS посетитель не может выбрать, и уведомление ему только мешало бы
   */
  preview?: boolean
}

const NOTICE_TITLE_ID = 'cookie-consent-title'
const SETTINGS_TITLE_ID = 'cookie-settings-title'

/**
 * Cookie-уведомление сайта: HTML в разметке страницы, оживляет его consent-dom.ts. Три вида —
 * плашка снизу, карточка в углу, окно по центру. Кнопки «Принять все» и «Только необходимые»
 * одинаковые — отказ так же заметен, как согласие (docs: решения → cookie-consent)
 */
export function CookieNotice(props: CookieNoticeProps) {
  const { mode, look, text, policyHref, analyticsDescription, preview = false } = props
  const consent = mode === 'consent'
  const policy = policyHref && (
    <a href={policyHref} className={styles.link}>
      Политика конфиденциальности
    </a>
  )

  const content = (
    <>
      {look === 'bar' && <CookieIcon />}
      <div className={styles.body}>
        <h2 id={NOTICE_TITLE_ID} className={look === 'bar' ? styles.hiddenTitle : styles.title}>
          Cookie на этом сайте
        </h2>
        <p className={styles.text}>
          {text}
          {policy && <> {policy}</>}
        </p>
      </div>
      <div className={styles.actions}>
        {consent ? (
          <>
            <ActionButton action="necessary">Только необходимые</ActionButton>
            <ActionButton action="all">Принять все</ActionButton>
          </>
        ) : (
          <ActionButton action="ok">Понятно</ActionButton>
        )}
      </div>
      {consent && (
        <button
          type="button"
          className={styles.linkButton}
          data-consent-action="settings"
          aria-haspopup="dialog"
        >
          Настроить
        </button>
      )}
    </>
  )

  return (
    <div
      className={styles.root}
      data-cookie-consent=""
      data-mode={mode}
      data-look={look}
      data-metrika={props.metrika || undefined}
      data-ga4={props.ga4 || undefined}
      data-modal-open={preview && look === 'modal' ? '' : undefined}
      hidden={!preview}
    >
      {look === 'modal' ? (
        <dialog
          className={styles.notice}
          data-look={look}
          data-consent-notice=""
          aria-labelledby={NOTICE_TITLE_ID}
          open={preview}
          tabIndex={-1}
        >
          {content}
        </dialog>
      ) : (
        <section
          className={styles.notice}
          data-look={look}
          data-consent-notice=""
          aria-labelledby={NOTICE_TITLE_ID}
          hidden={!preview}
        >
          {content}
        </section>
      )}
      {consent && (
        <dialog
          className={styles.settings}
          data-consent-settings=""
          aria-labelledby={SETTINGS_TITLE_ID}
        >
          <div className={styles.settingsHead}>
            <h2 id={SETTINGS_TITLE_ID} className={styles.settingsTitle}>
              Настройки cookie
            </h2>
            <button
              type="button"
              className={styles.close}
              data-consent-action="close"
              aria-label="Закрыть"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path
                  d="M4 4l10 10M14 4L4 14"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <p className={styles.text}>
            Выберите, какие cookie можно использовать. Изменить выбор можно в любой момент по ссылке
            «Настройки cookie» внизу страницы.
            {policy && <> {policy}</>}
          </p>
          <div className={styles.options}>
            <div className={styles.option}>
              <span className={styles.optionText}>
                <span className={styles.optionTitle}>Необходимые</span>
                <span className={styles.optionHint}>
                  Запоминают ваш выбор в этом окне. Без них сайт спросит снова.
                </span>
              </span>
              <span className={styles.always}>Всегда включены</span>
            </div>
            <label className={styles.option}>
              <span className={styles.optionText}>
                <span className={styles.optionTitle}>Аналитика</span>
                <span className={styles.optionHint}>{analyticsDescription}</span>
              </span>
              {/* biome-ignore lint/a11y/useAriaPropsForRole: у флажка с role="switch" состояние — само checked, aria-checked на нём запрещён (ARIA in HTML) */}
              <input type="checkbox" role="switch" name="analytics" className={styles.switch} />
            </label>
          </div>
          <div className={styles.actions}>
            <ActionButton action="save">Сохранить выбор</ActionButton>
            <ActionButton action="all">Принять все</ActionButton>
          </div>
        </dialog>
      )}
    </div>
  )
}

/** Кнопка уведомления. Все одного вида: ни одна не тянет на себя внимание сильнее другой */
function ActionButton({ action, children }: { action: string; children: ReactNode }) {
  return (
    <button type="button" className={styles.button} data-consent-action={action}>
      {children}
    </button>
  )
}

function CookieIcon() {
  return (
    <svg
      className={styles.icon}
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M24 14.5A10 10 0 1 1 13.5 4a3.5 3.5 0 0 0 4.5 4.5 3.5 3.5 0 0 0 6 6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="13" r="1.4" fill="currentColor" />
      <circle cx="15" cy="18" r="1.4" fill="currentColor" />
      <circle cx="10" cy="19" r="1" fill="currentColor" />
    </svg>
  )
}

export type LegalFooterProps = {
  policyHref: string | null
  /** Ссылка «Настройки cookie»: только в режиме согласия, показывает её скрипт */
  cookieSettings: boolean
}

/**
 * Подвал страницы с документами: ссылка на политику (152-ФЗ: политика опубликована на сайте) и
 * «Настройки cookie», чтобы изменить выбор на любой странице. Без JS кнопка скрыта — без скрипта
 * она ничего не открыла бы. Если, кроме неё, в подвале ничего нет, без JS скрыт весь подвал: иначе
 * внизу страницы осталась бы пустая полоса
 */
export function LegalFooter({ policyHref, cookieSettings }: LegalFooterProps) {
  if (!policyHref && !cookieSettings) return null
  return (
    <footer className={styles.footer} data-legal-footer="" hidden={!policyHref}>
      <div className={styles.footerInner}>
        {policyHref && (
          <a href={policyHref} className={styles.link}>
            Политика конфиденциальности
          </a>
        )}
        {cookieSettings && (
          <button
            type="button"
            className={styles.linkButton}
            data-consent-open=""
            aria-haspopup="dialog"
            hidden
          >
            Настройки cookie
          </button>
        )}
      </div>
    </footer>
  )
}
