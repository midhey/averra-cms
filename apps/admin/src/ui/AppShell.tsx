import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import styles from './AppShell.module.scss'
import { IconButton } from './Button'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

/** С этой ширины панель стоит сбоку, а верхней полосы с кнопкой меню нет: ui.breakpoint(medium) = 64rem */
const WIDE_LAYOUT = '(min-width: 64rem)'

type AppShellProps = {
  /** Знак и название — в боковой панели и в верхней полосе телефона */
  brand?: ReactNode
  /** Содержимое боковой панели: сайт, разделы, установка, кто вошёл */
  sidebar: ReactNode
  /** Экран. Он рисует свой <main> (CONVENTIONS), оболочка — только место под него */
  children: ReactNode
}

/**
 * Раскладка админки из концепта: боковая панель и содержимое. На узком экране панель уходит
 * в меню под верхней полосой: кнопка «Меню» (aria-expanded), Esc закрывает и возвращает фокус
 * на кнопку, переход по ссылке в меню закрывает его и переводит фокус на содержимое. Не знает ни роутера, ни данных
 */
export function AppShell({ brand = <ShellBrand />, sidebar, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const sidebarId = useId()

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButton.current?.focus()
    }
    // Окно расширили до десктопа: меню и кнопки больше нет на экране — закрываем меню, иначе
    // Esc перевёл бы фокус на скрытую кнопку и фокус потерялся бы
    const wide = window.matchMedia?.(WIDE_LAYOUT)
    const onWide = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false)
    }
    if (wide?.matches) setMenuOpen(false)
    wide?.addEventListener('change', onWide)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      wide?.removeEventListener('change', onWide)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  return (
    <div className={styles.shell}>
      {/* Ссылка «Перейти к содержимому» видна только в фокусе (.skip-link из foundation).
          Фокус переводим сами: переход по #якорю роутер принял бы за смену адреса */}
      {/* biome-ignore lint/a11y/useValidAnchor: это ссылка внутри страницы (href есть), обработчик только переводит фокус */}
      <a
        className="skip-link"
        href="#content"
        onClick={(event) => {
          event.preventDefault()
          content.current?.focus()
        }}
      >
        Перейти к содержимому
      </a>
      <div className={styles.topbar}>
        {brand}
        <IconButton
          ref={menuButton}
          label={menuOpen ? 'Закрыть меню' : 'Меню'}
          icon={menuOpen ? 'close' : 'menu'}
          variant="secondary"
          aria-expanded={menuOpen}
          aria-controls={sidebarId}
          onClick={() => setMenuOpen((open) => !open)}
        />
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: клик ловится всплытием от ссылок внутри, сам блок не нажимается */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: ссылки внутри нажимаются и с клавиатуры, Enter тоже даёт click */}
      <div
        id={sidebarId}
        className={cx(styles.sidebar, menuOpen && styles.sidebarOpen)}
        onClick={(event) => {
          if (!(event.target instanceof Element && event.target.closest('a'))) return
          // Ссылка уходит вместе с меню: без этого фокус упал бы на body, и человек
          // с клавиатуры начинал бы с начала страницы. Блок содержимого не пересоздаётся
          // при смене экрана, поэтому фокус на нём переживает переход
          if (menuOpen) content.current?.focus()
          setMenuOpen(false)
        }}
      >
        <div className={styles.sidebarBrand}>{brand}</div>
        {sidebar}
      </div>
      <div id="content" ref={content} tabIndex={-1} className={styles.content}>
        {children}
      </div>
    </div>
  )
}

/** Знак «A» и название */
export function ShellBrand({ name = 'Averra' }: { name?: string }) {
  return (
    <span className={styles.brand}>
      <span className={styles.brandMark} aria-hidden="true">
        {name.slice(0, 1)}
      </span>
      <span className={styles.brandName}>{name}</span>
    </span>
  )
}

type SidebarSectionProps = {
  /** Мелкая подпись над группой: «Установка» */
  title?: string
  /** Прижать к низу панели (установка и кто вошёл) */
  bottom?: boolean
  children: ReactNode
}

export function SidebarSection({ title, bottom, children }: SidebarSectionProps) {
  return (
    <div className={cx(styles.section, bottom && styles.sectionBottom)}>
      {title && <p className={styles.sectionTitle}>{title}</p>}
      {children}
    </div>
  )
}

/** Список ссылок панели под своим ориентиром nav. Пункты — <li> со ссылкой navLinkClassName */
export function NavList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label}>
      <ul className={styles.navList}>{children}</ul>
    </nav>
  )
}

/** Вид пункта панели для ссылки роутера; выбранный — по aria-current="page" */
export const navLinkClassName = styles.navLink

type NavLinkContentProps = {
  icon?: IconName
  label: string
  /** Счётчик справа: число видно всем, а диктор слышит его с подписью («новых: 3») */
  badge?: { value: number; label: string } | undefined
  /** Что-то справа вместо счётчика: состояние почты, версия */
  aside?: ReactNode
}

export function NavLinkContent({ icon, label, badge, aside }: NavLinkContentProps) {
  return (
    <>
      {icon && <Icon name={icon} />}
      <span className={styles.navLabel}>{label}</span>
      {badge && badge.value > 0 && (
        <span className={styles.badge}>
          <span aria-hidden="true">{badge.value}</span>
          <span className="visually-hidden">, {badge.label}</span>
        </span>
      )}
      {aside && <span className={styles.navAside}>{aside}</span>}
    </>
  )
}

type SidebarUserProps = { name: string; roleName: string; action?: ReactNode }

/**
 * Инициалы для аватара: первые буквы двух первых слов. Скобки, кавычки и цифры не в счёт:
 * «Владелец (разработка)» — «ВР», а не «В(»
 */
export function initialsOf(name: string) {
  return name
    .split(/\s+/u)
    .map((part) => /\p{L}/u.exec(part)?.[0])
    .filter((letter): letter is string => letter !== undefined)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Кто вошёл: инициалы, имя, роль и действие («Выйти») */
export function SidebarUser({ name, roleName, action }: SidebarUserProps) {
  const initials = initialsOf(name)
  return (
    <div className={styles.user}>
      <span className={styles.avatar} aria-hidden="true">
        {initials}
      </span>
      <span className={styles.userText}>
        <span className={styles.userName}>{name}</span>
        <span className={styles.userRole}>{roleName}</span>
      </span>
      {action}
    </div>
  )
}
