import type { MediaMap } from '@averra/schema'
import { Brand } from './Brand'
import { NewTabNote, tabProps } from './new-tab'
import styles from './SiteHeader.module.css'
import {
  CONTENT_ID,
  headerMenuRow,
  headerRowButton,
  headerWatchesScroll,
  type SiteHeaderLink,
  type SiteHeaderView,
} from './view'

type SiteHeaderProps = {
  view: SiteHeaderView
  /** Картинки сайта: логотип берёт из справочника адреса вариантов */
  media: MediaMap
}

/**
 * Шапка сайта (концепт Headers): логотип или название, меню, телефон и кнопка. Работает без JS:
 * на широком экране меню — строкой, на телефоне — в <details>, липкость — position: sticky.
 * Скрипт (header-dom.ts) только улучшает: собирает шапку при прокрутке, фиксирует прозрачную
 * как только страницу прокрутили, закрывает меню по Esc. Цвета — только переменные темы. Вид
 * (форма и наведение кнопки, пункты, меню телефона) — data-атрибуты по настройкам шапки
 */
export function SiteHeader({ view, media }: SiteHeaderProps) {
  const { layout, menu, button, phone, look } = view
  const hasPanel = menu.length > 0
  const topbar = layout === 'double' && (view.address !== '' || phone !== null)
  // Кнопка на телефоне в строке шапки — в меню её второй раз нет
  const buttonInPanel = button !== null && look.mobileButton === 'menu'
  return (
    <>
      <a className={styles.skip} href={`#${CONTENT_ID}`}>
        К содержимому
      </a>
      {headerWatchesScroll(view) && (
        <>
          <div className={styles.sentinel} data-header-sentinel="far" aria-hidden="true" />
          <div className={styles.sentinelTop} data-header-sentinel="top" aria-hidden="true" />
        </>
      )}
      <header
        className={styles.header}
        data-site-header=""
        data-layout={layout}
        data-sticky={view.sticky ? '' : undefined}
        data-condense={view.condense ? '' : undefined}
        data-overlay={view.overlay ? '' : undefined}
        data-panel={hasPanel ? '' : undefined}
        data-short={view.short ? '' : undefined}
        // Без меню кнопке на телефоне место — своей строкой под логотипом (промо-шапка «Минимум»)
        data-row-button={headerRowButton(view) ? '' : undefined}
        // Длинное меню на широком экране — своей строкой под логотипом (headerMenuRow)
        data-menu-row={headerMenuRow(view) ? '' : undefined}
        data-line={look.divider ? undefined : 'none'}
        data-button-shape={look.buttonShape === 'theme' ? undefined : look.buttonShape}
        data-button-hover={look.buttonHover === 'shade' ? undefined : look.buttonHover}
        data-link-hover={look.linkHover === 'underline' ? undefined : look.linkHover}
        data-mobile-button={
          hasPanel && button !== null && look.mobileButton === 'row' ? 'row' : undefined
        }
        data-mobile-menu={look.mobileMenu === 'panel' ? undefined : look.mobileMenu}
        data-mobile-align={look.mobileAlign === 'start' ? undefined : look.mobileAlign}
      >
        {topbar && (
          <div className={styles.topbar}>
            <div className={styles.topbarInner}>
              <span>{view.address}</span>
              {phone && (
                <a className={styles.topbarPhone} href={phone.href}>
                  {phone.text}
                </a>
              )}
            </div>
          </div>
        )}
        <div className={styles.row}>
          <a className={styles.brand} href="/">
            <Brand brand={view.brand} siteName={view.siteName} media={media} size="header" />
          </a>
          {view.short && (
            // Служебная страница: вместо меню и кнопки — дорога на главную
            <a className={styles.back} href="/">
              <span aria-hidden="true">←</span> На главную
            </a>
          )}
          {hasPanel && <MenuList items={menu} className={styles.nav} />}
          {!view.short && (
            <div className={styles.actions}>
              {phone && (
                // В двухэтажной шапке телефон — в верхней строке, здесь он появляется, только когда
                // шапка собралась и верхней строки нет
                <a
                  className={styles.phone}
                  href={phone.href}
                  data-in-topbar={topbar ? '' : undefined}
                >
                  <PhoneIcon />
                  <span className={styles.phoneText}>{phone.text}</span>
                </a>
              )}
              {button && (
                <a className={styles.button} href={button.href} {...tabProps(button)}>
                  <ButtonLabel label={button.label} mobileLabel={button.mobileLabel} />
                  <NewTabNote link={button} className={styles.visuallyHidden} />
                </a>
              )}
              {hasPanel && (
                <details className={styles.menu} data-header-menu="">
                  <summary className={styles.summary}>
                    <BurgerIcon />
                    <span className={styles.summaryText}>Меню</span>
                  </summary>
                  <div className={styles.panel}>
                    <MenuList items={menu} className={styles.panelNav} mobile />
                    {(buttonInPanel || phone || view.address) && (
                      <div className={styles.panelActions}>
                        {button && buttonInPanel && (
                          <a
                            className={styles.panelButton}
                            href={button.href}
                            {...tabProps(button)}
                          >
                            {button.mobileLabel || button.label}
                            <NewTabNote link={button} className={styles.visuallyHidden} />
                          </a>
                        )}
                        {phone && (
                          <a className={styles.panelPhone} href={phone.href}>
                            {phone.text}
                          </a>
                        )}
                        {/* Адрес — как в концепте телефона, под номером */}
                        {view.address && <p className={styles.panelAddress}>{view.address}</p>}
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </header>
    </>
  )
}

/**
 * Текст кнопки: на узком экране — подпись для телефона, если она есть. Обе в разметке, видна и
 * слышна одна: другая скрыта display: none
 */
function ButtonLabel({ label, mobileLabel }: { label: string; mobileLabel: string }) {
  if (mobileLabel === '' || mobileLabel === label) return <>{label}</>
  return (
    <>
      <span className={styles.labelWide}>{label}</span>
      <span className={styles.labelNarrow}>{mobileLabel}</span>
    </>
  )
}

/**
 * Меню: на широком экране — строкой в шапке, на телефоне — в раскрытом <details> (mobile:
 * подписи для телефона). Два списка в разметке, но виден и слышен всегда один: другой скрыт
 * display: none
 */
function MenuList({
  items,
  className,
  mobile = false,
}: {
  items: readonly SiteHeaderLink[]
  className: string | undefined
  mobile?: boolean
}) {
  return (
    <nav aria-label="Меню сайта" className={className}>
      {/* biome-ignore lint/a11y/noRedundantRoles: Safari без маркеров списка теряет роль list */}
      <ul role="list" className={styles.list}>
        {items.map((item, index) => (
          // Пункты без id; список рендерится статично, ключ по индексу безопасен
          <li key={index}>
            <a
              className={styles.link}
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              {...tabProps(item)}
            >
              {mobile && item.mobileLabel ? item.mobileLabel : item.label}
              <NewTabNote link={item} className={styles.visuallyHidden} />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function PhoneIcon() {
  return (
    <svg
      className={styles.icon}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 3h3l1.5 4-2 1.2a9 9 0 0 0 5.3 5.3L13 11.5l4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A14 14 0 0 1 2.5 4.6 1.5 1.5 0 0 1 4 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Три полосы; открытое меню — крестик (CSS по details[open]) */
function BurgerIcon() {
  return (
    <svg
      className={styles.icon}
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden="true"
    >
      <path
        className={styles.burgerLines}
        d="M4 7h14M4 11h14M4 15h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        className={styles.burgerClose}
        d="M6 6l10 10M16 6L6 16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
